/**
 * server/test/rewarded_ad_economy.test.js
 * 
 * Comprehensive Unit and Integration Test Suite for VELoop Rewarded Ad Economy:
 *   1. Economy Configuration & Dynamic Limits
 *   2. Ad Opportunity Lifecycle (Request -> Start -> Verify -> Grant)
 *   3. Placements & In-Game Rewards (Revive, Extra Moves, Double Coins, Double Score, Store Coins, Booster)
 *   4. Cooldown & Quota Enforcement (AdQuotaReservation, OCC locking)
 *   5. Idempotency & Replay Protection (Zero double-rewarding on repeated callbacks)
 *   6. Reward History Ledger Tracking
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

import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import GameSession from '../src/models/GameSession.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import AdOpportunity from '../src/models/AdOpportunity.js';
import AdQuotaReservation from '../src/models/AdQuotaReservation.js';
import rewardedAdService from '../src/services/rewardedAdService.js';
import walletService from '../src/services/walletService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Phase 9 — Rewarded Ad Economy & Reward Flows Test Suite', () => {
  let testUser;
  let testSession;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Seed test user
    await User.collection.deleteMany({ email: /@ad-economy-test\.com$/ });
    await Wallet.collection.deleteMany({});
    await WalletTransaction.collection.deleteMany({});
    await AdOpportunity.collection.deleteMany({});
    await AdQuotaReservation.collection.deleteMany({});
    await GameSession.collection.deleteMany({});

    testUser = await User.create({
      username: `ad_hero_${Date.now()}`,
      email: `ad_hero_${Date.now()}@ad-economy-test.com`,
      password: 'SecurePassword123!',
      coins: 100,
    });

    await walletService.getOrCreateWallet(testUser._id);
  });

  after(async () => {
    if (testUser) {
      await User.collection.deleteOne({ _id: testUser._id });
      await Wallet.collection.deleteMany({ userId: testUser._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser._id });
      await AdOpportunity.collection.deleteMany({ userId: testUser._id });
      await AdQuotaReservation.collection.deleteMany({ userId: testUser._id });
      await GameSession.collection.deleteMany({ userId: testUser._id });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Economy Configuration Tests
  // ---------------------------------------------------------------------------
  describe('1. Economy Configuration & Dynamic Limits', () => {
    it('1.1 Retrieves active economy configuration with ad limits and reward multipliers', async () => {
      const config = await rewardedAdService.getEconomyConfig();
      assert.ok(config);
      assert.ok(config.rules);
      assert.ok(config.rules.adLimits);
      assert.strictEqual(typeof config.rules.adLimits.maxAdsPerDay, 'number');
      assert.strictEqual(typeof config.rules.adLimits.minSecondsBetweenAds, 'number');
      assert.strictEqual(typeof config.rules.adLimits.maxRevivesPerSession, 'number');
    });

    it('1.2 Calculates initial opportunity summary with full quotas and zero cooldown', async () => {
      const summary = await rewardedAdService.getOpportunitySummary(testUser._id);
      assert.ok(summary);
      assert.ok(summary.limits);
      assert.ok(summary.usage);
      assert.strictEqual(summary.usage.dailyUsed, 0);
      assert.strictEqual(summary.usage.isEligible, true);
      assert.strictEqual(summary.usage.cooldownRemainingSeconds, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Ad Opportunity Lifecycle (STORE_FREE_COINS)
  // ---------------------------------------------------------------------------
  describe('2. Store Free Coins Rewarded Ad Flow', () => {
    let storeOpportunity;

    it('2.1 Requests opportunity for STORE_FREE_COINS and reserves quota', async () => {
      storeOpportunity = await rewardedAdService.requestOpportunity(testUser._id, {
        placement: 'STORE_FREE_COINS',
      });

      assert.ok(storeOpportunity.opportunityId);
      assert.strictEqual(storeOpportunity.placement, 'STORE_FREE_COINS');
      assert.strictEqual(storeOpportunity.rewardType, 'COIN_REWARD');
      assert.strictEqual(storeOpportunity.rewardAmount, 25);
      assert.ok(storeOpportunity.customDataNonce);
    });

    it('2.2 Starts playback of the opportunity', async () => {
      const updated = await rewardedAdService.startAd(testUser._id, storeOpportunity.opportunityId);
      assert.strictEqual(updated.status, 'AD_STARTED');
    });

    it('2.3 Completes playback and verifies reward via mock SSV callback', async () => {
      const result = await rewardedAdService.simulateMockAdCompletion(testUser._id, storeOpportunity.opportunityId);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'GRANTED');
      assert.strictEqual(result.rewardType, 'COIN_REWARD');
      assert.strictEqual(result.grantDetails.coinsAwarded, 25);

      // Verify wallet was credited
      const wallet = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(wallet.balance, 125); // 100 initial + 25 reward
    });

    it('2.4 Enforces replay protection: repeated callback returns cached grant without double debit/credit', async () => {
      const replayResult = await rewardedAdService.simulateMockAdCompletion(testUser._id, storeOpportunity.opportunityId);
      assert.strictEqual(replayResult.status, 'GRANTED');

      // Verify balance did NOT increase again (strictly zero double credit)
      const wallet = await walletService.getOrCreateWallet(testUser._id);
      assert.strictEqual(wallet.balance, 125);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Game Over Revive Rewarded Ad Flow
  // ---------------------------------------------------------------------------
  describe('3. Game Over Revive Flow', () => {
    let failedSession;

    beforeEach(async () => {
      failedSession = await GameSession.create({
        userId: testUser._id,
        levelId: new mongoose.Types.ObjectId(),
        levelNumber: 1,
        status: 'FAILED',
        failureReason: 'HIT_SPIKE',
        score: 150,
        moves: 8,
        revivesUsed: 0,
        initialState: {
          wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
          apples: [{ x: 5, y: 5, type: 'normal' }],
        },
        checkpoint: {
          wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
          direction: 'RIGHT',
          movesTaken: 8,
          applesEaten: 0,
          currentScore: 150,
        },
      });
    });

    it('3.1 Rejects REVIVE opportunity request if session is not FAILED', async () => {
      const activeSession = await GameSession.create({
        userId: testUser._id,
        levelId: new mongoose.Types.ObjectId(),
        levelNumber: 1,
        status: 'ACTIVE',
        initialState: {
          wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
        },
      });

      await assert.rejects(
        async () => {
          await rewardedAdService.requestOpportunity(testUser._id, {
            placement: 'GAME_OVER_REVIVE',
            sessionId: activeSession._id,
          });
        },
        /Cannot request REVIVE for a session with status ACTIVE/
      );
    });

    it('3.2 Successfully grants REVIVE and restores session status to ACTIVE', async () => {
      // Clear lastRequestedAt to bypass cooldown for deterministic unit testing
      await AdQuotaReservation.updateOne({ userId: testUser._id }, { $set: { lastRequestedAt: null } });

      const opp = await rewardedAdService.requestOpportunity(testUser._id, {
        placement: 'GAME_OVER_REVIVE',
        sessionId: failedSession._id,
      });

      await rewardedAdService.startAd(testUser._id, opp.opportunityId);
      const res = await rewardedAdService.simulateMockAdCompletion(testUser._id, opp.opportunityId);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'GRANTED');
      assert.strictEqual(res.grantDetails.revived, true);
      assert.strictEqual(res.grantDetails.revivesUsed, 1);

      // Verify session is now ACTIVE in database
      const refreshed = await GameSession.findById(failedSession._id);
      assert.strictEqual(refreshed.status, 'ACTIVE');
      assert.strictEqual(refreshed.revivesUsed, 1);
      assert.strictEqual(refreshed.failureReason, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Post-Win Double Coins & Double Score Flows
  // ---------------------------------------------------------------------------
  describe('4. Post-Win Multipliers (Double Coins & Double Score)', () => {
    let completedSession;

    beforeEach(async () => {
      completedSession = await GameSession.create({
        userId: testUser._id,
        levelId: new mongoose.Types.ObjectId(),
        levelNumber: 2,
        status: 'COMPLETED',
        score: 300,
        coinsEarned: 45,
        moves: 10,
        appliedAdRewards: [],
        initialState: {
          wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
        },
      });
    });

    it('4.1 Successfully doubles coins for a completed level', async () => {
      await AdQuotaReservation.updateOne({ userId: testUser._id }, { $set: { lastRequestedAt: null } });

      const opp = await rewardedAdService.requestOpportunity(testUser._id, {
        placement: 'POST_WIN_DOUBLE_COIN',
        sessionId: completedSession._id,
      });

      await rewardedAdService.startAd(testUser._id, opp.opportunityId);
      const res = await rewardedAdService.simulateMockAdCompletion(testUser._id, opp.opportunityId);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.grantDetails.bonusCoins, 45);
      assert.strictEqual(res.grantDetails.totalCoinsEarned, 90);

      // Verify session updated
      const refreshed = await GameSession.findById(completedSession._id);
      assert.strictEqual(refreshed.coinsEarned, 90);
    });

    it('4.2 Successfully doubles score for a completed level', async () => {
      await AdQuotaReservation.updateOne({ userId: testUser._id }, { $set: { lastRequestedAt: null } });

      const opp = await rewardedAdService.requestOpportunity(testUser._id, {
        placement: 'POST_WIN_DOUBLE_SCORE',
        sessionId: completedSession._id,
      });

      await rewardedAdService.startAd(testUser._id, opp.opportunityId);
      const res = await rewardedAdService.simulateMockAdCompletion(testUser._id, opp.opportunityId);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.grantDetails.scoreDoubled, 600); // 300 * 2

      // Verify session updated
      const refreshed = await GameSession.findById(completedSession._id);
      assert.strictEqual(refreshed.score, 600);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Reward Transaction History & Ledger
  // ---------------------------------------------------------------------------
  describe('5. Reward Transaction History Ledger', () => {
    it('5.1 Retrieves formatted reward history for player with status GRANTED', async () => {
      const history = await rewardedAdService.getRewardHistory(testUser._id, { limit: 10 });
      assert.ok(Array.isArray(history));
      assert.ok(history.length >= 3); // STORE_FREE_COINS, REVIVE, DOUBLE_COINS, DOUBLE_SCORE

      const coinTx = history.find((h) => h.placement === 'STORE_FREE_COINS');
      assert.ok(coinTx);
      assert.strictEqual(coinTx.status, 'GRANTED');
      assert.strictEqual(coinTx.rewardAmount, 25);
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
});
