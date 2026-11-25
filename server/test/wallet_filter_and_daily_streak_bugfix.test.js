/**
 * server/test/wallet_filter_and_daily_streak_bugfix.test.js
 *
 * Dedicated regression tests for Bug Fix Task:
 *  1. Wallet Transaction History Filters:
 *     - Ledger Reversal ('REVERSAL') [both CREDIT and DEBIT]
 *     - Revive Opportunity ('REVIVE_REWARD') [both CREDIT and DEBIT]
 *     - Daily Login Reward ('DAILY_REWARD') [CREDIT, with clear description]
 *     - Type and Direction sanitization (handling 'ALL', case insensitivity, trimming)
 *     - REST API /api/wallet/transactions query filtering
 *  2. Daily Challenge Streak System:
 *     - Initial challenge completion updates streak from 0 to 1
 *     - Same-day repeat completion does not increment streak or duplicate rewards
 *     - Consecutive calendar day completion increments streak (1 -> 2)
 *     - Missed calendar day resets current streak to 1 while preserving longest streak
 *     - End-to-end session completion via both /api/daily-challenge/complete and /api/games/complete
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
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Bug Fix Regression Suite: Wallet Filters & Daily Challenge Streak', () => {
  let testUser;
  let testUser2;
  let server;
  let baseUrl;
  let authHeaderUser1;
  let authHeaderUser2;
  let testLevel;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean test records
    await User.collection.deleteMany({ email: /@bugfix-test\.com$/ });

    // Seed test level 25 (portal at {x: 5, y: 2})
    testLevel = await Level.findOne({ levelNumber: 25 });
    if (!testLevel) {
      testLevel = await Level.create({
        levelNumber: 25,
        title: 'Level 25: Bugfix Verification Maze',
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

    // Create test user 1 (Wallet Filter tests)
    testUser = await User.create({
      username: `wallet_user_${Date.now()}`,
      email: `wallet_${Date.now()}@bugfix-test.com`,
      password: 'Password123!',
      coins: 200,
      currentLevel: 1,
    });
    await walletService.getOrCreateWallet(testUser._id);

    // Create test user 2 (Daily streak tests)
    testUser2 = await User.create({
      username: `streak_user_${Date.now()}`,
      email: `streak_${Date.now()}@bugfix-test.com`,
      password: 'Password123!',
      coins: 50,
      currentLevel: 1,
    });
    await walletService.getOrCreateWallet(testUser2._id);
    await PlayerProgress.create({
      userId: testUser2._id,
      currentLevel: 1,
      highestUnlockedLevel: 1,
      completedLevels: [],
    });

    // Start ephemeral server for HTTP testing
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret-key-32-chars-long!!';
        const token1 = jwt.sign(
          { userId: testUser._id.toString(), role: 'player' },
          jwtSecret,
          { expiresIn: '1h' }
        );
        const token2 = jwt.sign(
          { userId: testUser2._id.toString(), role: 'player' },
          jwtSecret,
          { expiresIn: '1h' }
        );
        authHeaderUser1 = `Bearer ${token1}`;
        authHeaderUser2 = `Bearer ${token2}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (testUser) {
      await User.collection.deleteOne({ _id: testUser._id });
      await Wallet.collection.deleteMany({ userId: testUser._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser._id });
    }
    if (testUser2) {
      await User.collection.deleteOne({ _id: testUser2._id });
      await PlayerProgress.collection.deleteOne({ userId: testUser2._id });
      await PlayerDailyStreak.collection.deleteMany({ userId: testUser2._id });
      await DailyChallengeCompletion.collection.deleteMany({ userId: testUser2._id });
      await GameSession.collection.deleteMany({ userId: testUser2._id });
      await Wallet.collection.deleteMany({ userId: testUser2._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser2._id });
    }
    await mongoose.disconnect();
  });

  // =========================================================================
  // BUG 1: WALLET TRANSACTION HISTORY FILTERS
  // =========================================================================
  describe('Bug 1: Wallet Transaction History Filters', () => {
    before(async () => {
      // Setup distinct transactions for testUser:
      // 1. REVERSAL CREDIT (e.g. Refund / Admin correction)
      await walletService.credit(testUser._id, 40, {
        type: 'REVERSAL',
        idempotencyKey: `test_reversal_credit_${Date.now()}`,
        description: 'Ledger reversal credit refund',
      });

      // 2. REVERSAL DEBIT (e.g. Chargeback / Reversal adjustment)
      await walletService.debit(testUser._id, 15, {
        type: 'REVERSAL',
        idempotencyKey: `test_reversal_debit_${Date.now()}`,
        description: 'Ledger reversal debit adjustment',
      });

      // 3. REVIVE_REWARD CREDIT (Revive reward bonus)
      await walletService.credit(testUser._id, 25, {
        type: 'REVIVE_REWARD',
        idempotencyKey: `test_revive_credit_${Date.now()}`,
        description: 'Revive opportunity coin bonus',
      });

      // 4. REVIVE_REWARD DEBIT (Revive opportunity fee)
      await walletService.debit(testUser._id, 10, {
        type: 'REVIVE_REWARD',
        idempotencyKey: `test_revive_debit_${Date.now()}`,
        description: 'Revive opportunity instant token',
      });

      // 5. DAILY_REWARD CREDIT (Daily streak reward)
      await walletService.credit(testUser._id, 150, {
        type: 'DAILY_REWARD',
        idempotencyKey: `test_daily_reward_${Date.now()}`,
        description: 'Daily login reward (Day 1 streak)',
      });

      // 6. Regular LEVEL_REWARD for contrast
      await walletService.credit(testUser._id, 50, {
        type: 'LEVEL_REWARD',
        idempotencyKey: `test_level_reward_${Date.now()}`,
        description: 'Level 1 completion reward',
      });
    });

    it('1.1 Retrieves REVERSAL transactions in both CREDIT and DEBIT directions', async () => {
      // Query all reversals
      const resultAll = await walletService.getTransactionHistory(testUser._id, { type: 'REVERSAL' });
      assert.strictEqual(resultAll.transactions.length, 2);
      const directions = resultAll.transactions.map((t) => t.direction);
      assert.ok(directions.includes('CREDIT'));
      assert.ok(directions.includes('DEBIT'));

      // Query CREDIT reversals only
      const resultCredit = await walletService.getTransactionHistory(testUser._id, {
        type: 'REVERSAL',
        direction: 'CREDIT',
      });
      assert.strictEqual(resultCredit.transactions.length, 1);
      assert.strictEqual(resultCredit.transactions[0].direction, 'CREDIT');
      assert.strictEqual(resultCredit.transactions[0].amount, 40);
      assert.strictEqual(resultCredit.transactions[0].description, 'Ledger reversal credit refund');

      // Query DEBIT reversals only
      const resultDebit = await walletService.getTransactionHistory(testUser._id, {
        type: 'REVERSAL',
        direction: 'DEBIT',
      });
      assert.strictEqual(resultDebit.transactions.length, 1);
      assert.strictEqual(resultDebit.transactions[0].direction, 'DEBIT');
      assert.strictEqual(resultDebit.transactions[0].amount, 15);
      assert.strictEqual(resultDebit.transactions[0].description, 'Ledger reversal debit adjustment');
    });

    it('1.2 Retrieves REVIVE_REWARD transactions in both CREDIT and DEBIT directions', async () => {
      // Query all REVIVE_REWARD
      const resultAll = await walletService.getTransactionHistory(testUser._id, { type: 'REVIVE_REWARD' });
      assert.strictEqual(resultAll.transactions.length, 2);

      // Query CREDIT REVIVE_REWARD
      const resultCredit = await walletService.getTransactionHistory(testUser._id, {
        type: 'REVIVE_REWARD',
        direction: 'CREDIT',
      });
      assert.strictEqual(resultCredit.transactions.length, 1);
      assert.strictEqual(resultCredit.transactions[0].amount, 25);
      assert.strictEqual(resultCredit.transactions[0].direction, 'CREDIT');
      assert.strictEqual(resultCredit.transactions[0].description, 'Revive opportunity coin bonus');

      // Query DEBIT REVIVE_REWARD
      const resultDebit = await walletService.getTransactionHistory(testUser._id, {
        type: 'REVIVE_REWARD',
        direction: 'DEBIT',
      });
      assert.strictEqual(resultDebit.transactions.length, 1);
      assert.strictEqual(resultDebit.transactions[0].amount, 10);
      assert.strictEqual(resultDebit.transactions[0].direction, 'DEBIT');
      assert.strictEqual(resultDebit.transactions[0].description, 'Revive opportunity instant token');
    });

    it('1.3 Retrieves DAILY_REWARD transactions with proper CREDIT direction and descriptive label', async () => {
      const result = await walletService.getTransactionHistory(testUser._id, { type: 'DAILY_REWARD' });
      assert.strictEqual(result.transactions.length, 1);
      const tx = result.transactions[0];
      assert.strictEqual(tx.type, 'DAILY_REWARD');
      assert.strictEqual(tx.direction, 'CREDIT');
      assert.strictEqual(tx.amount, 150);
      assert.strictEqual(tx.description, 'Daily login reward (Day 1 streak)');
      assert.ok(tx.balanceBefore !== undefined);
      assert.ok(tx.balanceAfter !== undefined);
      assert.strictEqual(tx.balanceAfter - tx.balanceBefore, 150);
    });

    it('1.4 Handles "ALL" and casing gracefully without literal matching traps', async () => {
      // "ALL" should return all transactions, not filter by type="ALL"
      const resAll = await walletService.getTransactionHistory(testUser._id, {
        type: 'ALL',
        direction: 'ALL',
      });
      assert.ok(resAll.transactions.length >= 6);

      // Case-insensitive query: "reversal"
      const resLower = await walletService.getTransactionHistory(testUser._id, {
        type: 'reversal',
        direction: 'credit',
      });
      assert.strictEqual(resLower.transactions.length, 1);
      assert.strictEqual(resLower.transactions[0].type, 'REVERSAL');
    });

    it('1.5 REST API GET /api/wallet/transactions verifies REVERSAL, REVIVE_REWARD, and DAILY_REWARD filters', async () => {
      // 1. REVERSAL filter
      const resReversal = await fetch(`${baseUrl}/wallet/transactions?type=REVERSAL`, {
        headers: { Authorization: authHeaderUser1 },
      });
      assert.strictEqual(resReversal.status, 200);
      const dataReversal = await resReversal.json();
      assert.strictEqual(dataReversal.success, true);
      assert.strictEqual(dataReversal.data.length, 2);
      assert.ok(dataReversal.data.every((t) => t.type === 'REVERSAL'));

      // 2. REVIVE_REWARD filter
      const resRevive = await fetch(`${baseUrl}/wallet/transactions?type=REVIVE_REWARD`, {
        headers: { Authorization: authHeaderUser1 },
      });
      assert.strictEqual(resRevive.status, 200);
      const dataRevive = await resRevive.json();
      assert.strictEqual(dataRevive.success, true);
      assert.strictEqual(dataRevive.data.length, 2);
      assert.ok(dataRevive.data.every((t) => t.type === 'REVIVE_REWARD'));

      // 3. DAILY_REWARD filter
      const resDaily = await fetch(`${baseUrl}/wallet/transactions?type=DAILY_REWARD`, {
        headers: { Authorization: authHeaderUser1 },
      });
      assert.strictEqual(resDaily.status, 200);
      const dataDaily = await resDaily.json();
      assert.strictEqual(dataDaily.success, true);
      assert.strictEqual(dataDaily.data.length, 1);
      assert.strictEqual(dataDaily.data[0].type, 'DAILY_REWARD');
      assert.strictEqual(dataDaily.data[0].direction, 'CREDIT');
      assert.strictEqual(dataDaily.data[0].amount, 150);

      // 4. ALL query parameter passing
      const resAll = await fetch(`${baseUrl}/wallet/transactions?type=ALL&direction=ALL`, {
        headers: { Authorization: authHeaderUser1 },
      });
      assert.strictEqual(resAll.status, 200);
      const dataAll = await resAll.json();
      assert.ok(dataAll.data.length >= 6);
    });
  });

  // =========================================================================
  // BUG 2: DAILY CHALLENGE STREAK NOT UPDATING
  // =========================================================================
  describe('Bug 2: Daily Challenge Streak Progression & Session Completion', () => {
    it('2.1 Initial challenge completion updates currentStreak and longestStreak from 0 to 1', async () => {
      const today = '2026-11-24';

      // Ensure user starts with no streak document
      await PlayerDailyStreak.deleteOne({ userId: testUser2._id });

      // Start session for level 25 (portal at {x: 5, y: 2})
      const session = await gameSessionService.startSession(testUser2._id, 25, {
        isDailyChallenge: true,
        challengeDate: today,
      });
      assert.ok(session);
      assert.strictEqual(session.isDailyChallenge, true);

      // Complete the daily challenge passing (userId, sessionId, completionData)
      const completionResult = await dailyChallengeService.completeDailyChallenge(
        testUser2._id,
        session._id,
        {
          score: 600,
          moves: 5,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 600,
            movesTaken: 5,
            applesRemaining: [],
          },
        }
      );

      assert.strictEqual(completionResult.success, true);
      assert.strictEqual(completionResult.alreadyCompleted, false);
      assert.strictEqual(completionResult.rewardCoins, 150);
      assert.strictEqual(completionResult.streak.currentStreak, 1);
      assert.strictEqual(completionResult.streak.longestStreak, 1);
      assert.strictEqual(completionResult.streak.lastCompletedDate, today);

      // Verify PlayerDailyStreak document
      const streakDoc = await PlayerDailyStreak.findOne({ userId: testUser2._id });
      assert.ok(streakDoc);
      assert.strictEqual(streakDoc.currentStreak, 1);
      assert.strictEqual(streakDoc.longestStreak, 1);
      assert.strictEqual(streakDoc.lastCompletedDate, today);

      // Verify DailyChallengeCompletion record
      const completionDoc = await DailyChallengeCompletion.findOne({
        userId: testUser2._id,
        date: today,
      });
      assert.ok(completionDoc);
      assert.strictEqual(completionDoc.streakCount, 1);
      assert.strictEqual(completionDoc.rewardCoins, 150);

      // Verify wallet transaction
      const tx = await WalletTransaction.findOne({
        userId: testUser2._id,
        type: 'DAILY_REWARD',
      });
      assert.ok(tx);
      assert.strictEqual(tx.amount, 150);
      assert.strictEqual(tx.direction, 'CREDIT');
      assert.strictEqual(tx.description, 'Daily login reward (Day 1 streak)');

      // Verify getTodayChallenge immediately reflects updated streak
      const todayInfoAfter = await dailyChallengeService.getTodayChallenge(testUser2._id, today);
      assert.strictEqual(todayInfoAfter.isCompleted, true);
      assert.strictEqual(todayInfoAfter.streak.currentStreak, 1);
      assert.strictEqual(todayInfoAfter.streak.longestStreak, 1);
    });

    it('2.2 Same-day re-completion does NOT increment streak or award duplicate coins', async () => {
      const today = '2026-11-24';

      // Start another session for today
      const session2 = await gameSessionService.startSession(testUser2._id, 25, {
        isDailyChallenge: true,
        challengeDate: today,
      });

      const initialWallet = await walletService.getOrCreateWallet(testUser2._id);

      // Complete second session
      const completionResult2 = await dailyChallengeService.completeDailyChallenge(
        testUser2._id,
        session2._id,
        {
          score: 650,
          moves: 4,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 650,
            movesTaken: 4,
            applesRemaining: [],
          },
        }
      );

      assert.strictEqual(completionResult2.success, true);
      assert.strictEqual(completionResult2.alreadyCompleted, true);
      assert.strictEqual(completionResult2.rewardCoins, 0); // zero duplicate coins
      assert.strictEqual(completionResult2.streak.currentStreak, 1); // remains 1
      assert.strictEqual(completionResult2.streak.longestStreak, 1);

      // Verify wallet balance did not increase
      const walletAfter = await walletService.getOrCreateWallet(testUser2._id);
      assert.strictEqual(walletAfter.balance, initialWallet.balance);
    });

    it('2.3 Consecutive day completion increments streak from 1 to 2', async () => {
      // Simulate that the previous completion was yesterday: '2026-11-24'
      const yesterday = '2026-11-24';
      const today = '2026-11-25';

      await PlayerDailyStreak.findOneAndUpdate(
        { userId: testUser2._id },
        {
          $set: {
            currentStreak: 1,
            longestStreak: 1,
            lastCompletedDate: yesterday,
          },
        }
      );

      // Session for today '2026-11-25'
      const session = await gameSessionService.startSession(testUser2._id, 25, {
        isDailyChallenge: true,
        challengeDate: today,
      });

      const result = await dailyChallengeService.completeDailyChallenge(
        testUser2._id,
        session._id,
        {
          score: 700,
          moves: 6,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 700,
            movesTaken: 6,
            applesRemaining: [],
          },
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.streak.currentStreak, 2);
      assert.strictEqual(result.streak.longestStreak, 2);
      assert.strictEqual(result.streak.lastCompletedDate, today);
    });

    it('2.4 Missing a day breaks active streak (resets to 1) while preserving longestStreak', async () => {
      // Player had a 5-day streak, but last completed date was 3 days ago
      const threeDaysAgo = '2026-11-20';
      const today = '2026-11-23';

      await PlayerDailyStreak.findOneAndUpdate(
        { userId: testUser2._id },
        {
          $set: {
            currentStreak: 5,
            longestStreak: 5,
            lastCompletedDate: threeDaysAgo,
          },
        }
      );

      // Check effective streak before completing
      // If player missed a day, effectiveCurrentStreak returns 0 before today's play
      const todayOverview = await dailyChallengeService.getTodayChallenge(testUser2._id, today);
      assert.strictEqual(todayOverview.streak.currentStreak, 0); // broken streak
      assert.strictEqual(todayOverview.streak.longestStreak, 5); // preserved longest streak

      // Now complete today's challenge
      const session = await gameSessionService.startSession(testUser2._id, 25, {
        isDailyChallenge: true,
        challengeDate: today,
      });

      const result = await dailyChallengeService.completeDailyChallenge(
        testUser2._id,
        session._id,
        {
          score: 750,
          moves: 7,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 750,
            movesTaken: 7,
            applesRemaining: [],
          },
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.streak.currentStreak, 1); // reset to 1
      assert.strictEqual(result.streak.longestStreak, 5); // longest streak untouched!
      assert.strictEqual(result.streak.lastCompletedDate, today);
    });

    it('2.5 Session completion via standard POST /api/games/complete auto-syncs daily streak', async () => {
      // Test that even if the client calls the general complete endpoint (/api/games/complete),
      // the backend gameSessionService auto-syncs streak and daily rewards for daily sessions.
      const dateTarget = '2026-12-10';

      // Start session with isDailyChallenge
      const session = await gameSessionService.startSession(testUser2._id, 25, {
        isDailyChallenge: true,
        challengeDate: dateTarget,
      });

      // Call standard /api/games/complete via HTTP
      const res = await fetch(`${baseUrl}/games/complete`, {
        method: 'POST',
        headers: {
          Authorization: authHeaderUser2,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session._id,
          moves: 4,
          score: 800,
          checkpoint: {
            wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
            currentScore: 800,
            movesTaken: 4,
            applesRemaining: [],
          },
        }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.session.status, 'COMPLETED');
      assert.ok(data.data.rewards.dailyStreak !== undefined);

      // Verify DailyChallengeCompletion was created
      const completion = await DailyChallengeCompletion.findOne({
        userId: testUser2._id,
        date: dateTarget,
      });
      assert.ok(completion);
      assert.strictEqual(completion.levelNumber, 25);
    });
  });
});
