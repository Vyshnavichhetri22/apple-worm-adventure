import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import http from 'node:http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import app from './src/app.js';
import User from './src/models/User.js';
import Level from './src/models/Level.js';
import Wallet from './src/models/Wallet.js';
import WalletTransaction from './src/models/WalletTransaction.js';
import EconomyConfig from './src/models/EconomyConfig.js';
import walletService from './src/services/walletService.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';

let server;
let baseUrl = '';

let tokenUserA = '';
let userIdA = '';
let tokenUserB = '';
let userIdB = '';
let level1Doc = null;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, context = null) {
  totalTests++;
  if (!condition) {
    failedTests++;
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

async function runEconomyTests() {
  console.log('\n=============================================================');
  console.log('💰 APPLE WORM ADVENTURE — VELOOP ECONOMY PHASE 1 TEST SUITE');
  console.log('=============================================================\n');

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB Connected successfully.');

    // Launch ephemeral server instance on a random available port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Ephemeral API test server running at: ${baseUrl}\n`);

    const timestamp = Date.now();
    const testEmailA = `wallet_test_a_${timestamp}@example.com`;
    const testEmailB = `wallet_test_b_${timestamp}@example.com`;

    // Setup: Register Test User A and Test User B
    console.log('--- Registering Users for Economy Tests ---');
    const regResA = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `economyA_${timestamp}`,
        email: testEmailA,
        password: 'Password123!',
      }),
    });
    assertResponse(regResA, 201, 'User A registered for wallet tests');
    tokenUserA = regResA.body.token;
    userIdA = regResA.body.user._id || regResA.body.user.id;

    const regResB = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `economyB_${timestamp}`,
        email: testEmailB,
        password: 'Password123!',
      }),
    });
    assertResponse(regResB, 201, 'User B registered for wallet tests');
    tokenUserB = regResB.body.token;
    userIdB = regResB.body.user._id || regResB.body.user.id;

    level1Doc = await Level.findOne({ levelNumber: 1, isActive: true });
    assert(level1Doc !== null, 'Level 1 exists and is active');

    // -------------------------------------------------------------
    // Scenario 1: Wallet is created for a newly registered player
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Wallet Created for User A ---');
    const walletA = await walletService.getOrCreateWallet(userIdA);
    assert(walletA !== null && walletA._id !== undefined, 'Wallet created for User A');
    assert(walletA.userId.toString() === userIdA.toString(), 'Wallet belongs to User A');

    // -------------------------------------------------------------
    // Scenario 2: Initial balance is valid (0)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Initial Balance is Valid (0) ---');
    assert(walletA.balance === 0, 'Initial wallet balance is strictly 0');
    assert(walletA.currency === 'COIN', 'Default currency is COIN');

    // -------------------------------------------------------------
    // Scenario 3: Authenticated wallet retrieval succeeds
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Authenticated Wallet Retrieval ---');
    const getWalletRes = await apiRequest('/api/wallet', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(getWalletRes, 200, 'GET /api/wallet returned 200 OK');
    assert(getWalletRes.body.data.balance === 0, 'API returns correct initial balance 0');

    // -------------------------------------------------------------
    // Scenario 4: Unauthenticated wallet retrieval is rejected
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Unauthenticated Retrieval Rejected ---');
    const unauthRes = await apiRequest('/api/wallet', {
      method: 'GET',
    });
    assertResponse(unauthRes, 401, 'Unauthenticated request rejected with 401');

    // -------------------------------------------------------------
    // Scenario 5: User A cannot access User B wallet data
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: User A Cannot Access User B Wallet ---');
    const getWalletBRes = await apiRequest('/api/wallet', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserB}` },
    });
    assertResponse(getWalletBRes, 200, 'User B retrieves own wallet');
    assert(
      getWalletBRes.body.data.userId.toString() === userIdB.toString(),
      'User B token returns User B wallet'
    );
    assert(
      getWalletRes.body.data.walletId.toString() !== getWalletBRes.body.data.walletId.toString(),
      'Wallets for User A and User B are distinct documents'
    );

    // -------------------------------------------------------------
    // Scenario 6: Transaction history is paginated
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Transaction History Pagination Structure ---');
    const txHistRes = await apiRequest('/api/wallet/transactions?page=1&limit=5', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(txHistRes, 200, 'GET /api/wallet/transactions returned 200 OK');
    assert(Array.isArray(txHistRes.body.data), 'Transactions data is an array');
    assert(txHistRes.body.pagination.page === 1, 'Pagination page is 1');
    assert(txHistRes.body.pagination.limit === 5, 'Pagination limit is 5');

    // -------------------------------------------------------------
    // Scenario 7: Valid credit creates a ledger transaction
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Valid Credit Creates Ledger Entry ---');
    const credit1 = await walletService.credit(userIdA, 100, {
      type: 'DAILY_REWARD',
      description: 'Day 1 daily reward',
      idempotencyKey: `daily_reward_${userIdA}_day1`,
    });
    assert(credit1.balanceBefore === 0, 'balanceBefore was 0');
    assert(credit1.balanceAfter === 100, 'balanceAfter is 100');
    assert(credit1.transaction.type === 'DAILY_REWARD', 'Ledger recorded DAILY_REWARD');
    assert(credit1.transaction.direction === 'CREDIT', 'Direction is CREDIT');

    // Verify User.coins was kept in sync
    const userASynced = await User.findById(userIdA).lean();
    assert(userASynced.coins === 100, 'User.coins automatically synchronized to 100');

    // -------------------------------------------------------------
    // Scenario 8: Valid debit creates a ledger transaction
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Valid Debit Creates Ledger Entry ---');
    const debit1 = await walletService.debit(userIdA, 40, {
      type: 'UNDO_PURCHASE',
      description: 'Purchased extra undo',
      idempotencyKey: `undo_purchase_${userIdA}_tx1`,
    });
    assert(debit1.balanceBefore === 100, 'balanceBefore was 100');
    assert(debit1.balanceAfter === 60, 'balanceAfter is 60');
    assert(debit1.transaction.type === 'UNDO_PURCHASE', 'Ledger recorded UNDO_PURCHASE');
    assert(debit1.transaction.direction === 'DEBIT', 'Direction is DEBIT');

    // -------------------------------------------------------------
    // Scenario 9: Insufficient balance prevents debit
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Insufficient Balance Prevents Debit ---');
    let debitFailed = false;
    try {
      await walletService.debit(userIdA, 500, {
        type: 'BOOSTER_PURCHASE',
        description: 'Attempting to buy expensive booster pack',
      });
    } catch (err) {
      debitFailed = true;
      assert(err.statusCode === 400, 'Insufficient balance error has status 400');
      assert(err.message.includes('Insufficient balance'), 'Clear error message returned');
    }
    assert(debitFailed, 'Debit call threw error due to insufficient balance');
    const walletCheck = await Wallet.findOne({ userId: userIdA });
    assert(walletCheck.balance === 60, 'Balance untouched at 60 after failed debit');

    // -------------------------------------------------------------
    // Scenario 10: Negative amounts are rejected
    // -------------------------------------------------------------
    console.log('\n--- Scenario 10: Negative Amounts Rejected ---');
    let negCreditFailed = false;
    try {
      await walletService.credit(userIdA, -50);
    } catch (err) {
      negCreditFailed = true;
      assert(err.statusCode === 400, 'Negative amount rejected with 400');
    }
    assert(negCreditFailed, 'walletService.credit rejected negative amount');

    // -------------------------------------------------------------
    // Scenario 11: Fractional amounts are rejected
    // -------------------------------------------------------------
    console.log('\n--- Scenario 11: Fractional Amounts Rejected ---');
    let fracDebitFailed = false;
    try {
      await walletService.debit(userIdA, 12.5);
    } catch (err) {
      fracDebitFailed = true;
      assert(err.statusCode === 400, 'Fractional amount rejected with 400');
    }
    assert(fracDebitFailed, 'walletService.debit rejected fractional amount');

    // -------------------------------------------------------------
    // Scenario 12: Zero amounts are rejected
    // -------------------------------------------------------------
    console.log('\n--- Scenario 12: Zero Amounts Rejected ---');
    let zeroCreditFailed = false;
    try {
      await walletService.credit(userIdA, 0);
    } catch (err) {
      zeroCreditFailed = true;
      assert(err.statusCode === 400, 'Zero amount rejected with 400');
    }
    assert(zeroCreditFailed, 'walletService.credit rejected zero amount');

    // -------------------------------------------------------------
    // Scenario 13: Duplicate idempotency keys do not double-credit
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13: Idempotent Credit Protection ---');
    const duplicateKey = `test_credit_key_${timestamp}`;
    const firstCredit = await walletService.credit(userIdA, 50, {
      type: 'BONUS',
      description: 'First bonus grant',
      idempotencyKey: duplicateKey,
    });
    assert(firstCredit.isDuplicate === false, 'First credit processed normally');
    assert(firstCredit.balanceAfter === 110, 'Balance is now 110 (60 + 50)');

    const secondCredit = await walletService.credit(userIdA, 50, {
      type: 'BONUS',
      description: 'Attempted duplicate bonus grant',
      idempotencyKey: duplicateKey,
    });
    assert(secondCredit.isDuplicate === true, 'Second credit marked as duplicate');
    assert(secondCredit.balanceAfter === 110, 'Balance remains exactly 110');

    // -------------------------------------------------------------
    // Scenario 14: Duplicate idempotency keys do not double-debit
    // -------------------------------------------------------------
    console.log('\n--- Scenario 14: Idempotent Debit Protection ---');
    const duplicateDebitKey = `test_debit_key_${timestamp}`;
    const firstDebit = await walletService.debit(userIdA, 20, {
      type: 'HINT_PURCHASE',
      description: 'Hint purchase 1',
      idempotencyKey: duplicateDebitKey,
    });
    assert(firstDebit.isDuplicate === false, 'First debit processed normally');
    assert(firstDebit.balanceAfter === 90, 'Balance is now 90 (110 - 20)');

    const secondDebit = await walletService.debit(userIdA, 20, {
      type: 'HINT_PURCHASE',
      description: 'Duplicate hint purchase attempt',
      idempotencyKey: duplicateDebitKey,
    });
    assert(secondDebit.isDuplicate === true, 'Second debit marked as duplicate');
    assert(secondDebit.balanceAfter === 90, 'Balance remains exactly 90');

    // -------------------------------------------------------------
    // Scenario 15: Wallet balance matches ledger calculations
    // -------------------------------------------------------------
    console.log('\n--- Scenario 15: Wallet Balance Matches Ledger Audit ---');
    const allUserATxs = await WalletTransaction.find({ userId: userIdA }).lean();
    let computedLedgerBalance = 0;
    for (const tx of allUserATxs) {
      if (tx.direction === 'CREDIT') computedLedgerBalance += tx.amount;
      else if (tx.direction === 'DEBIT') computedLedgerBalance -= tx.amount;
    }
    const currentWalletA = await Wallet.findOne({ userId: userIdA }).lean();
    assert(
      currentWalletA.balance === computedLedgerBalance,
      `Authoritative balance (${currentWalletA.balance}) exactly matches sum of ledger transactions (${computedLedgerBalance})`
    );

    // -------------------------------------------------------------
    // Scenario 16: Failed ledger writes do not leave inconsistent balances
    // -------------------------------------------------------------
    console.log('\n--- Scenario 16: Compensating Rollback Integrity ---');
    const collisionKey = `collision_key_${timestamp}`;

    // Pre-insert a transaction with collisionKey for User B
    await WalletTransaction.create({
      userId: userIdB,
      walletId: (await walletService.getOrCreateWallet(userIdB))._id,
      direction: 'CREDIT',
      type: 'BONUS',
      amount: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      idempotencyKey: collisionKey,
      description: 'Existing key',
    });

    const balanceBeforeAttempt = (await Wallet.findOne({ userId: userIdA })).balance;
    let collisionFailed = false;
    try {
      // User A attempts credit with colliding key belonging to User B
      await walletService.credit(userIdA, 25, {
        type: 'BONUS',
        idempotencyKey: collisionKey,
      });
    } catch (err) {
      collisionFailed = true;
    }
    assert(collisionFailed, 'Colliding idempotencyKey properly threw an error');
    const balanceAfterAttempt = (await Wallet.findOne({ userId: userIdA })).balance;
    assert(
      balanceBeforeAttempt === balanceAfterAttempt,
      'Compensating rollback restored wallet balance back to initial state'
    );

    // -------------------------------------------------------------
    // Scenario 17: Level completion credits configured coins
    // -------------------------------------------------------------
    console.log('\n--- Scenario 17: Level Completion Credits Configured Coins ---');
    const startRes = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 1 }),
    });
    assertResponse(startRes, 201, 'Started Level 1 session');
    const sessionId = startRes.body.data._id;

    const balanceBeforeClear = (await Wallet.findOne({ userId: userIdA })).balance;
    const config = await EconomyConfig.getActiveConfig();
    const expectedCoins =
      config.rules.levelCompletionBase + config.rules.threeStarBonus; // 25 + 20 = 45

    const completeRes = await apiRequest(`/api/games/${sessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: 5,
        durationSeconds: 10,
        applesCollected: 1,
      }),
    });
    assertResponse(completeRes, 200, 'Completed Level 1 session');
    assert(completeRes.body.data.rewards.coins === expectedCoins, 'Level rewarded 45 coins');
    assert(completeRes.body.data.wallet.balance === balanceBeforeClear + expectedCoins, 'Wallet credited');

    // -------------------------------------------------------------
    // Scenario 18: Duplicate level completion does not credit coins twice
    // -------------------------------------------------------------
    console.log('\n--- Scenario 18: Duplicate Completion Rejection ---');
    const dupCompleteRes = await apiRequest(`/api/games/${sessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: 5,
        durationSeconds: 10,
      }),
    });
    assertResponse(dupCompleteRes, 400, 'Duplicate completion rejected with 400');
    const balanceAfterDup = (await Wallet.findOne({ userId: userIdA })).balance;
    assert(
      balanceAfterDup === balanceBeforeClear + expectedCoins,
      'No secondary credit occurred on duplicate completion'
    );

    // -------------------------------------------------------------
    // Scenario 19: Existing Game Session functionality remains operational
    // -------------------------------------------------------------
    console.log('\n--- Scenario 19: Game Session Checkpoint & Progress Integrity ---');
    const startL2Res = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 2 }),
    });
    assertResponse(startL2Res, 201, 'Level 2 session initiated');
    const sessionL2Id = startL2Res.body.data._id;

    const checkpointRes = await apiRequest(`/api/games/${sessionL2Id}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 2,
        currentScore: 100,
        wormState: startL2Res.body.data.initialState.worm,
      }),
    });
    assertResponse(checkpointRes, 200, 'Checkpoint saved successfully');

    // -------------------------------------------------------------
    // Scenario 20: Existing seeded levels remain untouched
    // -------------------------------------------------------------
    console.log('\n--- Scenario 20: Seeded Levels Untouched ---');
    const totalLevels = await Level.countDocuments({ isActive: true });
    assert(totalLevels >= 50, `Seeded levels count intact (found ${totalLevels} active levels)`);

    console.log('\n=============================================================');
    console.log(
      `🎉 ALL TESTS PASSED: ${passedTests}/${totalTests} Passed (Failed: ${failedTests})`
    );
    console.log('=============================================================\n');
  } catch (err) {
    console.error('\n💥 Integration test encountered an error:', err.message);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Ephemeral server stopped.');
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }
  }
}

runEconomyTests();