/**
 * server/test/leaderboard_achievements.test.js
 * 
 * Comprehensive Unit and Integration Test Suite for:
 *   1. Authoritative Global Leaderboard (Sorting by Score, Stars, Tie-breaking)
 *   2. Personal Rank Calculation (myEntry / myRank computation)
 *   3. Leaderboard Pagination & Capping
 *   4. Guest vs Authenticated Leaderboard Access
 *   5. 10 Distinct Achievements Progress Tracking:
 *      - FIRST_VICTORY, APPLE_COLLECTOR, WORM_MASTER, SPEED_RUNNER, STAR_CHAMPION,
 *      - PIT_BRIDGER, KEY_HUNTER, LEVEL_EXPLORER, MYSTERY_LOVER, VETERAN_PLAYER
 *   6. Atomic Claim Execution & Wallet Crediting (ACHIEVEMENT_REWARD)
 *   7. Idempotency & Replay Protection (No double-rewarding on repeated claims)
 *   8. REST API Endpoint Integration (GET /api/leaderboard, GET /api/achievements, POST /api/achievements/:id/claim)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import GameSession from '../src/models/GameSession.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import PlayerAchievement, { ACHIEVEMENT_DEFINITIONS } from '../src/models/PlayerAchievement.js';
import leaderboardService from '../src/services/leaderboardService.js';
import achievementService from '../src/services/achievementService.js';
import walletService from '../src/services/walletService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Phase 9 Step 3 — Global Leaderboard & 10 Achievements Test Suite', () => {
  let user1, user2, user3;

  before(async () => {
    try {
      const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
      assertValidTestTarget(mongoUri);
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri);
      }

      // Clean up test collections
      await User.collection.deleteMany({ email: /@leaderboard-test\.com$/ });
      await PlayerProgress.collection.deleteMany({});
      await PlayerAchievement.collection.deleteMany({});
      await GameSession.collection.deleteMany({});
      await Wallet.collection.deleteMany({});
      await WalletTransaction.collection.deleteMany({});

    // Create 3 test users with varying achievements and scores
    user1 = await User.create({
      username: `worm_alpha_${Date.now()}`,
      email: `alpha_${Date.now()}@leaderboard-test.com`,
      password: 'Password123!',
      coins: 50,
    });
    await walletService.getOrCreateWallet(user1._id);

    user2 = await User.create({
      username: `worm_beta_${Date.now()}`,
      email: `beta_${Date.now()}@leaderboard-test.com`,
      password: 'Password123!',
      coins: 100,
    });
    await walletService.getOrCreateWallet(user2._id);

    user3 = await User.create({
      username: `worm_gamma_${Date.now()}`,
      email: `gamma_${Date.now()}@leaderboard-test.com`,
      password: 'Password123!',
      coins: 200,
    });
    await walletService.getOrCreateWallet(user3._id);

    // Create authoritative PlayerProgress records:
    // user1: High score 5000, stars 25, 8 levels
    await PlayerProgress.create({
      userId: user1._id,
      totalScore: 5000,
      totalStars: 25,
      totalApplesEaten: 60,
      highestUnlockedLevel: 9,
      completedLevels: Array.from({ length: 8 }, (_, i) => ({
        levelNumber: i + 1,
        stars: 3,
        highScore: 625,
        fastestTimeSeconds: 12, // <= 15s (SPEED_RUNNER eligible)
      })),
    });

    // user2: High score 3000, stars 35, 12 levels
    await PlayerProgress.create({
      userId: user2._id,
      totalScore: 3000,
      totalStars: 35,
      totalApplesEaten: 40,
      highestUnlockedLevel: 13,
      totalMysteryApplesEaten: 6, // >= 5 (MYSTERY_LOVER eligible)
      completedLevels: Array.from({ length: 12 }, (_, i) => ({
        levelNumber: i + 1,
        stars: 3,
        highScore: 250,
        fastestTimeSeconds: 30,
      })),
    });

    // user3: High score 9000, stars 15, 22 levels
    await PlayerProgress.create({
      userId: user3._id,
      totalScore: 9000,
      totalStars: 15,
      totalApplesEaten: 120,
      highestUnlockedLevel: 23,
      completedLevels: Array.from({ length: 22 }, (_, i) => ({
        levelNumber: i + 1,
        stars: 1,
        highScore: 409,
        fastestTimeSeconds: 25,
      })),
    });

    // Create completed GameSessions for special achievements:
    // user1 bridged pit and grew worm to 7 segments
    await GameSession.create({
      userId: user1._id,
      levelId: new mongoose.Types.ObjectId(),
      levelNumber: 1,
      status: 'COMPLETED',
      durationSeconds: 12,
      score: 1000,
      checkpoint: {
        movesTaken: 8,
        currentScore: 1000,
        wormState: [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
          { x: 3, y: 5 },
          { x: 2, y: 5 },
          { x: 1, y: 5 },
          { x: 0, y: 5 },
          { x: 0, y: 6 }, // 7 segments (WORM_MASTER eligible)
        ],
        filledPits: ['3,5'], // pit filled (PIT_BRIDGER eligible)
        collectedKeys: ['key_gold', 'key_silver'],
      },
      initialState: {
        grid: { cols: 10, rows: 10 },
        worm: { x: 2, y: 2, initialLength: 2 },
      },
    });

    // user1 collected more keys in session 2 to reach >= 5 keys (KEY_HUNTER eligible)
    await GameSession.create({
      userId: user1._id,
      levelId: new mongoose.Types.ObjectId(),
      levelNumber: 2,
      status: 'COMPLETED',
      durationSeconds: 20,
      score: 1200,
      checkpoint: {
        movesTaken: 10,
        currentScore: 1200,
        wormState: [{ x: 3, y: 3 }, { x: 2, y: 3 }],
        collectedKeys: ['key_1', 'key_2', 'key_3'], // total 2 + 3 = 5 keys
      },
      initialState: {
        grid: { cols: 10, rows: 10 },
        worm: { x: 2, y: 2, initialLength: 2 },
      },
    });
    } catch (err) {
      console.error('BEFORE HOOK ERROR OCCURRED:', err);
      throw err;
    }
  });

  after(async () => {
    await User.collection.deleteMany({ email: /@leaderboard-test\.com$/ });
    await PlayerProgress.collection.deleteMany({});
    await PlayerAchievement.collection.deleteMany({});
    await GameSession.collection.deleteMany({});
    await Wallet.collection.deleteMany({});
    await WalletTransaction.collection.deleteMany({});
  });

  describe('Part A — Global Leaderboard Service', () => {
    it('ranks players primarily by totalScore DESC by default', async () => {
      const res = await leaderboardService.getLeaderboard({ metric: 'totalScore' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.leaderboard.length, 3);

      // Rank #1: user3 (9000 score)
      assert.strictEqual(res.leaderboard[0].userId.toString(), user3._id.toString());
      assert.strictEqual(res.leaderboard[0].rank, 1);
      assert.strictEqual(res.leaderboard[0].totalScore, 9000);

      // Rank #2: user1 (5000 score)
      assert.strictEqual(res.leaderboard[1].userId.toString(), user1._id.toString());
      assert.strictEqual(res.leaderboard[1].rank, 2);
      assert.strictEqual(res.leaderboard[1].totalScore, 5000);

      // Rank #3: user2 (3000 score)
      assert.strictEqual(res.leaderboard[2].userId.toString(), user2._id.toString());
      assert.strictEqual(res.leaderboard[2].rank, 3);
      assert.strictEqual(res.leaderboard[2].totalScore, 3000);
    });

    it('ranks players by totalStars DESC when requested', async () => {
      const res = await leaderboardService.getLeaderboard({ metric: 'totalStars' });
      assert.strictEqual(res.success, true);

      // Rank #1 by stars: user2 (35 stars)
      assert.strictEqual(res.leaderboard[0].userId.toString(), user2._id.toString());
      assert.strictEqual(res.leaderboard[0].rank, 1);
      assert.strictEqual(res.leaderboard[0].totalStars, 35);

      // Rank #2 by stars: user1 (25 stars)
      assert.strictEqual(res.leaderboard[1].userId.toString(), user1._id.toString());
      assert.strictEqual(res.leaderboard[1].rank, 2);
      assert.strictEqual(res.leaderboard[1].totalStars, 25);

      // Rank #3 by stars: user3 (15 stars)
      assert.strictEqual(res.leaderboard[2].userId.toString(), user3._id.toString());
      assert.strictEqual(res.leaderboard[2].rank, 3);
      assert.strictEqual(res.leaderboard[2].totalStars, 15);
    });

    it('calculates the requesting player personal rank (myEntry) accurately', async () => {
      const res = await leaderboardService.getLeaderboard({
        metric: 'totalScore',
        currentUserId: user1._id.toString(),
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.myEntry);
      assert.strictEqual(res.myEntry.userId.toString(), user1._id.toString());
      assert.strictEqual(res.myEntry.rank, 2);
      assert.strictEqual(res.myEntry.totalScore, 5000);
      assert.strictEqual(res.myEntry.completedLevelsCount, 8);
    });

    it('handles pagination with limit and skip', async () => {
      const page1 = await leaderboardService.getLeaderboard({ page: 1, limit: 2 });
      assert.strictEqual(page1.leaderboard.length, 2);
      assert.strictEqual(page1.page, 1);
      assert.strictEqual(page1.totalPages, 2);
      assert.strictEqual(page1.totalPlayers, 3);

      const page2 = await leaderboardService.getLeaderboard({ page: 2, limit: 2 });
      assert.strictEqual(page2.leaderboard.length, 1);
      assert.strictEqual(page2.leaderboard[0].rank, 3);
      assert.strictEqual(page2.leaderboard[0].userId.toString(), user2._id.toString());
    });

    it('supports guest viewers with myEntry = null', async () => {
      const res = await leaderboardService.getLeaderboard({ currentUserId: null });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.myEntry, null);
      assert.strictEqual(res.leaderboard.length, 3);
    });
  });

  describe('Part B — 10 Distinct Achievements Evaluation', () => {
    it('retrieves and correctly evaluates all 10 distinct achievements', async () => {
      const list = await achievementService.getUserAchievements(user1._id.toString());
      assert.strictEqual(list.length, 10);

      const byId = Object.fromEntries(list.map((a) => [a.id, a]));

      // 1. FIRST_VICTORY (target 1, completed 8 levels) -> unlocked
      assert.strictEqual(byId.FIRST_VICTORY.unlocked, true);
      assert.strictEqual(byId.FIRST_VICTORY.progress, 1);

      // 2. APPLE_COLLECTOR (target 50, eaten 60) -> unlocked
      assert.strictEqual(byId.APPLE_COLLECTOR.unlocked, true);
      assert.strictEqual(byId.APPLE_COLLECTOR.progress, 50);

      // 3. WORM_MASTER (target 6, max worm 7) -> unlocked
      assert.strictEqual(byId.WORM_MASTER.unlocked, true);
      assert.strictEqual(byId.WORM_MASTER.progress, 6);

      // 4. SPEED_RUNNER (target 1, fastestTimeSeconds 12s <= 15s) -> unlocked
      assert.strictEqual(byId.SPEED_RUNNER.unlocked, true);
      assert.strictEqual(byId.SPEED_RUNNER.progress, 1);

      // 5. STAR_CHAMPION (target 30, stars 25) -> locked
      assert.strictEqual(byId.STAR_CHAMPION.unlocked, false);
      assert.strictEqual(byId.STAR_CHAMPION.progress, 25);

      // 6. PIT_BRIDGER (target 1, pit bridged with boulder) -> unlocked
      assert.strictEqual(byId.PIT_BRIDGER.unlocked, true);
      assert.strictEqual(byId.PIT_BRIDGER.progress, 1);

      // 7. KEY_HUNTER (target 5, keys collected = 2 + 3 = 5) -> unlocked
      assert.strictEqual(byId.KEY_HUNTER.unlocked, true);
      assert.strictEqual(byId.KEY_HUNTER.progress, 5);

      // 8. LEVEL_EXPLORER (target 10, highestUnlocked = 9) -> locked
      assert.strictEqual(byId.LEVEL_EXPLORER.unlocked, false);
      assert.strictEqual(byId.LEVEL_EXPLORER.progress, 9);

      // 9. MYSTERY_LOVER (target 5, mystery eaten = 0 for user1) -> locked
      assert.strictEqual(byId.MYSTERY_LOVER.unlocked, false);

      // 10. VETERAN_PLAYER (target 20, completed 8 levels) -> locked
      assert.strictEqual(byId.VETERAN_PLAYER.unlocked, false);
      assert.strictEqual(byId.VETERAN_PLAYER.progress, 8);
    });

    it('correctly unlocks achievements for user2 (STAR_CHAMPION, LEVEL_EXPLORER, MYSTERY_LOVER)', async () => {
      const list = await achievementService.getUserAchievements(user2._id.toString());
      const byId = Object.fromEntries(list.map((a) => [a.id, a]));

      // user2 has 35 stars -> STAR_CHAMPION unlocked
      assert.strictEqual(byId.STAR_CHAMPION.unlocked, true);

      // user2 has highestUnlocked 13 -> LEVEL_EXPLORER unlocked
      assert.strictEqual(byId.LEVEL_EXPLORER.unlocked, true);

      // user2 has 6 mystery apples -> MYSTERY_LOVER unlocked
      assert.strictEqual(byId.MYSTERY_LOVER.unlocked, true);
    });

    it('correctly unlocks VETERAN_PLAYER for user3 (22 completed levels)', async () => {
      const list = await achievementService.getUserAchievements(user3._id.toString());
      const byId = Object.fromEntries(list.map((a) => [a.id, a]));

      assert.strictEqual(byId.VETERAN_PLAYER.unlocked, true);
      assert.strictEqual(byId.VETERAN_PLAYER.progress, 20);
    });
  });

  describe('Part C — Atomic Claim & Wallet Crediting', () => {
    it('claims an unlocked achievement, crediting wallet and updating status', async () => {
      const initialWallet = await walletService.getOrCreateWallet(user1._id);
      const initialBalance = initialWallet.balance;

      const def = ACHIEVEMENT_DEFINITIONS.FIRST_VICTORY;
      const claimResult = await achievementService.claimAchievement(
        user1._id.toString(),
        'FIRST_VICTORY'
      );

      assert.strictEqual(claimResult.success, true);
      assert.strictEqual(claimResult.claimed, true);
      assert.strictEqual(claimResult.alreadyClaimed, false);
      assert.strictEqual(claimResult.rewardCoins, def.rewardCoins);

      // Verify wallet balance updated
      const updatedWallet = await walletService.getOrCreateWallet(user1._id);
      assert.strictEqual(updatedWallet.balance, initialBalance + def.rewardCoins);

      // Verify transaction ledger record exists
      const tx = await WalletTransaction.findOne({
        userId: user1._id,
        idempotencyKey: `achievement_claim_${user1._id}_FIRST_VICTORY`,
      });
      assert.ok(tx);
      assert.strictEqual(tx.type, 'ACHIEVEMENT_REWARD');
      assert.strictEqual(tx.amount, def.rewardCoins);
      assert.strictEqual(tx.direction, 'CREDIT');

      // Verify PlayerAchievement status is claimed
      const pa = await PlayerAchievement.findOne({
        userId: user1._id,
        achievementId: 'FIRST_VICTORY',
      });
      assert.strictEqual(pa.claimed, true);
      assert.ok(pa.claimedAt);
    });

    it('is strictly idempotent on repeated claim attempts (zero duplicate crediting)', async () => {
      const walletBefore = await walletService.getOrCreateWallet(user1._id);

      // Re-claim FIRST_VICTORY
      const repeatClaim = await achievementService.claimAchievement(
        user1._id.toString(),
        'FIRST_VICTORY'
      );

      assert.strictEqual(repeatClaim.success, true);
      assert.strictEqual(repeatClaim.claimed, true);
      assert.strictEqual(repeatClaim.alreadyClaimed, true);

      // Verify balance did NOT change
      const walletAfter = await walletService.getOrCreateWallet(user1._id);
      assert.strictEqual(walletAfter.balance, walletBefore.balance);
    });

    it('rejects claim for an unearned/locked achievement', async () => {
      await assert.rejects(
        async () => {
          await achievementService.claimAchievement(user1._id.toString(), 'STAR_CHAMPION');
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /not unlocked yet/i);
          return true;
        }
      );
    });

    it('rejects claim for an invalid achievement identifier', async () => {
      await assert.rejects(
        async () => {
          await achievementService.claimAchievement(user1._id.toString(), 'NON_EXISTENT_BADGE');
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /unknown achievement/i);
          return true;
        }
      );
    });
  });

  describe('Part D — REST API Endpoints Integration', () => {
    let server;
    let baseUrl;
    let authHeader;

    before((t, done) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        const secret = process.env.JWT_SECRET || 'test_jwt_secret_phase9_step3_12345';
        process.env.JWT_SECRET = secret;
        const token = jwt.sign(
          { userId: user1._id.toString(), role: user1.role || 'player' },
          secret,
          { expiresIn: '1h' }
        );
        authHeader = `Bearer ${token}`;
        done();
      });
    });

    after((t, done) => {
      if (server) {
        server.close(done);
      } else {
        done();
      }
    });

    it('GET /api/leaderboard returns rankings with myEntry for authenticated user', async () => {
      const res = await fetch(`${baseUrl}/leaderboard?metric=totalScore`, {
        headers: { Authorization: authHeader },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.metric, 'totalScore');
      assert.ok(Array.isArray(data.leaderboard));
      assert.strictEqual(data.leaderboard.length, 3);
      assert.ok(data.myEntry);
      assert.strictEqual(data.myEntry.userId.toString(), user1._id.toString());
      assert.strictEqual(data.myEntry.rank, 2);
    });

    it('GET /api/leaderboard returns rankings with null myEntry for unauthenticated guest', async () => {
      const res = await fetch(`${baseUrl}/leaderboard`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.myEntry, null);
      assert.strictEqual(data.leaderboard.length, 3);
    });

    it('GET /api/achievements returns 10 distinct achievements with progress', async () => {
      const res = await fetch(`${baseUrl}/achievements`, {
        headers: { Authorization: authHeader },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.achievements.length, 10);

      const appleCollector = data.achievements.find((a) => a.id === 'APPLE_COLLECTOR');
      assert.ok(appleCollector);
      assert.strictEqual(appleCollector.unlocked, true);
      assert.strictEqual(appleCollector.target, 50);
      assert.strictEqual(appleCollector.progress, 50);
    });

    it('POST /api/achievements/:id/claim credits wallet and returns updated balance', async () => {
      const res = await fetch(`${baseUrl}/achievements/APPLE_COLLECTOR/claim`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.claimed, true);
      assert.strictEqual(data.alreadyClaimed, false);
      assert.strictEqual(data.rewardCoins, 100);
      assert.ok(data.wallet);
    });

    it('POST /api/achievements/:id/claim is idempotent on second attempt', async () => {
      const res = await fetch(`${baseUrl}/achievements/APPLE_COLLECTOR/claim`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.claimed, true);
      assert.strictEqual(data.alreadyClaimed, true);
    });

    it('POST /api/achievements/:id/claim rejects claim for locked achievement with 400', async () => {
      const res = await fetch(`${baseUrl}/achievements/STAR_CHAMPION/claim`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });
      assert.strictEqual(res.status, 400);

      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /not unlocked yet/i);
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
});
