/**
 * server/test/daily_challenge_streak.test.js
 * 
 * Comprehensive Unit and Integration Test Suite for:
 *   1. Deterministic Daily Challenge Selection & UTC Date Boundaries
 *   2. Independent Access (Playable regardless of normal progression unlocks)
 *   3. Authoritative Completion & Server-Side Validation
 *   4. Duplicate Completion & Reward Prevention (Single reward per UTC calendar day)
 *   5. Daily Participation Streak Mechanics:
 *      - Initial day = streak 1
 *      - Same-day completion = no streak increment
 *      - Consecutive day = streak + 1
 *      - Missed calendar day = streak reset to 1
 *      - Longest streak tracking
 *   6. Streak Milestone Rewards (3, 7, 14, 30 days) & CAS Idempotency
 *   7. Wallet Integrity & Append-Only Ledger Verification
 *   8. REST API Endpoints Integration (GET /today, POST /start, POST /complete, POST /claim-milestone/:days)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
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
import PlayerDailyStreak, { STREAK_MILESTONES } from '../src/models/PlayerDailyStreak.js';
import dailyChallengeService, {
  getUTCDateString,
  getDaysBetweenUTCDates,
  getDailyChallengeLevelNumber,
} from '../src/services/dailyChallengeService.js';
import gameSessionService from '../src/services/gameSessionService.js';
import walletService from '../src/services/walletService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Phase 9 Step 4 — Daily Challenge & Streak System Test Suite', () => {
  let testUser;
  let testLevels = [];

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean test collections
    await User.collection.deleteMany({ email: /@daily-challenge-test\.com$/ });
    await DailyChallengeCompletion.collection.deleteMany({});
    await PlayerDailyStreak.collection.deleteMany({});
    await GameSession.collection.deleteMany({});
    await Wallet.collection.deleteMany({});
    await WalletTransaction.collection.deleteMany({});

    // Ensure a sample level exists (e.g. Level 20) with valid portal and grid
    let level20 = await Level.findOne({ levelNumber: 20 });
    if (!level20) {
      level20 = await Level.create({
        levelNumber: 20,
        title: 'Level 20: Daily Challenge Trial',
        difficulty: 'medium',
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
    testLevels.push(level20);

    // Create a new test user who starts at Level 1
    testUser = await User.create({
      username: `streak_hero_${Date.now()}`,
      email: `streak_${Date.now()}@daily-challenge-test.com`,
      password: 'Password123!',
      coins: 50,
      currentLevel: 1,
    });
    await walletService.getOrCreateWallet(testUser._id);

    // Progress at level 1 (Level 20 is completely LOCKED in normal progression)
    await PlayerProgress.create({
      userId: testUser._id,
      currentLevel: 1,
      highestUnlockedLevel: 1,
      completedLevels: [],
    });
  });

  after(async () => {
    if (testUser) {
      await User.collection.deleteOne({ _id: testUser._id });
      await PlayerProgress.collection.deleteOne({ userId: testUser._id });
      await DailyChallengeCompletion.collection.deleteMany({ userId: testUser._id });
      await PlayerDailyStreak.collection.deleteMany({ userId: testUser._id });
      await GameSession.collection.deleteMany({ userId: testUser._id });
      await Wallet.collection.deleteMany({ userId: testUser._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser._id });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Deterministic Selection & UTC Math
  // ---------------------------------------------------------------------------
  describe('1. Deterministic Challenge Selection & UTC Boundaries', () => {
    it('1.1 Generates the exact same level number for the same UTC calendar day', () => {
      const date1 = '2026-11-24';
      const levelA = getDailyChallengeLevelNumber(date1, 50);
      const levelB = getDailyChallengeLevelNumber(date1, 50);
      assert.strictEqual(levelA, levelB);
      assert.ok(levelA >= 1 && levelA <= 50);
    });

    it('1.2 Produces deterministic varying selection across different calendar days', () => {
      const levelDay1 = getDailyChallengeLevelNumber('2026-11-24', 50);
      const levelDay2 = getDailyChallengeLevelNumber('2026-11-25', 50);
      const levelDay3 = getDailyChallengeLevelNumber('2026-11-26', 50);
      // At least one adjacent day should differ
      assert.ok(levelDay1 !== levelDay2 || levelDay2 !== levelDay3);
    });

    it('1.3 Calculates UTC date string format YYYY-MM-DD reliably', () => {
      const fixedDate = new Date('2026-12-31T23:59:59Z');
      assert.strictEqual(getUTCDateString(fixedDate), '2026-12-31');
    });

    it('1.4 Computes exact day difference across month and year boundaries in UTC', () => {
      assert.strictEqual(getDaysBetweenUTCDates('2026-11-24', '2026-11-25'), 1);
      assert.strictEqual(getDaysBetweenUTCDates('2026-11-24', '2026-11-24'), 0);
      assert.strictEqual(getDaysBetweenUTCDates('2026-11-30', '2026-12-01'), 1);
      assert.strictEqual(getDaysBetweenUTCDates('2026-12-31', '2027-01-01'), 1);
      assert.strictEqual(getDaysBetweenUTCDates('2026-11-20', '2026-11-25'), 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Independent Access & Session Launching
  // ---------------------------------------------------------------------------
  describe('2. Independent Access & Game Session Architecture', () => {
    it('2.1 Allows starting a daily challenge session for a locked level without 403 error', async () => {
      // Test user is at level 1; we launch daily challenge for Level 20
      const session = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-24',
      });

      assert.ok(session);
      assert.strictEqual(session.levelNumber, 20);
      assert.strictEqual(session.status, 'ACTIVE');
      assert.strictEqual(session.isDailyChallenge, true);
      assert.strictEqual(session.challengeDate, '2026-11-24');
    });

    it('2.2 Regular session start for Level 20 continues to be rejected with 403 for locked player', async () => {
      await assert.rejects(
        async () => {
          await gameSessionService.startSession(testUser._id, 20);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /locked/i);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Daily Completion, Rewards & Streak Progression
  // ---------------------------------------------------------------------------
  describe('3. Daily Completion, Rewards & Streak Progression', () => {
    it('3.1 Successfully completes daily challenge on Day 1: awards 150 coins and starts streak at 1', async () => {
      const initialWallet = await walletService.getOrCreateWallet(testUser._id);
      const initialBalance = initialWallet.balance;

      const session = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-24',
      });

      // Submit completion with worm at portal tile (x: 5, y: 2)
      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, session._id, {
        moves: 4,
        score: 600,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 600,
          movesTaken: 4,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.alreadyCompleted, false);
      assert.strictEqual(res.rewardCoins, 150);
      assert.strictEqual(res.streak.currentStreak, 1);
      assert.strictEqual(res.streak.longestStreak, 1);

      // Verify wallet was credited with daily challenge coins
      const updatedWallet = await walletService.getOrCreateWallet(testUser._id);
      assert.ok(updatedWallet.balance >= initialBalance + 150);

      // Verify transaction ledger entry exists
      const tx = await WalletTransaction.findOne({
        userId: testUser._id,
        idempotencyKey: `daily_challenge_${testUser._id}_2026-11-24`,
      });
      assert.ok(tx);
      assert.strictEqual(tx.type, 'DAILY_REWARD');
      assert.strictEqual(tx.amount, 150);
    });

    it('3.2 Re-completing the challenge on the same UTC day does not increase streak or re-award coins', async () => {
      const walletBefore = await walletService.getOrCreateWallet(testUser._id);

      const session = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-24',
      });

      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, session._id, {
        moves: 3,
        score: 700,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 700,
          movesTaken: 3,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.alreadyCompleted, true);
      assert.strictEqual(res.rewardCoins, 0); // zero duplicate reward
      assert.strictEqual(res.streak.currentStreak, 1); // no streak increment

      // Wallet balance remains unchanged
      const walletAfter = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(walletAfter.balance, walletBefore.balance);
    });

    it('3.3 Completing on the consecutive UTC calendar day (Day 2) increments streak to 2', async () => {
      const sessionDay2 = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-25',
      });

      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, sessionDay2._id, {
        moves: 5,
        score: 650,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 650,
          movesTaken: 5,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.alreadyCompleted, false);
      assert.strictEqual(res.rewardCoins, 150);
      assert.strictEqual(res.streak.currentStreak, 2);
      assert.strictEqual(res.streak.longestStreak, 2);
    });

    it('3.4 Completing on Day 3 advances streak to 3 and unlocks 3-day milestone', async () => {
      const sessionDay3 = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-26',
      });

      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, sessionDay3._id, {
        moves: 5,
        score: 650,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 650,
          movesTaken: 5,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.streak.currentStreak, 3);
      assert.strictEqual(res.streak.longestStreak, 3);

      // Verify today challenge overview reports 3-day milestone as claimable
      const overview = await dailyChallengeService.getTodayChallenge(testUser._id, '2026-11-26');
      const milestone3 = overview.streak.milestones.find((m) => m.days === 3);
      assert.ok(milestone3);
      assert.strictEqual(milestone3.unlocked, true);
      assert.strictEqual(milestone3.canClaim, true);
      assert.strictEqual(milestone3.claimed, false);
    });

    it('3.5 Missing a calendar day (jumping from Nov 26 to Nov 29) resets current streak to 1', async () => {
      const sessionLapsed = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-11-29', // missed Nov 27 & 28
      });

      const res = await dailyChallengeService.completeDailyChallenge(testUser._id, sessionLapsed._id, {
        moves: 4,
        score: 600,
        checkpoint: {
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          currentScore: 600,
          movesTaken: 4,
          applesRemaining: [],
        },
      });

      assert.strictEqual(res.streak.currentStreak, 1); // reset to 1
      assert.strictEqual(res.streak.longestStreak, 3); // preserved longest streak of 3
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Streak Milestone Rewards & Idempotent Claims
  // ---------------------------------------------------------------------------
  describe('4. Streak Milestone Rewards & Idempotent Claims', () => {
    it('4.1 Successfully claims unlocked 3-day milestone reward (+100 coins)', async () => {
      const walletBefore = await walletService.getOrCreateWallet(testUser._id);

      const claimRes = await dailyChallengeService.claimStreakMilestone(testUser._id, 3);
      assert.strictEqual(claimRes.success, true);
      assert.strictEqual(claimRes.claimed, true);
      assert.strictEqual(claimRes.alreadyClaimed, false);
      assert.strictEqual(claimRes.rewardCoins, 100);

      // Verify wallet credited
      const walletAfter = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(walletAfter.balance, walletBefore.balance + 100);

      // Verify transaction ledger entry exists
      const tx = await WalletTransaction.findOne({
        userId: testUser._id,
        idempotencyKey: `streak_milestone_${testUser._id}_3`,
      });
      assert.ok(tx);
      assert.strictEqual(tx.type, 'STREAK_MILESTONE_REWARD');
      assert.strictEqual(tx.amount, 100);
    });

    it('4.2 Re-claiming the 3-day milestone is strictly idempotent with zero double crediting', async () => {
      const walletBefore = await walletService.getOrCreateWallet(testUser._id);

      const claimRepeat = await dailyChallengeService.claimStreakMilestone(testUser._id, 3);
      assert.strictEqual(claimRepeat.success, true);
      assert.strictEqual(claimRepeat.claimed, true);
      assert.strictEqual(claimRepeat.alreadyClaimed, true);

      // Balance unchanged
      const walletAfter = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(walletAfter.balance, walletBefore.balance);
    });

    it('4.3 Rejects claim for an unearned milestone (e.g. 7-day milestone when longest streak is 3)', async () => {
      await assert.rejects(
        async () => {
          await dailyChallengeService.claimStreakMilestone(testUser._id, 7);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /not been achieved yet/i);
          return true;
        }
      );
    });

    it('4.4 Rejects claim for an invalid milestone number', async () => {
      await assert.rejects(
        async () => {
          await dailyChallengeService.claimStreakMilestone(testUser._id, 999);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /invalid streak milestone/i);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. REST API Endpoints Integration
  // ---------------------------------------------------------------------------
  describe('5. REST API Endpoints Integration', () => {
    let server;
    let baseUrl;
    let authHeader;

    before((t, done) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        const secret = process.env.JWT_SECRET || 'test_jwt_secret_phase9_step4_12345';
        process.env.JWT_SECRET = secret;
        const token = jwt.sign(
          { userId: testUser._id.toString(), role: testUser.role || 'player' },
          secret,
          { expiresIn: '1h' }
        );
        authHeader = `Bearer ${token}`;
        done();
      });
    });

    after((t, done) => {
      if (server) server.close(done);
      else done();
    });

    it('5.1 GET /api/daily-challenge/today returns today challenge details and streak overview', async () => {
      const res = await fetch(`${baseUrl}/daily-challenge/today`, {
        headers: { Authorization: authHeader },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.levelNumber);
      assert.ok(data.level);
      assert.strictEqual(data.rewardCoins, 150);
      assert.ok(data.streak);
    });

    it('5.2 POST /api/daily-challenge/start starts a new challenge session', async () => {
      const res = await fetch(`${baseUrl}/daily-challenge/start`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date: '2026-12-01' }),
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.date, '2026-12-01');
      assert.ok(data.session);
      assert.strictEqual(data.session.isDailyChallenge, true);
    });

    it('5.3 POST /api/daily-challenge/complete verifies completion and returns streak', async () => {
      // Start session first
      const session = await gameSessionService.startSession(testUser._id, 20, {
        isDailyChallenge: true,
        challengeDate: '2026-12-01',
      });

      const res = await fetch(`${baseUrl}/daily-challenge/complete`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session._id,
          moves: 4,
          score: 550,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 550,
            movesTaken: 4,
            applesRemaining: [],
          },
        }),
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.streak);
    });

    it('5.4 POST /api/daily-challenge/claim-milestone/:days returns 200 for claimed milestone', async () => {
      const res = await fetch(`${baseUrl}/daily-challenge/claim-milestone/3`, {
        method: 'POST',
        headers: { Authorization: authHeader },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.claimed, true);
      assert.strictEqual(data.alreadyClaimed, true);
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
});
