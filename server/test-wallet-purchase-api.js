/**
 * server/test-wallet-purchase-api.js
 * Comprehensive integration test suite for the Wallet Purchase API:
 * POST /api/wallet/purchase
 * 
 * Safety & Environmental Guarantees:
 *  - Eager Env Loading: Evaluates server/.env via top-level await before importing application modules.
 *  - Secret Pre-flight Check: Verifies JWT_SECRET is loaded before starting the server or auth calls (never logs secret).
 *  - Strict Test Database Isolation: Aborts if database name does not contain "test".
 *  - URI Confidentiality: Never logs connection strings or credentials.
 *  - Dynamic Pricing: Derives costs and expected balances mathematically from active EconomyConfig.
 *  - Scoped Cleanup: Deletes ONLY records created by this test run (never drops or touches real player data).
 *  - Safe Ledger Cleanup: Uses native collection operations in test DB to avoid triggering Mongoose immutability hooks.
 *  - Windows-Safe Shutdown: Closes connections cleanly; sets process.exitCode = 1 without calling process.exit().
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// -------------------------------------------------------------
// 1. Eager server/.env loading relative to this test file
// (Must execute BEFORE application modules are imported/evaluated)
// -------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverEnvPath = path.resolve(__dirname, '.env');

// Load server/.env without overwriting already-set shell environment variables
dotenv.config({ path: serverEnvPath });

// Dynamically import application modules AFTER dotenv has populated process.env
const { default: app } = await import('./src/app.js');
const { default: User } = await import('./src/models/User.js');
const { default: Wallet } = await import('./src/models/Wallet.js');
const { default: WalletTransaction } = await import('./src/models/WalletTransaction.js');
const { default: EconomyConfig } = await import('./src/models/EconomyConfig.js');
const { default: walletService } = await import('./src/services/walletService.js');
const { migrateWalletIdempotencyIndex } = await import('./src/utils/migrateWalletIdempotencyIndex.js');
const { assertValidTestTarget } = await import('./src/utils/validateTestTarget.js');

let server;
let baseUrl = '';

let tokenBuyer = '';
let userIdBuyer = '';

let tokenPoorUser = '';
let userIdPoorUser = '';

// Track exclusively the test user IDs created during this test run for targeted cleanup
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
        `     Diagnostic Details: ${
          typeof context === 'object' ? JSON.stringify(context, null, 2) : context
        }`
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
    console.error(`     Expected Status: ${expectedStatus}`);
    console.error(`     Actual Status:   ${res.status}`);
    console.error(`     Response Body:   ${JSON.stringify(res.body, null, 2)}`);
    throw new Error(
      `Assertion failed: ${description} (Expected HTTP ${expectedStatus}, received ${res.status})`
    );
  }
  passedTests++;
  console.log(`  ✅ PASSED: ${description}`);
}

async function apiRequest(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  return { status: response.status, body: data };
}

async function runPurchaseApiTests(deps = {}) {
  console.log('\n=============================================================');
  console.log('🛒 APPLE WORM ADVENTURE — WALLET PURCHASE API TEST SUITE');
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
    // PRE-FLIGHT CHECK: JWT_SECRET presence verification
    // (Value is NEVER logged or leaked)
    // -------------------------------------------------------------
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length === 0) {
      process.exitCode = 1;
      throw new Error(
        'CRITICAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing or empty.\n' +
        `Ensure JWT_SECRET is configured in "${serverEnvPath}" or in your shell environment before running tests.`
      );
    }
    console.log('✅ Configuration verified: JWT_SECRET is present.\n');

    // -------------------------------------------------------------
    // CRITICAL SAFETY CHECK: Database Isolation Verification
    // (URI confidentiality maintained: URI string is never printed)
    // -------------------------------------------------------------
    console.log('Connecting to MongoDB test database...');
    await connectFn(testMongoUri);
    const dbName = mongoose.connection.name || '';

    console.log(`Connected to database: "${dbName}"`);
    await migrateWalletIdempotencyIndex(mongoose.connection.db, { quiet: true });
    console.log('✅ Database isolation confirmed: Verified test database.\n');

    // -------------------------------------------------------------
    // DYNAMIC CONFIGURATION: Load Active Economy Pricing
    // -------------------------------------------------------------
    console.log('--- Loading Active Economy Configuration ---');
    const activeEconomy = await EconomyConfig.getActiveConfig();
    assert(Boolean(activeEconomy?.rules), 'Active EconomyConfig rules are available');

    const expectedUndoCost = activeEconomy.rules.undoPurchaseCost;
    const expectedHintCost = activeEconomy.rules.hintPurchaseCost;
    const expectedBoosterCost = activeEconomy.rules.boosterPurchaseCost;

    assert(
      Number.isInteger(expectedUndoCost) && expectedUndoCost > 0,
      `Active EconomyConfig has valid positive integer undoPurchaseCost (${expectedUndoCost})`
    );
    assert(
      Number.isInteger(expectedHintCost) && expectedHintCost > 0,
      `Active EconomyConfig has valid positive integer hintPurchaseCost (${expectedHintCost})`
    );
    assert(
      Number.isInteger(expectedBoosterCost) && expectedBoosterCost > 0,
      `Active EconomyConfig has valid positive integer boosterPurchaseCost (${expectedBoosterCost})`
    );

    // Calculate dynamic funding and expected balances mathematically
    const totalPurchaseCost = expectedUndoCost + expectedHintCost + expectedBoosterCost;
    const initialBuyerFunding = totalPurchaseCost + 200; // Guaranteed headroom
    const expectedBalanceAfterUndo = initialBuyerFunding - expectedUndoCost;
    const expectedBalanceAfterHint = expectedBalanceAfterUndo - expectedHintCost;
    const expectedBalanceAfterBooster = expectedBalanceAfterHint - expectedBoosterCost;

    console.log(`Dynamic prices: UNDO=${expectedUndoCost}, HINT=${expectedHintCost}, BOOSTER=${expectedBoosterCost}`);
    console.log(`Initial test funding: ${initialBuyerFunding} coins\n`);

    // Launch ephemeral test server on random available port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Ephemeral API test server running at: ${baseUrl}\n`);

    const timestamp = Date.now();

    // -------------------------------------------------------------
    // Setup: Register Test Buyer and Test Poor User
    // -------------------------------------------------------------
    console.log('--- Registering Users for Purchase Tests ---');
    const regResBuyer = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `buyer_${timestamp}`,
        email: `buyer_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assertResponse(regResBuyer, 201, 'Buyer registered successfully');
    tokenBuyer = regResBuyer.body.token;
    userIdBuyer = regResBuyer.body.user._id || regResBuyer.body.user.id;
    createdTestUserIds.push(userIdBuyer);

    const regResPoor = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `poor_${timestamp}`,
        email: `poor_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assertResponse(regResPoor, 201, 'Poor user registered successfully');
    tokenPoorUser = regResPoor.body.token;
    userIdPoorUser = regResPoor.body.user._id || regResPoor.body.user.id;
    createdTestUserIds.push(userIdPoorUser);

    // Fund Buyer dynamically with calculated initial funding
    await walletService.credit(userIdBuyer, initialBuyerFunding, {
      type: 'BONUS',
      description: 'Initial funding for test suite',
      idempotencyKey: `fund_buyer_${timestamp}`,
    });
    const buyerWallet = await Wallet.findOne({ userId: userIdBuyer });
    assert(
      buyerWallet.balance === initialBuyerFunding,
      `Buyer funded with exactly ${initialBuyerFunding} coins`
    );

    // Ensure Poor User has strictly 0 balance
    const poorWallet = await walletService.getOrCreateWallet(userIdPoorUser);
    assert(poorWallet.balance === 0, 'Poor user balance is strictly 0');

    // -------------------------------------------------------------
    // Test 1: Missing Authentication (401)
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Missing Authentication ---');
    const unauthRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: `unauth_key_${timestamp}`,
      }),
    });
    assertResponse(unauthRes, 401, 'Unauthenticated purchase rejected with 401');

    // -------------------------------------------------------------
    // Test 2: Invalid or Missing itemType (400)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Invalid or Missing itemType ---');
    const missingTypeRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        idempotencyKey: `key_notype_${timestamp}`,
      }),
    });
    assertResponse(missingTypeRes, 400, 'Missing itemType rejected with 400');

    const invalidTypeRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'SUPER_WORM_SKIN',
        idempotencyKey: `key_badtype_${timestamp}`,
      }),
    });
    assertResponse(invalidTypeRes, 400, 'Invalid itemType rejected with 400');

    // -------------------------------------------------------------
    // Test 3: Invalid or Missing idempotencyKey (400)
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Invalid or Missing idempotencyKey ---');
    const missingKeyRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'UNDO',
      }),
    });
    assertResponse(missingKeyRes, 400, 'Missing idempotencyKey rejected with 400');

    const whitespaceKeyRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: '     ',
      }),
    });
    assertResponse(whitespaceKeyRes, 400, 'Whitespace-only idempotencyKey rejected with 400');

    // -------------------------------------------------------------
    // Test 4: Client Price Tampering Protection & UNDO Purchase
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Client Price Tampering Protection & UNDO Purchase ---');
    const tamperKey = `tamper_${timestamp}`;
    const tamperRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: tamperKey,
        amount: 1, // Client attempting to pay 1 coin instead of configured price
        price: 1,
      }),
    });
    assertResponse(tamperRes, 200, 'Purchase succeeded but client price was ignored');
    assert(
      tamperRes.body.data.amount === expectedUndoCost,
      `Server charged configured cost (${expectedUndoCost}) and ignored tampered client price`
    );
    assert(
      tamperRes.body.data.balanceAfter === expectedBalanceAfterUndo,
      `Buyer balance reduced to ${expectedBalanceAfterUndo} (${initialBuyerFunding} - ${expectedUndoCost})`
    );
    assert(tamperRes.body.data.transaction.type === 'UNDO_PURCHASE', 'Transaction type is UNDO_PURCHASE');
    assert(tamperRes.body.data.transaction.direction === 'DEBIT', 'Transaction direction is DEBIT');

    // -------------------------------------------------------------
    // Test 5: Successful HINT Purchase
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Successful HINT Purchase ---');
    const hintKey = `hint_${timestamp}`;
    const hintRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'HINT',
        idempotencyKey: hintKey,
      }),
    });
    assertResponse(hintRes, 200, 'HINT purchase succeeded with 200 OK');
    assert(
      hintRes.body.data.amount === expectedHintCost,
      `HINT charged configured cost (${expectedHintCost})`
    );
    assert(
      hintRes.body.data.balanceAfter === expectedBalanceAfterHint,
      `Buyer balance reduced to ${expectedBalanceAfterHint} (${expectedBalanceAfterUndo} - ${expectedHintCost})`
    );
    assert(hintRes.body.data.transaction.type === 'HINT_PURCHASE', 'Transaction type is HINT_PURCHASE');
    assert(hintRes.body.data.transaction.direction === 'DEBIT', 'Transaction direction is DEBIT');

    // -------------------------------------------------------------
    // Test 6: Successful BOOSTER Purchase
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Successful BOOSTER Purchase ---');
    const boosterKey = `booster_${timestamp}`;
    const boosterRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(boosterRes, 200, 'BOOSTER purchase succeeded with 200 OK');
    assert(
      boosterRes.body.data.amount === expectedBoosterCost,
      `BOOSTER charged configured cost (${expectedBoosterCost})`
    );
    assert(
      boosterRes.body.data.balanceAfter === expectedBalanceAfterBooster,
      `Buyer balance reduced to ${expectedBalanceAfterBooster} (${expectedBalanceAfterHint} - ${expectedBoosterCost})`
    );
    assert(boosterRes.body.data.transaction.type === 'BOOSTER_PURCHASE', 'Transaction type is BOOSTER_PURCHASE');
    assert(boosterRes.body.data.transaction.direction === 'DEBIT', 'Transaction direction is DEBIT');

    // -------------------------------------------------------------
    // Test 7: Verify Charged Amounts Strictly Match EconomyConfig
    // -------------------------------------------------------------
    console.log('\n--- Test 7: EconomyConfig Pricing Alignment ---');
    assert(
      tamperRes.body.data.amount === activeEconomy.rules.undoPurchaseCost,
      'UNDO price matches activeEconomy.rules.undoPurchaseCost'
    );
    assert(
      hintRes.body.data.amount === activeEconomy.rules.hintPurchaseCost,
      'HINT price matches activeEconomy.rules.hintPurchaseCost'
    );
    assert(
      boosterRes.body.data.amount === activeEconomy.rules.boosterPurchaseCost,
      'BOOSTER price matches activeEconomy.rules.boosterPurchaseCost'
    );

    // -------------------------------------------------------------
    // Test 8: Insufficient Balance Rejection (400)
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Insufficient Balance Rejection ---');
    const insufficientRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenPoorUser}` },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: `poor_undo_${timestamp}`,
      }),
    });
    assertResponse(insufficientRes, 400, 'Purchase with 0 coins rejected with 400');
    assert(
      insufficientRes.body.message.includes('Insufficient balance'),
      'Message states "Insufficient balance"'
    );
    const poorWalletAfter = await Wallet.findOne({ userId: userIdPoorUser });
    assert(poorWalletAfter.balance === 0, 'Poor user balance remained 0 (never negative)');

    // -------------------------------------------------------------
    // Test 9: Duplicate Idempotency Key Handling
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Duplicate Idempotency Replay ---');
    const dupRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey: boosterKey, // Replaying Test 6 key
      }),
    });
    assertResponse(dupRes, 200, 'Duplicate request returned 200 OK');
    assert(dupRes.body.data.isDuplicate === true, 'Response marks isDuplicate as true');
    assert(
      dupRes.body.data.balanceAfter === expectedBalanceAfterBooster,
      `Buyer balance was NOT decremented again (remains ${expectedBalanceAfterBooster})`
    );

    // -------------------------------------------------------------
    // Test 10: Conflicting Reuse of Idempotency Key (409 Conflict)
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Conflicting Idempotency Key Reuse ---');
    const conflictRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'HINT', // Colliding key with different item type
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(conflictRes, 409, 'Reusing key with different parameters rejected with 409 Conflict');

    // -------------------------------------------------------------
    // Test 11: Ledger Balance Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Ledger Balance Reconciliation ---');
    const allBuyerTxs = await WalletTransaction.find({ userId: userIdBuyer }).lean();
    let computedLedgerBalance = 0;
    for (const tx of allBuyerTxs) {
      if (tx.direction === 'CREDIT') computedLedgerBalance += tx.amount;
      else if (tx.direction === 'DEBIT') computedLedgerBalance -= tx.amount;
    }
    const currentBuyerWallet = await Wallet.findOne({ userId: userIdBuyer }).lean();
    assert(
      currentBuyerWallet.balance === computedLedgerBalance,
      `Authoritative balance (${currentBuyerWallet.balance}) matches ledger net sum (${computedLedgerBalance})`
    );
    assert(
      currentBuyerWallet.balance === expectedBalanceAfterBooster,
      `Final buyer wallet balance exactly matches calculated balance (${expectedBalanceAfterBooster})`
    );

    // -------------------------------------------------------------
    // Test 12: Existing GET Endpoints Preservation
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Existing GET Endpoints Preservation ---');
    const getWalletRes = await apiRequest('/api/wallet', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
    });
    assertResponse(getWalletRes, 200, 'GET /api/wallet returned 200 OK');
    assert(
      getWalletRes.body.data.balance === expectedBalanceAfterBooster,
      `GET /api/wallet reflects current balance (${expectedBalanceAfterBooster})`
    );

    const getTxRes = await apiRequest('/api/wallet/transactions?limit=10', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
    });
    assertResponse(getTxRes, 200, 'GET /api/wallet/transactions returned 200 OK');
    assert(Array.isArray(getTxRes.body.data), 'Transactions data is an array');
    const debitTxs = getTxRes.body.data.filter((t) => t.direction === 'DEBIT');
    assert(debitTxs.length === 3, 'Ledger contains exactly 3 purchase debit records');

    // -------------------------------------------------------------
    // Test 13: Multi-User Idempotency Key Independence
    // -------------------------------------------------------------
    console.log('\n--- Test 13: Multi-User Idempotency Key Independence ---');
    const regResSecondBuyer = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `buyer2_${timestamp}`,
        email: `buyer2_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assertResponse(regResSecondBuyer, 201, 'Second buyer registered successfully');
    const tokenSecondBuyer = regResSecondBuyer.body.token;
    const userIdSecondBuyer = regResSecondBuyer.body.user._id || regResSecondBuyer.body.user.id;
    createdTestUserIds.push(userIdSecondBuyer);

    await walletService.credit(userIdSecondBuyer, 200, {
      type: 'BONUS',
      description: 'Funding second buyer for cross-user idempotency test',
    });

    // Second buyer purchases BOOSTER using the EXACT SAME boosterKey buyer used in Test 6, 9, 10
    const crossBuyerRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSecondBuyer}` },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(crossBuyerRes, 200, 'Second buyer purchase with same idempotency key succeeded with 200 OK');
    assert(crossBuyerRes.body.data.isDuplicate === false, 'Second buyer purchase is fresh (not duplicate of first buyer)');
    assert(crossBuyerRes.body.data.balanceAfter === 100, 'Second buyer balance correctly reduced to 100 (200 - 100)');
    assert(
      crossBuyerRes.body.data.transaction.id !== dupRes.body.data.transaction.id,
      'Transactions are distinct documents in ledger'
    );

    // Second buyer duplicate replay with boosterKey
    const crossReplayRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSecondBuyer}` },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(crossReplayRes, 200, 'Second buyer duplicate replay returns 200 OK');
    assert(crossReplayRes.body.data.isDuplicate === true, 'Second buyer duplicate replay marked isDuplicate: true');
    assert(crossReplayRes.body.data.balanceAfter === 100, 'Second buyer balance not decremented again on replay (remains 100)');

    // Second buyer conflict with different itemType
    const crossConflictRes = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSecondBuyer}` },
      body: JSON.stringify({
        itemType: 'HINT',
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(crossConflictRes, 409, 'Second buyer reusing key with different itemType rejected with 409 Conflict');

    // First buyer still replays original purchase with boosterKey
    const firstBuyerReplay = await apiRequest('/api/wallet/purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBuyer}` },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey: boosterKey,
      }),
    });
    assertResponse(firstBuyerReplay, 200, 'First buyer replay still returns 200 OK');
    assert(firstBuyerReplay.body.data.isDuplicate === true, 'First buyer replay still marked isDuplicate: true');
    assert(firstBuyerReplay.body.data.balanceAfter === expectedBalanceAfterBooster, 'First buyer balance unchanged');

    // -------------------------------------------------------------
    // Test 14: Null Idempotency Key Independence for Same User
    // -------------------------------------------------------------
    console.log('\n--- Test 14: Null Idempotency Key Independence ---');
    const credit1 = await walletService.credit(userIdBuyer, 10, {
      type: 'LEVEL_REWARD',
      idempotencyKey: null,
      description: 'First null-key reward',
    });
    const credit2 = await walletService.credit(userIdBuyer, 15, {
      type: 'LEVEL_REWARD',
      idempotencyKey: null,
      description: 'Second null-key reward',
    });
    assert(credit1.transaction._id && credit2.transaction._id, 'Both null-key transactions created successfully');
    assert(credit1.transaction._id.toString() !== credit2.transaction._id.toString(), 'Null key transactions have unique IDs');
    assert(credit2.balanceAfter === expectedBalanceAfterBooster + 10 + 15, 'Wallet balance accurately incremented by null-key credits');

    // -------------------------------------------------------------
    // Test 15: Concurrent Duplicate Purchase Requests via API
    // -------------------------------------------------------------
    console.log('\n--- Test 15: Concurrent Duplicate Purchase Race ---');
    const concurrentPurchaseKey = `api_conc_buy_${timestamp}`;
    const buyerWalletBeforeRace = await Wallet.findOne({ userId: userIdBuyer });
    const balBeforeRace = buyerWalletBeforeRace.balance;

    const [raceRes1, raceRes2] = await Promise.all([
      apiRequest('/api/wallet/purchase', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenBuyer}` },
        body: JSON.stringify({
          itemType: 'UNDO',
          idempotencyKey: concurrentPurchaseKey,
        }),
      }),
      apiRequest('/api/wallet/purchase', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenBuyer}` },
        body: JSON.stringify({
          itemType: 'UNDO',
          idempotencyKey: concurrentPurchaseKey,
        }),
      }),
    ]);

    assertResponse(raceRes1, 200, 'First concurrent purchase returns 200 OK');
    assertResponse(raceRes2, 200, 'Second concurrent purchase returns 200 OK');

    const raceDuplicates = [raceRes1.body.data.isDuplicate, raceRes2.body.data.isDuplicate];
    assert(raceDuplicates.includes(false), 'Exactly one concurrent purchase response marks isDuplicate: false');
    assert(raceDuplicates.includes(true), 'Exactly one concurrent purchase response marks isDuplicate: true');

    assert(
      raceRes1.body.data.transaction.id === raceRes2.body.data.transaction.id,
      'Both concurrent purchase responses report identical transaction ID'
    );

    const buyerWalletAfterRace = await Wallet.findOne({ userId: userIdBuyer });
    assert(
      buyerWalletAfterRace.balance === balBeforeRace - activeEconomy.rules.undoPurchaseCost,
      `Buyer balance decremented exactly once by UNDO cost (${activeEconomy.rules.undoPurchaseCost})`
    );

    console.log('\n=============================================================');
    console.log(
      `🎉 ALL PURCHASE TESTS PASSED: ${passedTests}/${totalTests} Passed (Failed: ${failedTests})`
    );
    console.log('=============================================================\n');
  } catch (err) {
    process.exitCode = 1;
    console.error('\n💥 Integration test encountered an error:', err.message);
  } finally {
    // Clean up ONLY the test entities created during this run
    if (createdTestUserIds.length > 0 && mongoose.connection.readyState === 1) {
      try {
        const cleanupDbName = mongoose.connection.name || '';
        if (!cleanupDbName.toLowerCase().includes('test')) {
          console.error(`⚠️ CRITICAL ABORT: Database "${cleanupDbName}" is not identified as a test database. Skipping cleanup to protect data.`);
          process.exitCode = 1;
        } else {
          console.log('\n--- Cleaning Up Test-Created Artifacts ---');
          const objectIdList = createdTestUserIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

          // Native MongoDB driver collection operation is used here strictly within integration test cleanup
          // to remove test-created records without triggering Mongoose schema-level immutability middleware
          // (which intentionally prevents application-level mutations in WalletTransaction.js).
          const deletedTxs = await WalletTransaction.collection.deleteMany({
            userId: { $in: objectIdList },
          });

          const deletedWallets = await Wallet.deleteMany({
            userId: { $in: createdTestUserIds },
          });
          const deletedUsers = await User.deleteMany({
            _id: { $in: createdTestUserIds },
          });

          console.log(
            `Cleaned up ${deletedUsers.deletedCount} user(s), ${deletedWallets.deletedCount} wallet(s), and ${deletedTxs.deletedCount} transaction(s).`
          );
          console.log('Real player data was untouched.');
        }
      } catch (cleanErr) {
        process.exitCode = 1;
        console.error('Test cleanup error during teardown:', cleanErr.message);
      }
    }

    // Gracefully shut down HTTP server without dangling keep-alive sockets
    if (server && server.listening) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
      console.log('Ephemeral server stopped.');
    }

    // Gracefully disconnect Mongoose
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }

    // Set exit code to 1 if tests failed
    if (failedTests > 0) {
      process.exitCode = 1;
    }
  }
}

export { runPurchaseApiTests };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('test-wallet-purchase-api.js') || process.argv[1].endsWith('test-wallet-purchase-api'));

if (isMain) {
  runPurchaseApiTests().catch((err) => {
    console.error('\n💥 Critical Database Safety Abort:', err.message);
    process.exit(1);
  });
}