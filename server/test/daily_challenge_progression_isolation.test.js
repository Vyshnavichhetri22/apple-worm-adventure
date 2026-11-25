/**
 * server/test/daily_challenge_progression_isolation.test.js
 *
 * Comprehensive regression tests verifying that Daily Challenge completion
 * is strictly isolated from normal campaign level progression:
 *
 * 1. Progression Isolation:
 *    - New player completes Level 1 -> highestUnlockedLevel becomes 2.
 *    - Completing Daily Challenge (Level 17) must NOT unlock campaign Levels 2-18.
 *    - highestUnlockedLevel remains 2; completedLevels contains only [1].
 *    - Daily streak increments (0 -> 1) and +150 coins credited as DAILY_REWARD.
 *    - Campaign Level 17 base completion reward remains unconsumed.
 *
 * 2. Campaign Progression Continuity:
 *    - Campaign Level 2 is playable and can be completed normally.
 *    - Completing campaign Level 2 advances highestUnlockedLevel to 3.
 *
 * 3. Re-completion / Idempotency / Reconciliation:
 *    - Same-day Daily Challenge completion does not alter campaign unlock state.
 *    - Replay/reconciliation of completed daily challenge does not advance campaign levels.
 *
 * 4. Dual Endpoint Support:
 *    - Completion via POST /api/daily-challenge/complete isolates progression.
 *    - Completion via standard POST /api/games/complete also isolates progression.
 *
 * 5. Server-Side Security & Anti-Spoofing:
 *    - POST /api/games/start with client-forged isDailyChallenge is forced to false and fails with 403 on locked levels.
 *    - POST /api/daily-challenge/complete rejects normal campaign sessions with 400.
 *
 * 6. Existing Progression Preservation:
 *    - Player with existing campaign progress (e.g. Level 5) is preserved untouched when completing Daily Challenge.
 *
 * 7. Leaderboard & Achievement Integrity:
 *    - Achievements (e.g. LEVEL_EXPLORER) and Leaderboards reflect authentic campaign progression.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from '../src/app.js';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import GameSession from '../src/models/GameSession.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import DailyChallengeCompletion from '../src/models/DailyChallengeCompletion.js';
import PlayerDailyStreak from '../src/models/PlayerDailyStreak.js';
import walletService from '../src/services/walletService.js';
import dailyChallengeService, { getUTCDateString } from '../src/services/dailyChallengeService.js';
import gameSessionService from '../src/services/gameSessionService.js';
import achievementService from '../src/services/achievementService.js';
import leaderboardService from '../src/services/leaderboardService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Daily Challenge Progression Isolation Regression Suite', () => {
  let server;
  let baseUrl;
  let testUser;
  let existingUser;
  let authHeaderTestUser;
  let authHeaderExistingUser;

  let level1;
  let level2;
  let level17;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean test records from previous test runs
    await User.collection.deleteMany({ email: /@progression-isolation-test\.com$/ });

    // Ensure required test levels exist
    async function getOrCreateLevel(num, title) {
      let lvl = await Level.findOne({ levelNumber: num });
      if (!lvl) {
        lvl = await Level.create({
          levelNumber: num,
          title: title || `Level ${num}`,
          difficulty: num > 10 ? 'hard' : 'easy',
          isActive: true,
          grid: { cols: 10, rows: 10 },
          wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
          portal: { x: 5, y: 2 },
          apples: [{ x: 3, y: 2, type: 'normal' }],
          obstacles: [],
          starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
          moveLimit: 30,
        });
      }
      return lvl;
    }

    level1 = await getOrCreateLevel(1, 'Level 1: Genesis');
    level2 = await getOrCreateLevel(2, 'Level 2: The Climb');
    level17 = await getOrCreateLevel(17, 'Level 17: Daily Maze');

    // Create a new clean player
    testUser = await User.create({
      username: `fresh_player_${Date.now()}`,
      email: `fresh_${Date.now()}@progression-isolation-test.com`,
      password: 'Password123!',
      coins: 100,
      currentLevel: 1,
      completedLevels: [],
    });
    await walletService.getOrCreateWallet(testUser._id);
    await PlayerProgress.create({
      userId: testUser._id,
      currentLevel: 1,
      highestUnlockedLevel: 1,
      completedLevels: [],
    });

    // Create an existing player with prior campaign progress (Levels 1-4 completed, Level 5 unlocked)
    existingUser = await User.create({
      username: `veteran_player_${Date.now()}`,
      email: `veteran_${Date.now()}@progression-isolation-test.com`,
      password: 'Password123!',
      coins: 350,
      currentLevel: 5,
      completedLevels: [1, 2, 3, 4],
    });
    await walletService.getOrCreateWallet(existingUser._id);
    await PlayerProgress.create({
      userId: existingUser._id,
      currentLevel: 5,
      highestUnlockedLevel: 5,
      completedLevels: [1, 2, 3, 4].map((n) => ({
        levelNumber: n,
        stars: 3,
        highScore: 800,
        leastMoves: 5,
        fastestTimeSeconds: 10,
        attemptsCount: 1,
      })),
    });

    // Generate valid JWTs
    const jwtSecret = process.env.JWT_SECRET || 'jwt_secret_dev_local_12345';
    const token1 = jwt.sign(
      { userId: testUser._id.toString(), role: 'player' },
      jwtSecret,
      { expiresIn: '1h' }
    );
    authHeaderTestUser = `Bearer ${token1}`;

    const token2 = jwt.sign(
      { userId: existingUser._id.toString(), role: 'player' },
      jwtSecret,
      { expiresIn: '1h' }
    );
    authHeaderExistingUser = `Bearer ${token2}`;

    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.collection.deleteMany({ email: /@progression-isolation-test\.com$/ });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Initial State & Campaign Level 1 Completion
  // ---------------------------------------------------------------------------
  describe('1. Normal Campaign Progression Baseline', () => {
    it('1.1 Fresh user initially has highestUnlockedLevel: 1 and empty completedLevels', async () => {
      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(progress.highestUnlockedLevel, 1);
      assert.strictEqual(progress.completedLevels.length, 0);

      // Verify Level 1 is unlocked and Level 2 is locked
      const isL1Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 1);
      const isL2Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 2);
      assert.strictEqual(isL1Unlocked, true);
      assert.strictEqual(isL2Unlocked, false);
    });

    it('1.2 Completing campaign Level 1 advances highestUnlockedLevel to 2 and records Level 1', async () => {
      const session = await gameSessionService.startSession(testUser._id, 1, { isDailyChallenge: false });
      assert.strictEqual(session.isDailyChallenge, false);

      const completion = await gameSessionService.completeSession(session._id, testUser._id, {
        moves: 3,
        durationSeconds: 5,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 1600,
          movesTaken: 3,
          applesRemaining: [],
        },
      });

      assert.strictEqual(completion.session.status, 'COMPLETED');
      assert.strictEqual(completion.unlockedLevel, 2);

      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(progress.highestUnlockedLevel, 2);
      assert.strictEqual(progress.completedLevels.length, 1);
      assert.strictEqual(progress.completedLevels[0].levelNumber, 1);

      const userDoc = await User.findById(testUser._id);
      assert.deepStrictEqual(userDoc.completedLevels, [1]);
      assert.strictEqual(userDoc.currentLevel, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Daily Challenge Completion Isolation (Core Bug Verification)
  // ---------------------------------------------------------------------------
  describe('2. Daily Challenge Progression Isolation', () => {
    it('2.1 Completing Daily Challenge (Level 17) does NOT advance campaign progression to Level 18', async () => {
      const targetDate = '2026-11-25';

      // Start Daily Challenge session on Level 17
      const session = await gameSessionService.startSession(testUser._id, 17, {
        isDailyChallenge: true,
        challengeDate: targetDate,
      });
      assert.strictEqual(session.isDailyChallenge, true);
      assert.strictEqual(session.levelNumber, 17);

      const walletBefore = await walletService.getOrCreateWallet(testUser._id);

      // Complete Daily Challenge via dailyChallengeService
      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, session._id, {
        moves: 4,
        durationSeconds: 8,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 1600,
          movesTaken: 4,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.rewardCoins, 150);
      assert.strictEqual(res.streak.currentStreak, 1);

      // CRITICAL ASSERTION: highestUnlockedLevel MUST STILL BE 2, NOT 18!
      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(
        progress.highestUnlockedLevel,
        2,
        'highestUnlockedLevel must remain 2 after completing Daily Challenge Level 17'
      );

      // CRITICAL ASSERTION: completedLevels must only contain [1], NOT [1, 17]!
      assert.strictEqual(progress.completedLevels.length, 1);
      assert.strictEqual(progress.completedLevels[0].levelNumber, 1);

      // User document check
      const userDoc = await User.findById(testUser._id);
      assert.deepStrictEqual(userDoc.completedLevels, [1], 'User.completedLevels must not contain 17');
      assert.strictEqual(userDoc.currentLevel, 2, 'User.currentLevel must not leap to 18');

      // Verify Level 2 remains unlocked, but Level 3 through Level 18 remain locked
      const isL2Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 2);
      const isL3Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 3);
      const isL17Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 17);
      const isL18Unlocked = await gameSessionService.isLevelUnlocked(testUser._id, 18);

      assert.strictEqual(isL2Unlocked, true, 'Campaign Level 2 must remain unlocked');
      assert.strictEqual(isL3Unlocked, false, 'Campaign Level 3 must remain locked');
      assert.strictEqual(isL17Unlocked, false, 'Campaign Level 17 must remain locked');
      assert.strictEqual(isL18Unlocked, false, 'Campaign Level 18 must remain locked');

      // Verify Daily Challenge participation record was created
      const dcRecord = await DailyChallengeCompletion.findOne({
        userId: testUser._id,
        date: targetDate,
      });
      assert.ok(dcRecord, 'DailyChallengeCompletion record must exist');
      assert.strictEqual(dcRecord.levelNumber, 17);

      // Verify wallet credited with DAILY_REWARD (+150 coins), NOT campaign LEVEL_REWARD
      const walletAfter = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(walletAfter.balance, walletBefore.balance + 150);

      const dcTx = await WalletTransaction.findOne({
        userId: testUser._id,
        idempotencyKey: `daily_challenge_${testUser._id}_${targetDate}`,
      });
      assert.ok(dcTx, 'Daily challenge transaction must exist');
      assert.strictEqual(dcTx.type, 'DAILY_REWARD');

      // Verify Level 17 base reward was NOT consumed
      const level17Tx = await WalletTransaction.findOne({
        userId: testUser._id,
        idempotencyKey: `level_base_${testUser._id}_level_17`,
      });
      assert.strictEqual(level17Tx, null, 'Level 17 base completion reward must NOT have been consumed');
    });

    it('2.2 Re-completing the Daily Challenge on the same day maintains progression isolation', async () => {
      const targetDate = '2026-11-25';

      const session = await gameSessionService.startSession(testUser._id, 17, {
        isDailyChallenge: true,
        challengeDate: targetDate,
      });

      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, session._id, {
        moves: 3,
        durationSeconds: 6,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 1650,
          movesTaken: 3,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.alreadyCompleted, true);
      assert.strictEqual(res.rewardCoins, 0);

      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(progress.highestUnlockedLevel, 2);
      assert.strictEqual(progress.completedLevels.length, 1);
    });

    it('2.3 Reconciling an already-completed Daily Challenge session does not unlock campaign levels', async () => {
      // Find the first completed session
      const completedSession = await GameSession.findOne({
        userId: testUser._id,
        levelNumber: 17,
        status: 'COMPLETED',
      });
      assert.ok(completedSession);

      // Call completeSession directly on the already completed session
      const res = await gameSessionService.completeSession(completedSession._id, testUser._id, {});
      assert.strictEqual(res.isDuplicate, true);
      assert.strictEqual(res.unlockedLevel, 2);

      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(progress.highestUnlockedLevel, 2);
      assert.strictEqual(progress.completedLevels.length, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Campaign Progression Continuation After Daily Challenge
  // ---------------------------------------------------------------------------
  describe('3. Campaign Progression Resumption', () => {
    it('3.1 User can play and complete campaign Level 2 normally, advancing to Level 3', async () => {
      const session = await gameSessionService.startSession(testUser._id, 2, { isDailyChallenge: false });
      assert.strictEqual(session.isDailyChallenge, false);

      const completion = await gameSessionService.completeSession(session._id, testUser._id, {
        moves: 4,
        durationSeconds: 7,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 1500,
          movesTaken: 4,
          applesRemaining: [],
        },
      });

      assert.strictEqual(completion.session.status, 'COMPLETED');
      assert.strictEqual(completion.unlockedLevel, 3);

      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(progress.highestUnlockedLevel, 3);
      assert.strictEqual(progress.completedLevels.length, 2);
      const completedNums = progress.completedLevels.map((l) => l.levelNumber).sort((a, b) => a - b);
      assert.deepStrictEqual(completedNums, [1, 2]);

      const userDoc = await User.findById(testUser._id);
      assert.deepStrictEqual(userDoc.completedLevels.sort((a, b) => a - b), [1, 2]);
      assert.strictEqual(userDoc.currentLevel, 3);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Dual Completion Endpoint Support (HTTP REST)
  // ---------------------------------------------------------------------------
  describe('4. REST Endpoint Completion & Progression Isolation', () => {
    it('4.1 Completing daily challenge via standard POST /api/games/complete preserves progression isolation', async () => {
      const targetDate = '2026-11-26';

      // Start Daily Challenge session
      const session = await gameSessionService.startSession(testUser._id, 17, {
        isDailyChallenge: true,
        challengeDate: targetDate,
      });

      // Submit completion to general endpoint POST /api/games/complete
      const response = await fetch(`${baseUrl}/games/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeaderTestUser,
        },
        body: JSON.stringify({
          sessionId: session._id.toString(),
          moves: 4,
          score: 1600,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 1600,
            movesTaken: 4,
            applesRemaining: [],
          },
        }),
      });

      const body = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.session.status, 'COMPLETED');

      // highestUnlockedLevel must remain 3!
      const progress = await gameSessionService.getPlayerProgress(testUser._id);
      assert.strictEqual(
        progress.highestUnlockedLevel,
        3,
        'highestUnlockedLevel must remain 3 after /api/games/complete on daily challenge'
      );
      assert.strictEqual(progress.completedLevels.length, 2);

      // Streak should now be 2 (consecutive calendar day)
      const streakDoc = await PlayerDailyStreak.findOne({ userId: testUser._id });
      assert.strictEqual(streakDoc.currentStreak, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Anti-Spoofing & Session Type Security
  // ---------------------------------------------------------------------------
  describe('5. Session Type Spoofing & Security Checks', () => {
    it('5.1 POST /api/games/start ignores client isDailyChallenge: true and blocks locked campaign levels', async () => {
      // TestUser has unlocked levels 1, 2, 3. Level 17 is locked.
      const res = await fetch(`${baseUrl}/games/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeaderTestUser,
        },
        body: JSON.stringify({
          levelNumber: 17,
          isDailyChallenge: true, // Spoofed flag attempted by client
        }),
      });

      const body = await res.json();
      // Must be rejected because /api/games/start is strictly for campaign sessions
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('locked'));
    });

    it('5.2 POST /api/daily-challenge/complete rejects normal campaign sessions', async () => {
      // Start a normal campaign session for Level 2
      const campaignSession = await gameSessionService.startSession(testUser._id, 2, { isDailyChallenge: false });

      const res = await fetch(`${baseUrl}/daily-challenge/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeaderTestUser,
        },
        body: JSON.stringify({
          sessionId: campaignSession._id.toString(),
          moves: 5,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          },
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('not registered as a daily challenge'));
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Preservation of Existing Progression
  // ---------------------------------------------------------------------------
  describe('6. Existing Progress Preservation', () => {
    it('6.1 Veteran player (Level 5) keeps exact campaign unlocks after completing Daily Challenge', async () => {
      const initialProgress = await gameSessionService.getPlayerProgress(existingUser._id);
      assert.strictEqual(initialProgress.highestUnlockedLevel, 5);
      assert.strictEqual(initialProgress.completedLevels.length, 4);

      // Play Daily Challenge Level 17
      const session = await gameSessionService.startSession(existingUser._id, 17, {
        isDailyChallenge: true,
        challengeDate: '2026-11-25',
      });

      const res = await dailyChallengeService.completeDailyChallenge(existingUser._id, session._id, {
        moves: 4,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 1600,
          movesTaken: 4,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.rewardCoins, 150);

      const progressAfter = await gameSessionService.getPlayerProgress(existingUser._id);
      assert.strictEqual(progressAfter.highestUnlockedLevel, 5, 'Veteran highestUnlockedLevel must remain 5');
      assert.strictEqual(progressAfter.completedLevels.length, 4, 'Veteran completedLevels count must remain 4');

      const userDoc = await User.findById(existingUser._id);
      assert.deepStrictEqual(userDoc.completedLevels, [1, 2, 3, 4]);
      assert.strictEqual(userDoc.currentLevel, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Leaderboards & Achievements Consistency
  // ---------------------------------------------------------------------------
  describe('7. Leaderboard and Achievement Integration', () => {
    it('7.1 LEVEL_EXPLORER achievement reflects authentic campaign highestUnlockedLevel (3)', async () => {
      const achievements = await achievementService.getUserAchievements(testUser._id);
      const levelExplorer = achievements.find((a) => a.id === 'LEVEL_EXPLORER');
      assert.ok(levelExplorer);
      // Progress must be 3, NOT 18!
      assert.strictEqual(levelExplorer.progress, 3);
    });

    it('7.2 Global leaderboard displays authentic highestUnlockedLevel and completed count', async () => {
      const leaderboard = await leaderboardService.getLeaderboard({
        currentUserId: testUser._id.toString(),
      });

      assert.strictEqual(leaderboard.success, true);
      assert.ok(leaderboard.myEntry);
      assert.strictEqual(leaderboard.myEntry.highestUnlockedLevel, 3);
      assert.strictEqual(leaderboard.myEntry.completedLevelsCount, 2);
    });
  });
});
