/**
 * server/test-inventory-api.js
 * Comprehensive integration test suite for Consumable Inventory Phase 1:
 * - Purchase fulfillment & crash recovery
 * - Atomic 3-state refund lifecycle (FULFILLED, REFUND_PENDING, REFUNDED)
 * - Safe refund retry handling with idempotency and referenceId reconciliation verification
 * - Deterministic concurrency testing for consumption and race conditions
 * - Complete inventory and wallet ledger reconciliation
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// 1. Eager server/.env loading relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverEnvPath = path.resolve(__dirname, '.env');
dotenv.config({ path: serverEnvPath });

// Dynamically import application modules AFTER dotenv evaluation
const { default: app } = await import('./src/app.js');
const { default: User } = await import('./src/models/User.js');
const { default: Wallet } = await import('./src/models/Wallet.js');
const { default: WalletTransaction } = await import('./src/models/WalletTransaction.js');
const { default: EconomyConfig } = await import('./src/models/EconomyConfig.js');
const { default: Inventory } = await import('./src/models/Inventory.js');
const { default: walletService } = await import('./src/services/walletService.js');
const { default: inventoryService } = await import('./src/services/inventoryService.js');
const { assertValidTestTarget } = await import('./src/utils/validateTestTarget.js');

let server;
let baseUrl = '';
let authToken = '';
let testUserId = '';
const createdTestUserIds = [];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, context = null) {
  totalTests++;
  if (!condition) {
    failedTests++;
    process.exitCode = 1;
    console.error(`  ❌ FAILED: ${message}`);
    if (context) {
      console.error(
        `     Context: ${typeof context === 'object' ? JSON.stringify(context, null, 2) : context}`
      );
    }
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✅ PASSED: ${message}`);
}

function assertResponse(res, expectedStatus, description) {
  totalTests++;
  if (res.status !== expectedStatus) {
    failedTests++;
    process.exitCode = 1;
    console.error(`  ❌ FAILED: ${description}`);
    console.error(`     Expected Status: ${expectedStatus}, Received: ${res.status}`);
    console.error(`     Body: ${JSON.stringify(res.body, null, 2)}`);
    throw new Error(`Assertion failed: ${description}`);
  }
  passedTests++;
  console.log(`  ✅ PASSED: ${description}`);
}

async function apiRequest(endpoint, options = {}, customToken = null) {
  const url = `${baseUrl}${endpoint}`;
  const tokenToUse = customToken !== null ? customToken : authToken;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  return { status: response.status, body: data };
}

async function runInventoryTestSuite(deps = {}) {
  console.log('\n=============================================================');
  console.log('🎒 APPLE WORM ADVENTURE — CONSUMABLE INVENTORY TEST SUITE');
  console.log('=============================================================\n');

  const validateTarget = deps.validateTarget || assertValidTestTarget;
  const connectFn = deps.connect || ((uri) => mongoose.connect(uri));
  const testMongoUri = deps.mongoUri || process.env.TEST_MONGODB_URI || process.env.MONGODB_TEST_URI;

  // Gate: Enforce database target validation BEFORE attempting connection
  validateTarget(testMongoUri);

  if (deps.validateOnly) {
    return { validated: true, targetUri: testMongoUri };
  }

  try {
    // -------------------------------------------------------------
    // Pre-flight check: Secret presence verification
    // -------------------------------------------------------------
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length === 0) {
      process.exitCode = 1;
      throw new Error('CRITICAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing.');
    }

    // -------------------------------------------------------------
    // Database Isolation Check (Credentials kept confidential)
    // -------------------------------------------------------------
    console.log('Connecting to MongoDB test database...');
    await connectFn(testMongoUri);
    const dbName = mongoose.connection.name || '';
    console.log(`Connected to database: "${dbName}"`);

    // Load active economy
    const economy = await EconomyConfig.getActiveConfig();
    assert(Boolean(economy?.rules), 'Active EconomyConfig rules are available');

    const undoCost = economy.rules.undoPurchaseCost;
    const hintCost = economy.rules.hintPurchaseCost;
    const boosterCost = economy.rules.boosterPurchaseCost;

    assert(Number.isInteger(undoCost) && undoCost > 0, `undoPurchaseCost valid (${undoCost})`);
    assert(Number.isInteger(hintCost) && hintCost > 0, `hintPurchaseCost valid (${hintCost})`);
    assert(Number.isInteger(boosterCost) && boosterCost > 0, `boosterPurchaseCost valid (${boosterCost})`);

    // Launch ephemeral HTTP server
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const timestamp = Date.now();

    // Register primary test player
    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `inv_tester_${timestamp}`,
        email: `inv_tester_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assertResponse(regRes, 201, 'Primary test player registered');
    authToken = regRes.body.token;
    testUserId = regRes.body.user._id || regRes.body.user.id;
    createdTestUserIds.push(testUserId);

    // Initial funding
    const initialCoins = 3000;
    await walletService.credit(testUserId, initialCoins, {
      type: 'BONUS',
      description: 'Test funding',
      idempotencyKey: `fund_${timestamp}`,
    });
    const fundedWallet = await Wallet.findOne({ userId: testUserId });
    assert(fundedWallet.balance === initialCoins, `Primary player funded with ${initialCoins} coins`);

    // -------------------------------------------------------------
    // Scenario 1: Successful Purchase and Inventory Grant
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Successful Purchase & Grant ---');
    const p1Key = `p1_${timestamp}`;
    const p1Res = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: p1Key }),
    });
    assertResponse(p1Res, 200, 'POST /api/wallet/purchase returns 200');
    assert(p1Res.body.data.inventory.quantity === 1, 'UNDO stock incremented to 1');
    assert(p1Res.body.data.balance === initialCoins - undoCost, 'Wallet balance debited accurately');
    assert(typeof p1Res.body.data.transaction.id !== 'undefined', 'Response exposes transaction id');

    // -------------------------------------------------------------
    // Scenario 2: Purchase Replay Without Duplicate Grant
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Purchase Replay Idempotency ---');
    const p1Replay = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: p1Key }),
    });
    assertResponse(p1Replay, 200, 'Replayed purchase returns 200');
    assert(p1Replay.body.data.isDuplicate === true, 'Response marks isDuplicate as true');
    assert(p1Replay.body.data.inventory.quantity === 1, 'Stock remained 1 (no duplicate grant)');
    assert(p1Replay.body.data.balance === initialCoins - undoCost, 'Wallet balance unchanged on replay');

    // -------------------------------------------------------------
    // Scenario 2B: FULFILLED Purchase ID Reused With Conflicting itemType
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2B: FULFILLED Purchase ID Reused with Conflicting itemType ---');
    let fulfilledDiffTypeErr = null;
    try {
      await inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: p1Res.body.data.transaction.id,
        itemType: 'HINT',
      });
    } catch (err) {
      fulfilledDiffTypeErr = err;
    }
    assert(
      Boolean(fulfilledDiffTypeErr && fulfilledDiffTypeErr.statusCode === 409),
      'Reusing FULFILLED purchase ID with different itemType throws 409 Conflict'
    );

    // -------------------------------------------------------------
    // Scenario 3: Recovery After Debit But Before Grant
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Recovery After Debit Before Grant ---');
    const crashKey = `crash_${timestamp}`;
    const manualDebit = await walletService.debit(testUserId, undoCost, {
      type: 'UNDO_PURCHASE',
      idempotencyKey: crashKey,
      metadata: { itemType: 'UNDO' },
    });
    assert(Boolean(manualDebit.transaction._id), 'Direct crash simulation debit created');

    const invBeforeRecovery = await Inventory.findOne({ userId: testUserId });
    assert(invBeforeRecovery.items.UNDO.quantity === 1, 'Inventory stock is 1 before recovery');

    // Simulate client retry after crash
    const recoveryRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: crashKey }),
    });
    assertResponse(recoveryRes, 200, 'Recovery request processed successfully');
    assert(recoveryRes.body.data.inventory.quantity === 2, 'Unfulfilled debit fulfilled (stock now 2)');

    // -------------------------------------------------------------
    // Scenario 4: Concurrent Grant-versus-Refund Race
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Concurrent Grant vs Refund Race ---');
    const raceDebit = await walletService.debit(testUserId, hintCost, {
      type: 'HINT_PURCHASE',
      idempotencyKey: `race_${timestamp}`,
    });
    assert(Boolean(raceDebit.transaction._id), 'Race debit created successfully');

    const [grantOutcome, refundOutcome] = await Promise.allSettled([
      inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: raceDebit.transaction._id,
        itemType: 'HINT',
      }),
      inventoryService.reservePurchaseRefund({
        userId: testUserId,
        purchaseId: raceDebit.transaction._id,
        itemType: 'HINT',
      }),
    ]);

    const grantWon = grantOutcome.status === 'fulfilled';
    const refundWon = refundOutcome.status === 'fulfilled';
    const exactlyOneWon = (grantWon && !refundWon) || (!grantWon && refundWon);
    assert(exactlyOneWon, 'Exactly one operation won the race, mutual exclusion guaranteed');

    // Verify the loser rejected specifically with statusCode 409
    const losingReason = grantWon ? refundOutcome.reason : grantOutcome.reason;
    assert(
      Boolean(losingReason && losingReason.statusCode === 409),
      `Losing operation rejected specifically with statusCode 409 (received: ${losingReason?.statusCode || losingReason?.message})`
    );

    // -------------------------------------------------------------
    // Scenario 5: Fulfilled Purchase Cannot Be Refunded
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Fulfilled Purchase Cannot Be Refunded ---');
    let refundBlocked = false;
    try {
      await inventoryService.reservePurchaseRefund({
        userId: testUserId,
        purchaseId: p1Res.body.data.transaction.id,
        itemType: 'UNDO',
      });
    } catch (err) {
      refundBlocked = err.statusCode === 409;
    }
    assert(refundBlocked, 'reservePurchaseRefund strictly rejected already-fulfilled purchase (409)');

    // -------------------------------------------------------------
    // Scenario 5B: reservePurchaseRefund Rejects Invalid itemType
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5B: reservePurchaseRefund Rejects Invalid itemType ---');
    let badTypeReserveErr = null;
    try {
      await inventoryService.reservePurchaseRefund({
        userId: testUserId,
        purchaseId: new mongoose.Types.ObjectId(),
        itemType: 'INVALID_ITEM_TYPE',
      });
    } catch (err) {
      badTypeReserveErr = err;
    }
    assert(
      Boolean(badTypeReserveErr && badTypeReserveErr.statusCode === 400),
      'reservePurchaseRefund with invalid itemType throws 400 Bad Request'
    );

    // -------------------------------------------------------------
    // Scenario 6: Refunded Purchase Cannot Be Granted
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Refunded Purchase Cannot Be Granted ---');
    const refundDebit = await walletService.debit(testUserId, boosterCost, {
      type: 'BOOSTER_PURCHASE',
      idempotencyKey: `ref_block_${timestamp}`,
    });
    const refBooster = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: refundDebit.transaction._id,
      amount: boosterCost,
      itemType: 'BOOSTER',
    });
    assert(refBooster.refunded === true, 'Booster purchase refund successfully recorded');

    let grantBlocked = false;
    try {
      await inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: refundDebit.transaction._id,
        itemType: 'BOOSTER',
      });
    } catch (err) {
      grantBlocked = err.statusCode === 409;
    }
    assert(grantBlocked, 'grantPurchasedItem strictly rejected refunded purchase (409)');

    // -------------------------------------------------------------
    // Scenario 6B: REFUNDED Purchase ID Reused With Conflicting itemType
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6B: REFUNDED Purchase ID Reused with Conflicting itemType ---');
    let refundedGrantDiffErr = null;
    try {
      await inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: refundDebit.transaction._id,
        itemType: 'UNDO',
      });
    } catch (err) {
      refundedGrantDiffErr = err;
    }
    assert(
      Boolean(refundedGrantDiffErr && refundedGrantDiffErr.statusCode === 409),
      'Reusing REFUNDED purchase ID with different itemType in grant throws 409 Conflict'
    );

    let refundedReserveDiffErr = null;
    try {
      await inventoryService.reservePurchaseRefund({
        userId: testUserId,
        purchaseId: refundDebit.transaction._id,
        itemType: 'UNDO',
      });
    } catch (err) {
      refundedReserveDiffErr = err;
    }
    assert(
      Boolean(refundedReserveDiffErr && refundedReserveDiffErr.statusCode === 409),
      'Reusing REFUNDED purchase ID with different itemType in reserve throws 409 Conflict'
    );

    // -------------------------------------------------------------
    // Scenario 7: Controller Compensation After Fulfillment Failure
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Controller Compensation After Fulfillment Failure ---');
    const wBeforeS7 = await Wallet.findOne({ userId: testUserId });
    const balBeforeS7 = wBeforeS7.balance;

    const origGrant = inventoryService.grantPurchasedItem;
    inventoryService.grantPurchasedItem = async () => {
      throw new Error('Simulated database write error during fulfillment');
    };

    const failKey = `fail_comp_${timestamp}`;
    const failRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: failKey }),
    });

    inventoryService.grantPurchasedItem = origGrant; // Restore

    assertResponse(failRes, 500, 'Controller returned 500 on fulfillment failure');
    assert(failRes.body.data.refunded === true, 'Response confirms coins were refunded');
    assert(failRes.body.data.status === 'REFUNDED', 'Response status indicates REFUNDED');
    assert(Boolean(failRes.body.data.reversalTransactionId), 'Response exposes reversal transaction id');

    // Strengthened verification 1: Assert wallet balance restored in MongoDB
    const wAfterS7 = await Wallet.findOne({ userId: testUserId });
    assert(
      wAfterS7.balance === balBeforeS7,
      `Wallet balance restored to pre-purchase value (${balBeforeS7})`
    );

    // Strengthened verification 2: Exactly one matching REVERSAL CREDIT transaction exists
    const failDebitTxId = failRes.body.data.debitTransactionId;
    const reversalTxId = failRes.body.data.reversalTransactionId;

    const reversalTxs = await WalletTransaction.find({
      userId: testUserId,
      type: 'REVERSAL',
      direction: 'CREDIT',
      referenceId: failDebitTxId,
    });
    assert(reversalTxs.length === 1, 'Exactly one matching REVERSAL CREDIT transaction exists in ledger');

    // Strengthened verification 3: Reversal amount matches purchase debit
    assert(
      reversalTxs[0].amount === undoCost,
      `Reversal amount (${reversalTxs[0].amount}) matches purchase debit (${undoCost})`
    );

    // Strengthened verification 4: Inventory fulfillment is REFUNDED and references that exact reversal
    const invS7 = await Inventory.findOne({ userId: testUserId });
    const fS7 = invS7.fulfillments.find((f) => f.purchaseId.toString() === failDebitTxId);
    assert(Boolean(fS7 && fS7.status === 'REFUNDED'), 'Inventory fulfillment status is REFUNDED');
    assert(
      Boolean(fS7 && fS7.reversalTransactionId && fS7.reversalTransactionId.toString() === reversalTxId),
      'Inventory fulfillment references exact reversal transaction'
    );

    // -------------------------------------------------------------
    // Scenario 8: Credit Failure Leaves REFUND_PENDING
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Credit Failure Leaves REFUND_PENDING ---');
    const origCredit = walletService.credit;
    walletService.credit = async () => {
      throw new Error('Simulated ledger failure');
    };

    const pendingDebit = await walletService.debit(testUserId, hintCost, {
      type: 'HINT_PURCHASE',
      idempotencyKey: `pending_${timestamp}`,
    });

    const pendingRefund = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: pendingDebit.transaction._id,
      amount: hintCost,
      itemType: 'HINT',
    });

    walletService.credit = origCredit; // Restore

    assert(pendingRefund.refunded === false, 'Refund reported uncompleted');
    assert(pendingRefund.status === 'REFUND_PENDING', 'Refund state is durably REFUND_PENDING');

    const invPendingCheck = await Inventory.findOne({ userId: testUserId });
    const fPendingRecord = invPendingCheck.fulfillments.find(
      (f) => f.purchaseId.toString() === pendingDebit.transaction._id.toString()
    );
    assert(fPendingRecord.status === 'REFUND_PENDING', 'Document fulfillment status is REFUND_PENDING');

    // -------------------------------------------------------------
    // Scenario 8B: REFUND_PENDING Purchase ID Reused With Conflicting itemType
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8B: REFUND_PENDING Purchase ID Reused with Conflicting itemType ---');
    let pendingGrantDiffErr = null;
    try {
      await inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: pendingDebit.transaction._id,
        itemType: 'BOOSTER',
      });
    } catch (err) {
      pendingGrantDiffErr = err;
    }
    assert(
      Boolean(pendingGrantDiffErr && pendingGrantDiffErr.statusCode === 409),
      'Reusing REFUND_PENDING purchase ID with different itemType in grant throws 409 Conflict'
    );

    let pendingReserveDiffErr = null;
    try {
      await inventoryService.reservePurchaseRefund({
        userId: testUserId,
        purchaseId: pendingDebit.transaction._id,
        itemType: 'BOOSTER',
      });
    } catch (err) {
      pendingReserveDiffErr = err;
    }
    assert(
      Boolean(pendingReserveDiffErr && pendingReserveDiffErr.statusCode === 409),
      'Reusing REFUND_PENDING purchase ID with different itemType in reserve throws 409 Conflict'
    );

    // -------------------------------------------------------------
    // Scenario 9: Retry Completes Pending Refund Exactly Once
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Retry Completes Pending Refund ---');
    const completedRetry = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: pendingDebit.transaction._id,
      amount: hintCost,
      itemType: 'HINT',
    });
    assert(completedRetry.refunded === true, 'Retry completed refund');
    assert(completedRetry.status === 'REFUNDED', 'Status transitioned to REFUNDED');

    const invRetryCheck = await Inventory.findOne({ userId: testUserId });
    const fRecordAfter = invRetryCheck.fulfillments.find(
      (f) => f.purchaseId.toString() === pendingDebit.transaction._id.toString()
    );
    assert(fRecordAfter.status === 'REFUNDED', 'Document fulfillment status verified as REFUNDED');
    assert(
      fRecordAfter.reversalTransactionId.toString() === completedRetry.reversalTransactionId.toString(),
      'Document reversalTransactionId matches actual reversal transaction'
    );

    // -------------------------------------------------------------
    // Scenario 9B: Retry After Credit Succeeded But Inventory Completion Failed
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9B: Partial Completion Failure & Safe Retry ---');
    const partialDebit = await walletService.debit(testUserId, undoCost, {
      type: 'UNDO_PURCHASE',
      idempotencyKey: `partial_${timestamp}`,
    });
    assert(Boolean(partialDebit.transaction._id), 'Partial test debit created');

    const wBeforePartial = await Wallet.findOne({ userId: testUserId });
    const balBeforePartial = wBeforePartial.balance;

    // Simulate completePurchaseRefund returning null (e.g. temporary write stall)
    const origComplete = inventoryService.completePurchaseRefund;
    inventoryService.completePurchaseRefund = async () => null;

    const partialRefundAttempt = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: partialDebit.transaction._id,
      amount: undoCost,
      itemType: 'UNDO',
    });

    inventoryService.completePurchaseRefund = origComplete; // Restore

    assert(partialRefundAttempt.refunded === false, 'Refund reported unconfirmed when inventory update fails');
    assert(partialRefundAttempt.status === 'REFUND_PENDING', 'Fulfillment status remains REFUND_PENDING');
    assert(Boolean(partialRefundAttempt.reversalTransactionId), 'Reversal transaction ID was captured');

    const wAfterPartialCredit = await Wallet.findOne({ userId: testUserId });
    assert(
      wAfterPartialCredit.balance === balBeforePartial + undoCost,
      'Wallet was credited during first attempt'
    );

    // Retry the refund: must complete without double-crediting
    const retryPartialRefund = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: partialDebit.transaction._id,
      amount: undoCost,
      itemType: 'UNDO',
    });

    assert(retryPartialRefund.refunded === true, 'Retry confirmed refund');
    assert(retryPartialRefund.isDuplicate === true, 'Credit operation was recognized as duplicate');

    const wAfterPartialRetry = await Wallet.findOne({ userId: testUserId });
    assert(
      wAfterPartialRetry.balance === balBeforePartial + undoCost,
      'Wallet was NOT credited a second time on retry'
    );

    // -------------------------------------------------------------
    // Scenario 9C: completePurchaseRefund Idempotency vs Conflicting ID Overwrite
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9C: completePurchaseRefund Idempotency & Overwrite Protection ---');
    const confirmedReversalId = retryPartialRefund.reversalTransactionId;

    // Calling again with the SAME reversal transaction ID must succeed idempotently
    const dupCompleteRes = await inventoryService.completePurchaseRefund({
      userId: testUserId,
      purchaseId: partialDebit.transaction._id,
      reversalTransactionId: confirmedReversalId,
    });
    assert(Boolean(dupCompleteRes), 'completePurchaseRefund called again with same reversal ID succeeds idempotently');

    // Calling with a DIFFERENT reversal ID must be strictly rejected with 409
    let diffRevErr = null;
    try {
      await inventoryService.completePurchaseRefund({
        userId: testUserId,
        purchaseId: partialDebit.transaction._id,
        reversalTransactionId: new mongoose.Types.ObjectId(),
      });
    } catch (err) {
      diffRevErr = err;
    }
    assert(
      Boolean(diffRevErr && diffRevErr.statusCode === 409),
      'completePurchaseRefund with different reversal ID throws 409 Conflict'
    );

    // -------------------------------------------------------------
    // Scenario 9D: already-REFUNDED Record with Missing or Mismatched Ledger Transaction
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9D: Ledger Invariant Verification for already-REFUNDED Records ---');
    const bogusPurchaseId = new mongoose.Types.ObjectId();
    const bogusReversalId = new mongoose.Types.ObjectId();

    // Inject synthetic record into Inventory document with non-existent reversal transaction
    await Inventory.findOneAndUpdate(
      { userId: testUserId },
      {
        $push: {
          fulfillments: {
            purchaseId: bogusPurchaseId,
            itemType: 'UNDO',
            status: 'REFUNDED',
            reversalTransactionId: bogusReversalId,
            updatedAt: new Date(),
          },
        },
      }
    );

    const bogusRes = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: bogusPurchaseId,
      amount: undoCost,
      itemType: 'UNDO',
    });
    assert(bogusRes.refunded === false, 'Missing reversal ledger transaction reports refunded: false');
    assert(
      bogusRes.status === 'REFUND_VERIFICATION_FAILED',
      'Missing reversal ledger transaction reports status REFUND_VERIFICATION_FAILED'
    );

    // Create real transaction but with mismatched amount
    const mismatchPurchaseId = new mongoose.Types.ObjectId();
    const mismatchCredit = await walletService.credit(testUserId, 999, {
      type: 'REVERSAL',
      idempotencyKey: `refund_${mismatchPurchaseId.toString()}`,
      referenceId: mismatchPurchaseId.toString(),
    });

    await Inventory.findOneAndUpdate(
      { userId: testUserId },
      {
        $push: {
          fulfillments: {
            purchaseId: mismatchPurchaseId,
            itemType: 'UNDO',
            status: 'REFUNDED',
            reversalTransactionId: mismatchCredit.transaction._id,
            updatedAt: new Date(),
          },
        },
      }
    );

    const mismatchRes = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: mismatchPurchaseId,
      amount: undoCost, // Expected undoCost, but transaction has 999
      itemType: 'UNDO',
    });
    assert(mismatchRes.refunded === false, 'Mismatched amount reversal ledger transaction reports refunded: false');
    assert(
      mismatchRes.status === 'REFUND_VERIFICATION_FAILED',
      'Mismatched amount reversal ledger transaction reports status REFUND_VERIFICATION_FAILED'
    );

    // Create real transaction with matching user, amount, type, direction, idempotencyKey, but INCORRECT referenceId
    const badRefPurchaseId = new mongoose.Types.ObjectId();
    const badRefCredit = await walletService.credit(testUserId, undoCost, {
      type: 'REVERSAL',
      idempotencyKey: `refund_${badRefPurchaseId.toString()}`,
      referenceId: 'incorrect_reference_id_999',
    });

    await Inventory.findOneAndUpdate(
      { userId: testUserId },
      {
        $push: {
          fulfillments: {
            purchaseId: badRefPurchaseId,
            itemType: 'UNDO',
            status: 'REFUNDED',
            reversalTransactionId: badRefCredit.transaction._id,
            updatedAt: new Date(),
          },
        },
      }
    );

    const badRefRes = await inventoryService.refundFailedPurchase({
      userId: testUserId,
      purchaseId: badRefPurchaseId,
      amount: undoCost,
      itemType: 'UNDO',
    });
    assert(badRefRes.refunded === false, 'Mismatched referenceId reversal ledger transaction reports refunded: false');
    assert(
      badRefRes.status === 'REFUND_VERIFICATION_FAILED',
      'Mismatched referenceId reversal ledger transaction reports status REFUND_VERIFICATION_FAILED'
    );

    // -------------------------------------------------------------
    // Scenario 10: Concurrent Refund Retries Do Not Double-Credit
    // -------------------------------------------------------------
    console.log('\n--- Scenario 10: Concurrent Refund Retries ---');
    const wBeforeConcurrent = await Wallet.findOne({ userId: testUserId });
    const expectedBal = wBeforeConcurrent.balance;

    const [ret1, ret2] = await Promise.all([
      inventoryService.refundFailedPurchase({
        userId: testUserId,
        purchaseId: pendingDebit.transaction._id,
        amount: hintCost,
        itemType: 'HINT',
      }),
      inventoryService.refundFailedPurchase({
        userId: testUserId,
        purchaseId: pendingDebit.transaction._id,
        amount: hintCost,
        itemType: 'HINT',
      }),
    ]);
    assert(ret1.refunded && ret2.refunded, 'Both concurrent retry calls completed safely');

    const wAfterConcurrent = await Wallet.findOne({ userId: testUserId });
    assert(wAfterConcurrent.balance === expectedBal, 'Concurrent retries resulted in exactly one credit');

    // -------------------------------------------------------------
    // Scenario 11: Insufficient Stock Consumption Rejection
    // -------------------------------------------------------------
    console.log('\n--- Scenario 11: Insufficient Stock Rejection ---');
    const badConsume = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'BOOSTER', idempotencyKey: `no_stock_${timestamp}` }),
    });
    assertResponse(badConsume, 400, 'Consumption of 0 stock returns 400');
    assert(badConsume.body.message.includes('Insufficient BOOSTER quantity'), 'Message confirms insufficient quantity');

    // -------------------------------------------------------------
    // Scenario 12: Consumption Replay Returns Original Result
    // -------------------------------------------------------------
    console.log('\n--- Scenario 12: Consumption Replay Snapshot ---');
    const c1Key = `consume_snap_${timestamp}`;
    const consumeRes1 = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: c1Key }),
    });
    assertResponse(consumeRes1, 200, 'First UNDO consumed');
    const originalRemaining = consumeRes1.body.data.remainingQuantity;

    // Grant additional item to change current stock
    await inventoryService.grantPurchasedItem({
      userId: testUserId,
      purchaseId: new mongoose.Types.ObjectId(),
      itemType: 'UNDO',
    });

    const replayConsume = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: c1Key }),
    });
    assertResponse(replayConsume, 200, 'Replay consume returned 200');
    assert(
      replayConsume.body.data.remainingQuantity === originalRemaining,
      'Replay returns snapshot remainingQuantity from original consumption (not current stock)'
    );
    assert(replayConsume.body.data.isDuplicate === true, 'Replay flagged as duplicate');

    // -------------------------------------------------------------
    // Scenario 13: Same Key With Conflicting Parameters Returns 409
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13: Conflicting Consumption Key Reuse (itemType) ---');
    const conflictConsume = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'HINT', idempotencyKey: c1Key }),
    });
    assertResponse(conflictConsume, 409, 'Reusing consumption key for different itemType returns 409 Conflict');

    // -------------------------------------------------------------
    // Scenario 13B: sessionId supplied -> omitted replay conflict
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13B: sessionId Supplied -> Omitted Replay Conflict ---');
    const sessKey1 = `sess_key_1_${timestamp}`;
    await inventoryService.grantPurchasedItem({
      userId: testUserId,
      purchaseId: new mongoose.Types.ObjectId(),
      itemType: 'UNDO',
    });

    await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: sessKey1, sessionId: 'sess_original' }),
    });

    // Replay with sessionId omitted
    const sessSuppliedToOmitted = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: sessKey1 }),
    });
    assertResponse(sessSuppliedToOmitted, 409, 'sessionId supplied -> omitted replay rejected with 409 Conflict');

    // -------------------------------------------------------------
    // Scenario 13C: sessionId omitted -> supplied replay conflict
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13C: sessionId Omitted -> Supplied Replay Conflict ---');
    const sessKey2 = `sess_key_2_${timestamp}`;
    await inventoryService.grantPurchasedItem({
      userId: testUserId,
      purchaseId: new mongoose.Types.ObjectId(),
      itemType: 'UNDO',
    });

    await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: sessKey2 }), // Omitted sessionId
    });

    // Replay with sessionId supplied
    const sessOmittedToSupplied = await apiRequest('/api/inventory/consume', {
      method: 'POST',
      body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: sessKey2, sessionId: 'sess_new' }),
    });
    assertResponse(sessOmittedToSupplied, 409, 'sessionId omitted -> supplied replay rejected with 409 Conflict');

    // -------------------------------------------------------------
    // Scenario 14: Deterministic Concurrent Consumption with Stock=1
    // (Uses an isolated test user to guarantee exactly 1 HINT starting stock)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 14: Deterministic Concurrent Consumption Race ---');
    const regRaceRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `race_user_${timestamp}`,
        email: `race_user_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assertResponse(regRaceRes, 201, 'Dedicated race test user registered');
    const raceToken = regRaceRes.body.token;
    const raceUserId = regRaceRes.body.user._id || regRaceRes.body.user.id;
    createdTestUserIds.push(raceUserId);

    // Grant strictly 1 HINT to raceUser
    await inventoryService.grantPurchasedItem({
      userId: raceUserId,
      purchaseId: new mongoose.Types.ObjectId(),
      itemType: 'HINT',
    });

    const invBeforeRace = await Inventory.findOne({ userId: raceUserId });
    assert(invBeforeRace.items.HINT.quantity === 1, 'Starting HINT quantity is strictly 1');
    const totalConsumedBeforeRace = invBeforeRace.items.HINT.totalConsumed;

    const [rc1, rc2] = await Promise.all([
      apiRequest(
        '/api/inventory/consume',
        {
          method: 'POST',
          body: JSON.stringify({ itemType: 'HINT', idempotencyKey: `rc1_${timestamp}` }),
        },
        raceToken
      ),
      apiRequest(
        '/api/inventory/consume',
        {
          method: 'POST',
          body: JSON.stringify({ itemType: 'HINT', idempotencyKey: `rc2_${timestamp}` }),
        },
        raceToken
      ),
    ]);

    const rStatuses = [rc1.status, rc2.status].sort();
    assert(rStatuses[0] === 200, 'Exactly one concurrent consumption returns HTTP 200');
    assert(rStatuses[1] === 400, 'Exactly one concurrent consumption returns HTTP 400');

    const invAfterRace = await Inventory.findOne({ userId: raceUserId });
    assert(invAfterRace.items.HINT.quantity === 0, 'Final HINT quantity is strictly 0');
    assert(
      invAfterRace.items.HINT.totalConsumed === totalConsumedBeforeRace + 1,
      'totalConsumed increased by exactly 1'
    );

    // -------------------------------------------------------------
    // Scenario 15: Concurrent Duplicate Consumption Decrements Once
    // -------------------------------------------------------------
    console.log('\n--- Scenario 15: Concurrent Duplicate Consumption ---');
    // Add 2 UNDO
    for (let i = 0; i < 2; i++) {
      await inventoryService.grantPurchasedItem({
        userId: testUserId,
        purchaseId: new mongoose.Types.ObjectId(),
        itemType: 'UNDO',
      });
    }
    const invBeforeDup = await Inventory.findOne({ userId: testUserId });
    const stockBefore = invBeforeDup.items.UNDO.quantity;

    const dupKey = `dup_race_${timestamp}`;
    const [dc1, dc2] = await Promise.all([
      apiRequest('/api/inventory/consume', {
        method: 'POST',
        body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: dupKey }),
      }),
      apiRequest('/api/inventory/consume', {
        method: 'POST',
        body: JSON.stringify({ itemType: 'UNDO', idempotencyKey: dupKey }),
      }),
    ]);
    assert(dc1.status === 200 && dc2.status === 200, 'Both concurrent duplicate requests returned 200');

    const invAfterDup = await Inventory.findOne({ userId: testUserId });
    assert(
      invAfterDup.items.UNDO.quantity === stockBefore - 1,
      'Concurrent duplicate requests decremented stock exactly once'
    );

    // -------------------------------------------------------------
    // Scenario 16: Inventory & Wallet Ledger Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 16: Ledger & Inventory Reconciliation ---');
    const userTxs = await WalletTransaction.find({ userId: testUserId }).lean();
    let netCoins = 0;
    for (const tx of userTxs) {
      if (tx.direction === 'CREDIT') netCoins += tx.amount;
      else if (tx.direction === 'DEBIT') netCoins -= tx.amount;
    }
    const currentWallet = await Wallet.findOne({ userId: testUserId });
    assert(currentWallet.balance === netCoins, 'Wallet balance matches net sum of all ledger transactions');

    const finalInv = await Inventory.findOne({ userId: testUserId });
    assert(
      finalInv.items.UNDO.quantity === finalInv.items.UNDO.totalPurchased - finalInv.items.UNDO.totalConsumed,
      'UNDO balance reconciles with totalPurchased - totalConsumed'
    );
    assert(
      finalInv.items.HINT.quantity === finalInv.items.HINT.totalPurchased - finalInv.items.HINT.totalConsumed,
      'HINT balance reconciles with totalPurchased - totalConsumed'
    );
    assert(
      finalInv.items.BOOSTER.quantity === finalInv.items.BOOSTER.totalPurchased - finalInv.items.BOOSTER.totalConsumed,
      'BOOSTER balance reconciles with totalPurchased - totalConsumed'
    );

    console.log('\n=============================================================');
    console.log(`TOTAL TESTS EXECUTED: ${totalTests}`);
    console.log(`PASSED: ${passedTests} | FAILED: ${failedTests}`);
    console.log('=============================================================\n');
  } catch (err) {
    process.exitCode = 1;
    console.error('\n💥 Integration test failure:', err.message);
  } finally {
    if (createdTestUserIds.length > 0 && mongoose.connection.readyState === 1) {
      const dbName = mongoose.connection.name || '';
      if (dbName.toLowerCase().includes('test')) {
        console.log('Cleaning up test artifacts...');
        const objectIdList = createdTestUserIds.map((id) => new mongoose.Types.ObjectId(id));
        await WalletTransaction.collection.deleteMany({ userId: { $in: objectIdList } });
        await Wallet.deleteMany({ userId: { $in: createdTestUserIds } });
        await User.deleteMany({ _id: { $in: createdTestUserIds } });
        await Inventory.deleteMany({ userId: { $in: objectIdList } });
        console.log('Test artifacts cleanly removed.');
      }
    }

    if (server && server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      console.log('Ephemeral server closed.');
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }

    if (failedTests > 0) {
      process.exitCode = 1;
    }
  }
}

export { runInventoryTestSuite };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('test-inventory-api.js') || process.argv[1].endsWith('test-inventory-api'));

if (isMain) {
  runInventoryTestSuite().catch((err) => {
    console.error('\n💥 Critical Database Safety Abort:', err.message);
    process.exit(1);
  });
}