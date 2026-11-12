import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import app from './src/app.js';
import User from './src/models/User.js';
import Level from './src/models/Level.js';
import GameSession from './src/models/GameSession.js';
import PlayerProgress from './src/models/PlayerProgress.js';
import Wallet from './src/models/Wallet.js';
import WalletTransaction from './src/models/WalletTransaction.js';
import EconomyConfig from './src/models/EconomyConfig.js';
import AdOpportunity from './src/models/AdOpportunity.js';
import AdQuotaReservation from './src/models/AdQuotaReservation.js';
import adProviderService from './src/services/adProviderService.js';
import rewardedAdService from './src/services/rewardedAdService.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';

let server;
let baseUrl = '';

let tokenUserA = '';
let userIdA = '';
let tokenUserB = '';
let userIdB = '';

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
  let data = null;
  try {
    data = await response.json();
  } catch (_e) {
    data = null;
  }
  return { status: response.status, body: data };
}

async function runRewardedAdTests() {
  console.log('\n===============================================================');
  console.log('   VELOOP REWARDS — PHASE 2: REWARDED ADS INTEGRATION SUITE');
  console.log('===============================================================\n');

  // Compact 12-character run identifier keeping usernames strictly <= 30 chars
  const runTimestamp = Date.now().toString().slice(-6);
  const runRandomHex = crypto.randomBytes(3).toString('hex');
  const runId = `${runTimestamp}${runRandomHex}`; // 12 chars

  const usernameA = `ad_user_a_${runId}`; // 10 + 12 = 22 chars (valid 3-30 chars)
  const usernameB = `ad_user_b_${runId}`; // 10 + 12 = 22 chars (valid 3-30 chars)
  const emailA = `ad_a_${runId}@example.com`;
  const emailB = `ad_b_${runId}@example.com`;

  const txMockValid1 = `tx_mock_valid_${runId}`;

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB successfully.');

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Test server running at ${baseUrl}\n`);

    // Ensure Economy Config exists with test rules
    const economy = await EconomyConfig.getActiveConfig();
    economy.rules.adLimits = {
      maxAdsPerSession: 3,
      maxAdsPerHour: 6,
      maxAdsPerDay: 20,
      minSecondsBetweenAds: 2, // 2s for fast testing
      maxRevivesPerSession: 1,
      maxCoinRewardCap: 100,
      baseCoinReward: 25,
      extraMovesReward: 5,
    };
    await economy.save();

    // Register User A with strict validation and error diagnostics
    console.log('--- Registering Test User A ---');
    const regA = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameA,
        email: emailA,
        password: 'Password123!',
      }),
    });
    assert(
      regA.status === 201 && regA.body?.token && (regA.body?.user?._id || regA.body?.user?.id),
      'User A registered successfully with 201 Created and valid credentials',
      `HTTP ${regA.status}: ${regA.body?.message || JSON.stringify(regA.body)}`
    );
    tokenUserA = regA.body.token;
    userIdA = regA.body.user._id || regA.body.user.id;

    // Register User B with strict validation and error diagnostics
    console.log('--- Registering Test User B ---');
    const regB = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameB,
        email: emailB,
        password: 'Password123!',
      }),
    });
    assert(
      regB.status === 201 && regB.body?.token && (regB.body?.user?._id || regB.body?.user?.id),
      'User B registered successfully with 201 Created and valid credentials',
      `HTTP ${regB.status}: ${regB.body?.message || JSON.stringify(regB.body)}`
    );
    tokenUserB = regB.body.token;
    userIdB = regB.body.user._id || regB.body.user.id;

    // SCENARIO 1: Economy Configuration Defaults Verified
    console.log('\n--- Scenario 1: Economy Configuration Defaults ---');
    assert(economy.rules.adLimits.maxAdsPerHour === 6, 'maxAdsPerHour configured to 6');
    assert(economy.rules.adLimits.maxAdsPerDay === 20, 'maxAdsPerDay configured to 20');
    assert(economy.rules.adLimits.baseCoinReward === 25, 'baseCoinReward configured to 25');

    // SCENARIO 2: Non-authenticated Request Rejection
    console.log('\n--- Scenario 2: Unauthenticated Request Rejection ---');
    const unauthRes = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    assertResponse(unauthRes, 401, 'Unauthenticated opportunity request rejected with 401');

    // SCENARIO 3: Opportunity Creation for STORE_FREE_COINS
    console.log('\n--- Scenario 3: Valid STORE_FREE_COINS Opportunity Creation ---');
    const oppRes1 = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    assertResponse(oppRes1, 201, 'Opportunity creation returns 201 Created');
    const opp1 = oppRes1.body.data;
    assert(opp1.opportunityId, 'Returns opportunityId');
    assert(opp1.rewardType === 'COIN_REWARD', 'rewardType mapped to COIN_REWARD');
    assert(opp1.rewardAmount === 25, 'rewardAmount matches baseCoinReward (25)');

    // SCENARIO 4: Cryptographic customDataNonce Uniqueness
    console.log('\n--- Scenario 4: Cryptographic Nonce Uniqueness ---');
    assert(typeof opp1.customDataNonce === 'string' && opp1.customDataNonce.length >= 32, 'Nonce is 32-char hex string');
    assert(opp1.customData === `${opp1.opportunityId}:${opp1.customDataNonce}`, 'customData format matches opportunityId:nonce');

    // SCENARIO 5: Player Ad Playback Start Notification
    console.log('\n--- Scenario 5: Player Ad Playback Start ---');
    const startRes = await apiRequest('/api/ads/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ opportunityId: opp1.opportunityId }),
    });
    assertResponse(startRes, 200, 'Start ad notification returns 200 OK');
    assert(startRes.body.data.status === 'AD_STARTED', 'Opportunity status transitions to AD_STARTED');

    // SCENARIO 6: Mock Callback Rejection on Invalid Secret
    console.log('\n--- Scenario 6: Mock Callback Secret Enforcement ---');
    const invalidMock = await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'wrong_secret' },
      body: JSON.stringify({ custom_data: opp1.customData, transaction_id: `tx_mock_invalid_${runId}` }),
    });
    assertResponse(invalidMock, 403, 'Mock callback with wrong secret rejected with 403');

    // SCENARIO 7: Valid Mock Callback and Complete Reward Grant Verification
    console.log('\n--- Scenario 7: Valid Mock SSV Callback and Reward Grant ---');
    const validMock = await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: opp1.customData, transaction_id: txMockValid1 }),
    });
    assertResponse(validMock, 200, 'Mock callback returns 200 OK');
    assert(validMock.body.data.status === 'GRANTED', 'Opportunity successfully granted');

    // 1. Verify wallet balance via GET /api/wallet (res.body.data.balance)
    const walletResA = await apiRequest('/api/wallet', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(walletResA, 200, 'GET /api/wallet returns 200 OK');
    assert(walletResA.body.data.balance === 25, 'User A wallet balance via API is 25');

    // 2. Verify persisted wallet document in MongoDB
    const persistedWalletA = await Wallet.findOne({ userId: userIdA });
    assert(persistedWalletA !== null, 'Wallet document exists in database for User A');
    assert(persistedWalletA.balance === 25, 'Persisted wallet balance in MongoDB is 25');

    // 3. Verify ledger transaction directly in MongoDB
    const adTxA = await WalletTransaction.findOne({
      userId: userIdA,
      idempotencyKey: `ad_reward_${opp1.opportunityId}`,
    });
    assert(adTxA !== null, 'Ledger recorded AD_REWARD transaction with deterministic idempotencyKey');
    assert(adTxA.type === 'AD_REWARD', 'Transaction type in ledger is AD_REWARD');
    assert(adTxA.direction === 'CREDIT', 'Transaction direction in ledger is CREDIT');
    assert(adTxA.amount === 25, 'Transaction amount in ledger is 25');
    assert(adTxA.balanceBefore === 0, 'Transaction balanceBefore in ledger is 0');
    assert(adTxA.balanceAfter === 25, 'Transaction balanceAfter in ledger is 25');
    assert(adTxA.referenceId === opp1.opportunityId.toString(), 'Transaction referenceId matches opportunityId');

    // 4. Verify transaction history via GET /api/wallet/transactions
    const txHistoryRes = await apiRequest('/api/wallet/transactions', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(txHistoryRes, 200, 'GET /api/wallet/transactions returns 200 OK');
    assert(Array.isArray(txHistoryRes.body.data), 'Transactions data is an array');
    const adTxFromApi = txHistoryRes.body.data.find(
      (tx) => tx.idempotencyKey === `ad_reward_${opp1.opportunityId}`
    );
    assert(adTxFromApi !== undefined, 'AD_REWARD transaction present in user transaction history');
    assert(adTxFromApi.amount === 25, 'AD_REWARD transaction amount in history is 25');

    // 5. Verify User.coins synchronized
    const userADoc = await User.findById(userIdA).lean();
    assert(userADoc.coins === 25, 'User.coins automatically synchronized to 25');

    // SCENARIO 8: Opportunity Polling Returns GRANTED
    console.log('\n--- Scenario 8: Player Polling Endpoint ---');
    const statusRes = await apiRequest(`/api/ads/status/${opp1.opportunityId}`, {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(statusRes, 200, 'Polling returns 200 OK');
    assert(statusRes.body.data.status === 'GRANTED', 'Polling status reflects GRANTED');

    // SCENARIO 9: Quota Enforcement — Minimum Cooldown Rejection
    console.log('\n--- Scenario 9: Cooldown Quota Enforcement ---');
    const immediateReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    assertResponse(immediateReq, 429, 'Immediate second opportunity rejected with HTTP 429 cooldown active');

    // Wait 2.2 seconds for cooldown to expire
    await new Promise((r) => setTimeout(r, 2200));

    // SCENARIO 10: Quota Enforcement — Hourly Limit Rejection
    console.log('\n--- Scenario 10: Hourly Limit Quota Enforcement ---');
    // Artificially populate reservations to hit hourly cap (6)
    const quotaDoc = await AdQuotaReservation.findOne({ userId: userIdA });
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      quotaDoc.reservations.push({
        opportunityId: new mongoose.Types.ObjectId(),
        rewardType: 'COIN_REWARD',
        createdAt: now,
      });
    }
    quotaDoc.lastRequestedAt = new Date(Date.now() - 3000); // clear cooldown
    await quotaDoc.save();

    const hourlyExceeded = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    assertResponse(hourlyExceeded, 429, 'Hourly limit exceeded returns HTTP 429');
    assert(hourlyExceeded.body.message.includes('Hourly ad limit reached'), 'Clear hourly diagnostic message');

    // Reset quota reservations for User A
    await AdQuotaReservation.deleteOne({ userId: userIdA });

    // SCENARIO 11: Duplicate Callback Idempotency (Same transaction_id + Same opportunity)
    console.log('\n--- Scenario 11: Duplicate Callback Idempotency ---');
    const duplicateMock = await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: opp1.customData, transaction_id: txMockValid1 }),
    });
    assertResponse(duplicateMock, 200, 'Duplicate callback with same transaction ID returns 200 OK');
    assert(duplicateMock.body.data.alreadyProcessed === true, 'Response flags alreadyProcessed');

    // Verify wallet balance did NOT increase again via API
    const walletAfterDuplicate = await apiRequest('/api/wallet', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assert(
      walletAfterDuplicate.body.data.balance === 25,
      'Wallet balance remained 25 via API (no double credit)'
    );

    // Verify persisted MongoDB wallet balance remained unchanged
    const persistedWalletAfterDup = await Wallet.findOne({ userId: userIdA });
    assert(
      persistedWalletAfterDup.balance === 25,
      'Persisted MongoDB wallet balance remained 25 after duplicate callback'
    );

    // Verify ledger transaction count for this opportunity remains exactly 1
    const adTxCount = await WalletTransaction.countDocuments({
      userId: userIdA,
      idempotencyKey: `ad_reward_${opp1.opportunityId}`,
    });
    assert(
      adTxCount === 1,
      'Exactly 1 ledger entry exists for this opportunity despite duplicate callback'
    );

    // Verify User.coins still 25
    const userADocAfterDup = await User.findById(userIdA).lean();
    assert(userADocAfterDup.coins === 25, 'User.coins remained 25 after duplicate callback');

    // SCENARIO 12: Conflicting Transaction Replay Attack (Same transaction_id + Different opportunity)
    console.log('\n--- Scenario 12: Conflicting Transaction ID Replay Protection ---');
    await new Promise((r) => setTimeout(r, 2200));
    const oppRes2 = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    const opp2 = oppRes2.body.data;

    const conflictMock = await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: opp2.customData, transaction_id: txMockValid1 }),
    });
    assertResponse(conflictMock, 409, 'Reusing existing transaction_id for different opportunity rejected with 409 Conflict');

    // SCENARIO 13: Revive Placement Rejected on ACTIVE Session
    console.log('\n--- Scenario 13: Revive Placement Validation on ACTIVE Session ---');
    const startSessionRes = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 1 }),
    });
    assert(
      startSessionRes.status === 201 && (startSessionRes.body?.data?._id || startSessionRes.body?.session?._id),
      'Game session started successfully on Level 1 with status 201',
      `HTTP ${startSessionRes.status}: ${startSessionRes.body?.message || JSON.stringify(startSessionRes.body)}`
    );
    const activeSessionId = startSessionRes.body.data?._id || startSessionRes.body.session?._id;
    const safeWorm = startSessionRes.body.data?.initialState?.worm || [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ];

    await new Promise((r) => setTimeout(r, 2200));
    const invalidReviveReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'GAME_OVER_REVIVE', sessionId: activeSessionId }),
    });
    assertResponse(invalidReviveReq, 400, 'Requesting REVIVE on an ACTIVE session rejected with 400');

    // SCENARIO 14: Revive Placement on FAILED Session Restores ACTIVE
    console.log('\n--- Scenario 14: Revive Execution on FAILED Session ---');
    await apiRequest(`/api/games/${activeSessionId}/fail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ failureReason: 'OUT_OF_MOVES' }),
    });

    await new Promise((r) => setTimeout(r, 2200));
    const validReviveReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'GAME_OVER_REVIVE', sessionId: activeSessionId }),
    });
    assertResponse(validReviveReq, 201, 'Revive opportunity created for FAILED session');
    const reviveOpp = validReviveReq.body.data;

    const grantRevive = await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: reviveOpp.customData, transaction_id: `tx_revive_${runId}` }),
    });
    assertResponse(grantRevive, 200, 'Revive callback processed');

    const revivedSession = await GameSession.findById(activeSessionId);
    assert(revivedSession.status === 'ACTIVE', 'Session status restored to ACTIVE');
    assert(revivedSession.revivesUsed === 1, 'revivesUsed incremented to 1');
    assert(revivedSession.failureReason === null, 'failureReason reset to null');

    // SCENARIO 15: Extra Moves Placement and Move Limits Extension
    console.log('\n--- Scenario 15: Extra Moves Placement & Checkpoint Validation ---');

    // 1. Cross-user session security: User B cannot request extra moves for User A's session
    const crossUserExtraReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserB}` },
      body: JSON.stringify({ placement: 'MOVE_EXHAUSTED_EXTRA', sessionId: activeSessionId }),
    });
    assertResponse(crossUserExtraReq, 403, 'Cross-user extra moves request rejected with 403 Forbidden');

    // 2. Request and grant EXTRA_MOVES (+5 moves)
    await new Promise((r) => setTimeout(r, 2200));
    const extraMovesReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'MOVE_EXHAUSTED_EXTRA', sessionId: activeSessionId }),
    });
    assertResponse(extraMovesReq, 201, 'EXTRA_MOVES opportunity created');
    const extraOpp = extraMovesReq.body.data;

    await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: extraOpp.customData, transaction_id: `tx_extra_${runId}` }),
    });

    const extendedSession = await GameSession.findById(activeSessionId);
    assert(extendedSession.extraMovesAllowed === 5, 'extraMovesAllowed set to 5 on session');

    // Retrieve Level 1 baseline move limit
    const level1Doc = await Level.findOne({ levelNumber: 1, isActive: true });
    const baseMoveLimit = level1Doc ? level1Doc.moveLimit : 20;
    const extendedMoveLimit = baseMoveLimit + 5;

    // 3. Checkpoint within original move limit (e.g., 3 moves) is accepted via PUT
    const chkWithinOriginal = await apiRequest(`/api/games/${activeSessionId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 3,
        currentScore: 50,
        wormState: safeWorm,
      }),
    });
    assertResponse(chkWithinOriginal, 200, 'Checkpoint within original move limit accepted via PUT');

    // 4. Checkpoint exceeding the extended limit (baseMoveLimit + 6) is rejected with 400
    const chkExceedingExtended = await apiRequest(`/api/games/${activeSessionId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: extendedMoveLimit + 1,
        currentScore: 100,
        wormState: safeWorm,
      }),
    });
    assertResponse(chkExceedingExtended, 400, 'Checkpoint exceeding extended move limit rejected with 400');

    // 5. Checkpoint exceeding original limit but within extended limit is accepted via PUT
    const chkWithinExtended = await apiRequest(`/api/games/${activeSessionId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: baseMoveLimit + 2,
        currentScore: 100,
        wormState: safeWorm,
      }),
    });
    assertResponse(chkWithinExtended, 200, 'Checkpoint exceeding original limit but within extended limit accepted');

    // 6. Anti-cheat completion check: completion exceeding extended limit is rejected with 400
    const completeExceedingLimit = await apiRequest(`/api/games/${activeSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: extendedMoveLimit + 5,
        durationSeconds: 10,
        applesCollected: 1,
      }),
    });
    assertResponse(completeExceedingLimit, 400, 'Completion exceeding extended move limit rejected with 400');

    // SCENARIO 16: Booster Placement Adds to availableBoosters
    console.log('\n--- Scenario 16: Booster Placement State Separation ---');
    await new Promise((r) => setTimeout(r, 2200));
    const boosterReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        placement: 'SESSION_BOOSTER',
        sessionId: activeSessionId,
        boosterType: 'FREEZE',
      }),
    });
    const boosterOpp = boosterReq.body.data;

    await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: boosterOpp.customData, transaction_id: `tx_booster_${runId}` }),
    });

    const boosterSession = await GameSession.findById(activeSessionId);
    assert(boosterSession.availableBoosters.includes('FREEZE'), 'FREEZE booster appended to availableBoosters');
    assert(boosterSession.boostersUsed.length === 0, 'boostersUsed remains empty and uncontaminated');

    // SCENARIO 17: Complete Session and Test POST_WIN_DOUBLE_COIN
    console.log('\n--- Scenario 17: Post-Win Double Coins Execution ---');
    const completeRes = await apiRequest(`/api/games/${activeSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ moves: 12, durationSeconds: 5, applesCollected: 1 }),
    });
    assert(
      completeRes.status === 200 &&
        (completeRes.body?.data?.rewards?.coins !== undefined ||
          completeRes.body?.rewards?.coins !== undefined),
      'Session completed successfully and returned authoritative rewards',
      `HTTP ${completeRes.status}: ${completeRes.body?.message || JSON.stringify(completeRes.body)}`
    );
    const initialCoinsEarned =
      completeRes.body.data?.rewards?.coins ?? completeRes.body.rewards?.coins ?? 45;

    // Reset quota reservations for User A to isolate post-win testing
    await AdQuotaReservation.deleteOne({ userId: userIdA });

    await new Promise((r) => setTimeout(r, 2200));
    const dblCoinReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'POST_WIN_DOUBLE_COIN', sessionId: activeSessionId }),
    });
    const dblCoinOpp = dblCoinReq.body.data;

    await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: dblCoinOpp.customData, transaction_id: `tx_dbl_coin_${runId}` }),
    });

    const dblCoinSession = await GameSession.findById(activeSessionId);
    assert(dblCoinSession.coinsEarned === initialCoinsEarned * 2, 'session.coinsEarned is doubled');

    // Verify wallet balance reflects initial ad (25) + session reward + doubled coins bonus
    const dblCoinWalletRes = await apiRequest('/api/wallet', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    const expectedDblBalance = 25 + initialCoinsEarned + initialCoinsEarned;
    assert(
      dblCoinWalletRes.body.data.balance === expectedDblBalance,
      `User A wallet credited with double coins bonus (expected: ${expectedDblBalance}, actual: ${dblCoinWalletRes.body.data.balance})`
    );

    // Verify ledger has AD_REWARD entry for double coins
    const dblCoinTx = await WalletTransaction.findOne({
      userId: userIdA,
      idempotencyKey: `ad_reward_double_coins_${dblCoinOpp.opportunityId}`,
    });
    assert(dblCoinTx !== null, 'DOUBLE_COINS ledger transaction recorded');
    assert(dblCoinTx.type === 'AD_REWARD', 'DOUBLE_COINS transaction type is AD_REWARD');
    assert(dblCoinTx.amount === initialCoinsEarned, 'DOUBLE_COINS transaction amount matches bonus coins');

    // SCENARIO 18: POST_WIN_DOUBLE_SCORE Execution
    console.log('\n--- Scenario 18: Post-Win Double Score Execution ---');
    const initialScore = dblCoinSession.score;

    await new Promise((r) => setTimeout(r, 2200));
    const dblScoreReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'POST_WIN_DOUBLE_SCORE', sessionId: activeSessionId }),
    });
    const dblScoreOpp = dblScoreReq.body.data;

    await apiRequest('/api/ads/callback/mock', {
      method: 'POST',
      headers: { 'X-Mock-Provider-Secret': 'test_mock_ssv_secret_dev' },
      body: JSON.stringify({ custom_data: dblScoreOpp.customData, transaction_id: `tx_dbl_score_${runId}` }),
    });

    const dblScoreSession = await GameSession.findById(activeSessionId);
    assert(dblScoreSession.score === initialScore * 2, 'session.score is doubled');

    const progressA = await PlayerProgress.findOne({ userId: userIdA });
    const lvl1Rec = progressA.completedLevels.find((c) => c.levelNumber === 1);
    assert(lvl1Rec.highScore === initialScore * 2, 'PlayerProgress highScore updated to doubled score');

    // SCENARIO 19: Safeguard 2 — Strict DOUBLE_SCORE Idempotency
    console.log('\n--- Scenario 19: Safeguard 2 — DOUBLE_SCORE Idempotency ---');
    // Direct attempt to grant again with same opportunity
    const replayGrant = await rewardedAdService.executeRewardHandler(
      await AdOpportunity.findById(dblScoreOpp.opportunityId)
    );
    assert(replayGrant.alreadyApplied === true, 'Replay grant flagged as alreadyApplied');
    const idempotentSession = await GameSession.findById(activeSessionId);
    assert(idempotentSession.score === initialScore * 2, 'Score was not doubled a second time');

    // SCENARIO 20: Safeguard 3 — Safe GRANTING Lease and Concurrent Collision Protection
    console.log('\n--- Scenario 20: Safeguard 3 — Safe Lease Locking ---');
    await AdQuotaReservation.deleteOne({ userId: userIdA });

    await new Promise((r) => setTimeout(r, 2200));
    const leaseOppReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    const leaseOppId = leaseOppReq.body.data.opportunityId;

    // Put into GRANTING state with active lease (30s)
    await AdOpportunity.findByIdAndUpdate(leaseOppId, {
      status: 'GRANTING',
      grantId: 'active_worker_grant_id',
      grantLockExpiresAt: new Date(Date.now() + 30000),
    });

    // Attempting to grant must fail due to active lease
    let leaseConflictThrew = false;
    try {
      await rewardedAdService.grantReward(leaseOppId);
    } catch (e) {
      leaseConflictThrew = true;
      assert(e.statusCode === 409, 'Concurrent grant rejected with 409 Conflict');
    }
    assert(leaseConflictThrew, 'Lease protected active grant from concurrent interference');

    // SCENARIO 21: Safeguard 3 — Stale Grant Recovery after Lease Expiry
    console.log('\n--- Scenario 21: Safeguard 3 — Expired Lease Recovery ---');
    // Fast-forward lease expiry to the past
    await AdOpportunity.findByIdAndUpdate(leaseOppId, {
      grantLockExpiresAt: new Date(Date.now() - 5000),
    });

    const recoveryResults = await rewardedAdService.recoverStaleGrants();
    assert(recoveryResults.length >= 1, 'Recovery worker found and claimed expired lease');
    assert(recoveryResults[0].recovered === true, 'Stale grant recovered and granted successfully');

    const recoveredDoc = await AdOpportunity.findById(leaseOppId);
    assert(recoveredDoc.status === 'GRANTED', 'Recovered opportunity is GRANTED');

    // SCENARIO 22: Google AdMob Raw Query SSV Signature Verification
    console.log('\n--- Scenario 22: AdMob Raw Query ECDSA Verification ---');
    await AdQuotaReservation.deleteOne({ userId: userIdA });

    // Generate an in-memory EC P-256 key pair to test raw verification without external network
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const testKeyId = '99998888';
    adProviderService.registerTestKey(testKeyId, publicKey);

    await new Promise((r) => setTimeout(r, 2200));
    const admobOppReq = await apiRequest('/api/ads/opportunity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
    });
    const admobOpp = admobOppReq.body.data;

    const admobTxId = `admob_tx_${runId}`;
    const rawMessage = `ad_network=5450213213286189855&ad_unit=12345678&custom_data=${encodeURIComponent(
      admobOpp.customData
    )}&key_id=${testKeyId}&transaction_id=${admobTxId}`;

    const signer = crypto.createSign('SHA256');
    signer.update(Buffer.from(rawMessage, 'utf8'));
    const sigBase64 = signer.sign(privateKey, 'base64');
    const webSafeSig = sigBase64.replace(/\+/g, '-').replace(/\//g, '_');

    const rawAdMobUrl = `/api/ads/callback/admob?${rawMessage}&signature=${encodeURIComponent(webSafeSig)}`;
    const admobCallbackRes = await apiRequest(rawAdMobUrl);
    assertResponse(admobCallbackRes, 200, 'Raw query AdMob SSV callback verified and returns 200 OK');

    const admobGrantedDoc = await AdOpportunity.findById(admobOpp.opportunityId);
    assert(admobGrantedDoc.status === 'GRANTED', 'AdMob opportunity transitioned to GRANTED');

    // SCENARIO 23: AdMob Modified Raw Query Parameter Rejection
    console.log('\n--- Scenario 23: AdMob Tampered Query Rejection ---');
    const tamperedUrl = `/api/ads/callback/admob?${rawMessage}_tampered&signature=${encodeURIComponent(webSafeSig)}`;
    const tamperedRes = await apiRequest(tamperedUrl);
    assertResponse(tamperedRes, 400, 'Tampered query string rejected by ECDSA verifier');

    // SCENARIO 24: Quota Safeguard — Parallel Concurrent Request Race Condition Safety
    console.log('\n--- Scenario 24: Atomic Quota Race Condition Protection ---');
    // Clear reservations for User B
    await AdQuotaReservation.deleteOne({ userId: userIdB });

    // Fire 5 concurrent requests simultaneously for User B
    const parallelPromises = Array.from({ length: 5 }).map(() =>
      apiRequest('/api/ads/opportunity', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenUserB}` },
        body: JSON.stringify({ placement: 'STORE_FREE_COINS' }),
      })
    );

    const parallelResults = await Promise.all(parallelPromises);
    const successes = parallelResults.filter((r) => r.status === 201);
    const rateLimited = parallelResults.filter((r) => r.status === 429);

    assert(successes.length === 1, 'Exactly one concurrent request succeeded');
    assert(rateLimited.length === 4, 'Remaining 4 concurrent requests safely rejected with 429');

    // SCENARIO 25: Existing Game Session & Wallet APIs Unbroken
    console.log('\n--- Scenario 25: Existing Systems Regression Check ---');
    const sessionHistory = await apiRequest('/api/games/history', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(sessionHistory, 200, 'Game session history API functional');

    const walletHistory = await apiRequest('/api/wallet/transactions', {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(walletHistory, 200, 'Wallet transaction history API functional');

    adProviderService.clearTestKeys();

    console.log('\n===============================================================');
    console.log(`  ALL ${totalTests} TESTS PASSED! (${passedTests} passed, ${failedTests} failed)`);
    console.log('===============================================================\n');
  } catch (error) {
    console.error('\n❌ TEST RUN ABORTED DUE TO ERROR:\n', error);
  } finally {
    if (userIdA || userIdB) {
      try {
        const testUserIds = [userIdA, userIdB].filter(Boolean);
        // Clean up only mutable test-owned documents.
        // WalletTransaction is intentionally excluded as it is an immutable append-only ledger by design.
        await AdOpportunity.deleteMany({ userId: { $in: testUserIds } });
        await AdQuotaReservation.deleteMany({ userId: { $in: testUserIds } });
        await GameSession.deleteMany({ userId: { $in: testUserIds } });
        await PlayerProgress.deleteMany({ userId: { $in: testUserIds } });
        await Wallet.deleteMany({ userId: { $in: testUserIds } });
        await User.deleteMany({ _id: { $in: testUserIds } });
      } catch (cleanupErr) {
        console.warn('Warning during test cleanup:', cleanupErr.message);
      }
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  }
}

runRewardedAdTests();