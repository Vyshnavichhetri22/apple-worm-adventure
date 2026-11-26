import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import http from 'node:http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import app from './src/app.js';
import Level from './src/models/Level.js';
import { assertValidTestTarget } from './src/utils/validateTestTarget.js';

dotenv.config();

let server;
let baseUrl = '';

// Shared state between integration scenarios
let tokenUserA = '';
let userIdA = '';
let tokenUserB = '';
let userIdB = '';
let sessionAId = '';
let level1Doc = null;
let level2Doc = null;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Standard assertion helper.
 */
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

/**
 * Diagnostic HTTP response assertion helper.
 * Prints the actual HTTP status and formatted response body on failure.
 */
function assertResponse(res, expectedStatus, description) {
  totalTests++;
  if (res.status !== expectedStatus) {
    failedTests++;
    console.error(`  ❌ FAILED: ${description}`);
    console.error(`     Expected Status: ${expectedStatus}`);
    console.error(`     Actual Status:   ${res.status}`);
    console.error(
      `     Response Body:   ${JSON.stringify(res.body, null, 2)}`
    );
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

async function runAllTests(deps = {}) {
  console.log('\n=============================================================');
  console.log('🍎 APPLE WORM ADVENTURE — GAME SESSION INTEGRATION SUITE');
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
    console.log('Connecting to MongoDB test database...');
    await connectFn(testMongoUri);
    console.log('MongoDB Connected successfully.');

    // Launch ephemeral server instance on a random available port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Ephemeral API test server running at: ${baseUrl}\n`);

    const testEmailA = `session_test_a_${Date.now()}@example.com`;
    const testEmailB = `session_test_b_${Date.now()}@example.com`;

    // -------------------------------------------------------------
    // Scenario 1: User Registration and Token Acquisition
    // -------------------------------------------------------------
    console.log('--- Scenario 1: Register Two Test Users ---');
    const regResA = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `userA_${Date.now()}`,
        email: testEmailA,
        password: 'Password123!',
      }),
    });

    assertResponse(regResA, 201, 'User A registered successfully with status 201');
    assert(
      typeof regResA.body.token === 'string' && regResA.body.token.length > 0,
      'User A response contains a valid token string',
      regResA.body
    );
    assert(
      Boolean(regResA.body.user && (regResA.body.user._id || regResA.body.user.id)),
      'User A response contains user object with valid identifier',
      regResA.body
    );

    tokenUserA = regResA.body.token;
    userIdA = regResA.body.user._id || regResA.body.user.id;

    const regResB = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `userB_${Date.now()}`,
        email: testEmailB,
        password: 'Password123!',
      }),
    });

    assertResponse(regResB, 201, 'User B registered successfully with status 201');
    assert(
      typeof regResB.body.token === 'string' && regResB.body.token.length > 0,
      'User B response contains a valid token string',
      regResB.body
    );
    assert(
      Boolean(regResB.body.user && (regResB.body.user._id || regResB.body.user.id)),
      'User B response contains user object with valid identifier',
      regResB.body
    );

    tokenUserB = regResB.body.token;
    userIdB = regResB.body.user._id || regResB.body.user.id;

    // -------------------------------------------------------------
    // Scenario 2: Verify Level 1 and Level 2 in Database
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Verify Level 1 and Level 2 Existence ---');
    level1Doc = await Level.findOne({ levelNumber: 1, isActive: true });
    assert(level1Doc !== null, 'Level 1 is seeded and active');
    level2Doc = await Level.findOne({ levelNumber: 2, isActive: true });
    assert(level2Doc !== null, 'Level 2 is seeded and active');

    // -------------------------------------------------------------
    // Scenario 3: Start Game Session for Level 1
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Start Game Session on Level 1 ---');
    const startRes = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 1 }),
    });

    assertResponse(startRes, 201, 'Start Level 1 returned 201 Created');
    assert(startRes.body.data.status === 'ACTIVE', 'Session status is ACTIVE');
    assert(startRes.body.data.levelNumber === 1, 'Session levelNumber matches 1');
    assert(
      Array.isArray(startRes.body.data.initialState.worm) &&
        startRes.body.data.initialState.worm.length >= 2,
      'initialState.worm recorded properly'
    );
    sessionAId = startRes.body.data._id;

    // -------------------------------------------------------------
    // Scenario 4: Rejection on Locked Level
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Rejection When Starting Locked Level 5 ---');
    const lockedRes = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 5 }),
    });
    assertResponse(lockedRes, 403, 'Attempting Level 5 returned 403 Forbidden');
    assert(lockedRes.body.success === false, 'Locked response marks success: false');

    // -------------------------------------------------------------
    // Scenario 5: Fetch Active Session by ID
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Retrieve Active Session by ID ---');
    const getSessionRes = await apiRequest(`/api/games/${sessionAId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(getSessionRes, 200, 'Fetch session by ID returned 200 OK');
    assert(getSessionRes.body.data._id === sessionAId, 'Returned correct session ID');

    // -------------------------------------------------------------
    // Scenario 6: Rejection on Cross-User Session Access
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Cross-User Unauthorized Access Guard ---');
    const crossUserRes = await apiRequest(`/api/games/${sessionAId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserB}` },
    });
    assertResponse(crossUserRes, 403, 'User B accessing User A session returned 403 Forbidden');

    // -------------------------------------------------------------
    // Scenario 7: Save Valid Checkpoint
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Save Valid Checkpoint ---');
    const validCheckpointWorm = [
      {
        x: startRes.body.data.initialState.worm[0].x,
        y: startRes.body.data.initialState.worm[0].y,
      },
      {
        x: startRes.body.data.initialState.worm[1].x,
        y: startRes.body.data.initialState.worm[1].y,
      },
    ];

    const checkpointRes = await apiRequest(`/api/games/${sessionAId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 3,
        currentScore: 150,
        wormState: validCheckpointWorm,
      }),
    });
    assertResponse(checkpointRes, 200, 'Save valid checkpoint returned 200 OK');
    assert(checkpointRes.body.data.movesTaken === 3, 'Checkpoint recorded 3 moves');
    assert(checkpointRes.body.data.checkpointIndex === 1, 'checkpointIndex advanced to 1');

    // -------------------------------------------------------------
    // Scenario 8: Reject Checkpoint with Out-of-Bounds Coordinates
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Reject Out-of-Bounds Checkpoint ---');
    const oobRes = await apiRequest(`/api/games/${sessionAId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 4,
        currentScore: 200,
        wormState: [
          { x: -1, y: 0 },
          { x: 0, y: 0 },
        ],
      }),
    });
    assertResponse(oobRes, 400, 'Negative coordinate checkpoint rejected with 400');

    // -------------------------------------------------------------
    // Scenario 9: Reject Checkpoint with Regressive Move Count
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Reject Regressive Move Count Checkpoint ---');
    const regressiveRes = await apiRequest(`/api/games/${sessionAId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 1, // Current is 3
        currentScore: 100,
        wormState: validCheckpointWorm,
      }),
    });
    assertResponse(regressiveRes, 400, 'Regressive moves (1 < 3) rejected with 400');

    // -------------------------------------------------------------
    // Scenario 10: Fail Session with Valid Reason
    // -------------------------------------------------------------
    console.log('\n--- Scenario 10: Fail Session With OUT_OF_MOVES ---');
    const failRes = await apiRequest(`/api/games/${sessionAId}/fail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        failureReason: 'OUT_OF_MOVES',
        moves: 15,
        durationSeconds: 22,
      }),
    });
    assertResponse(failRes, 200, 'Fail session returned 200 OK');
    assert(failRes.body.data.status === 'FAILED', 'Session status updated to FAILED');
    assert(failRes.body.data.failureReason === 'OUT_OF_MOVES', 'failureReason recorded properly');

    // -------------------------------------------------------------
    // Scenario 11: Reject Checkpoint on FAILED Session
    // -------------------------------------------------------------
    console.log('\n--- Scenario 11: Reject Checkpoint on Non-Active Session ---');
    const deadCheckpointRes = await apiRequest(`/api/games/${sessionAId}/checkpoint`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        movesTaken: 5,
        currentScore: 200,
        wormState: validCheckpointWorm,
      }),
    });
    assertResponse(deadCheckpointRes, 400, 'Checkpoint on FAILED session rejected with 400');

    // -------------------------------------------------------------
    // Scenario 12: Start Fresh Session and Complete Successfully
    // -------------------------------------------------------------
    console.log('\n--- Scenario 12: Start Fresh Session & Complete Level 1 ---');
    const freshStartRes = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 1 }),
    });
    assertResponse(freshStartRes, 201, 'Fresh session started on Level 1');
    const freshSessionId = freshStartRes.body.data._id;

    const threeStarTarget =
      level1Doc.starThresholds?.threeStars || level1Doc.starThresholds?.threeStar || 8;
    const completionMoves = Math.min(threeStarTarget, level1Doc.moveLimit);

    const completeRes = await apiRequest(`/api/games/${freshSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: completionMoves,
        durationSeconds: 12,
        applesCollected: level1Doc.apples?.length || 0,
      }),
    });
    assertResponse(completeRes, 200, 'Completion returned 200 OK');
    assert(completeRes.body.data.session.status === 'COMPLETED', 'Session marked COMPLETED');
    assert(completeRes.body.data.rewards.stars === 3, 'Calculated 3 stars server-side');
    assert(completeRes.body.data.rewards.coins > 0, 'Authoritative coins granted');
    assert(completeRes.body.data.unlockedLevel >= 2, 'Level 2 unlocked in response');

    // -------------------------------------------------------------
    // Scenario 13: Idempotent Completion Protection
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13: Idempotency Protection on Completion ---');
    const duplicateCompleteRes = await apiRequest(`/api/games/${freshSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: completionMoves,
        durationSeconds: 15,
      }),
    });
    assertResponse(
      duplicateCompleteRes,
      400,
      'Double completion rejected with 400 Bad Request'
    );

    // -------------------------------------------------------------
    // Scenario 14: Anti-Cheat Move Limit Violation Rejection
    // -------------------------------------------------------------
    console.log('\n--- Scenario 14: Anti-Cheat Move Limit Enforcement ---');
    const sessionForCheat = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 1 }),
    });
    const cheatSessionId = sessionForCheat.body.data._id;

    const cheatMovesRes = await apiRequest(`/api/games/${cheatSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: level1Doc.moveLimit + 10,
        durationSeconds: 30,
      }),
    });
    assertResponse(cheatMovesRes, 400, 'Moves exceeding limit rejected with 400');
    assert(cheatMovesRes.body.message.includes('Anti-cheat'), 'Anti-cheat error message returned');

    // -------------------------------------------------------------
    // Scenario 15: Anti-Cheat Impossibly Fast Duration Rejection
    // -------------------------------------------------------------
    console.log('\n--- Scenario 15: Anti-Cheat Minimum Duration Enforcement ---');
    const cheatSpeedRes = await apiRequest(`/api/games/${cheatSessionId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({
        moves: 20,
        durationSeconds: 0,
      }),
    });
    assertResponse(cheatSpeedRes, 400, '0 second duration rejected with 400');

    // -------------------------------------------------------------
    // Scenario 16: Verify Updated Player Progress & Level 2 Access
    // -------------------------------------------------------------
    console.log('\n--- Scenario 16: Verify Player Progress & Level 2 Start ---');
    const progressRes = await apiRequest('/api/games/progress', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(progressRes, 200, 'Get player progress returned 200 OK');
    assert(progressRes.body.data.highestUnlockedLevel >= 2, 'highestUnlockedLevel is >= 2');
    assert(progressRes.body.data.completedLevels.length >= 1, 'completedLevels records Level 1');

    const startLevel2Res = await apiRequest('/api/games/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenUserA}` },
      body: JSON.stringify({ levelNumber: 2 }),
    });
    assertResponse(startLevel2Res, 201, 'Level 2 now starts successfully with status 201');

    // -------------------------------------------------------------
    // Scenario 17: Retrieve Paginated Player History
    // -------------------------------------------------------------
    console.log('\n--- Scenario 17: Retrieve Paginated Player History ---');
    const historyRes = await apiRequest('/api/games/history?page=1&limit=5', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenUserA}` },
    });
    assertResponse(historyRes, 200, 'Get history returned 200 OK');
    assert(Array.isArray(historyRes.body.data), 'History returned data array');
    assert(historyRes.body.data.length > 0, 'History contains completed and failed sessions');
    assert(historyRes.body.pagination.total >= 3, 'Pagination metadata matches total records');

    console.log('\n=============================================================');
    console.log(
      `🎉 INTEGRATION SUITE COMPLETED: ${passedTests}/${totalTests} Passed (Failed: ${failedTests})`
    );
    console.log('=============================================================\n');
  } catch (err) {
    console.error('\n💥 Integration test execution encountered an error:', err.message);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Ephemeral server terminated.');
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB disconnected.');
    }
  }
}

export { runAllTests };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('test-game-session-api.js') || process.argv[1].endsWith('test-game-session-api'));

if (isMain) {
  runAllTests().catch((err) => {
    console.error('\n💥 Critical Database Safety Abort:', err.message);
    process.exit(1);
  });
}