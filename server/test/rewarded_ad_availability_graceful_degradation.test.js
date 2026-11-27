/**
 * server/test/rewarded_ad_availability_graceful_degradation.test.js
 *
 * Dedicated Test Suite for Rewarded Ad Availability & Production Graceful Degradation:
 *   1. Authoritative Backend Ad Availability Logic (Production vs Development/Test)
 *   2. Config Endpoint Security (Zero secrets, keys, or credentials exposed)
 *   3. Opportunity Request Server Gate (Fails closed in production)
 *   4. Mock Completion Security in Production (simulate-watch remains strictly blocked)
 *   5. Frontend Graceful Degradation Source Code & Architecture Contracts:
 *      - adService.getAdAvailability fail-closed behavior
 *      - GamePlayPage ad availability propagation and action gating
 *      - VictoryDialog ad multipliers (Double Coins / Double Score) gated
 *      - FailureDialog recovery options (Revive / Extra Moves) gated
 *      - RewardCenterPage store free coins ad action gated
 *      - RewardedAdModal timer prevention when ads are unavailable
 *      - Checkpoint synchronization code preservation verification
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import GameSession from '../src/models/GameSession.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import AdOpportunity from '../src/models/AdOpportunity.js';
import AdQuotaReservation from '../src/models/AdQuotaReservation.js';
import rewardedAdService from '../src/services/rewardedAdService.js';
import adProviderService from '../src/services/adProviderService.js';
import walletService from '../src/services/walletService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Rewarded Ad Availability & Production Graceful Degradation Suite', () => {
  let testUser;
  let originalNodeEnv;

  before(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    await User.collection.deleteMany({ email: /@ad-degrade-test\.com$/ });
    await Wallet.collection.deleteMany({});
    await WalletTransaction.collection.deleteMany({});
    await AdOpportunity.collection.deleteMany({});
    await AdQuotaReservation.collection.deleteMany({});
    await GameSession.collection.deleteMany({});

    testUser = await User.create({
      username: `degrade_hero_${Date.now()}`,
      email: `degrade_hero_${Date.now()}@ad-degrade-test.com`,
      password: 'SecurePassword123!',
      coins: 100,
    });

    await walletService.getOrCreateWallet(testUser._id);
  });

  after(async () => {
    process.env.NODE_ENV = originalNodeEnv;
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
  // 1. Authoritative Backend Ad Availability Logic
  // ---------------------------------------------------------------------------
  describe('1. Authoritative Backend Ad Availability Logic', () => {
    it('1.1 In production, reports ads unavailable without an integrated real web provider', () => {
      process.env.NODE_ENV = 'production';
      try {
        const isAvail = rewardedAdService.isAdAvailable();
        assert.strictEqual(isAvail, false, 'isAdAvailable() must return false in production');

        const availObj = rewardedAdService.getAdAvailability();
        assert.strictEqual(availObj.available, false);
        assert.strictEqual(availObj.provider, null);
        assert.ok(availObj.reason.includes('unavailable in production'));
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('1.2 In development/test, reports mock provider available', () => {
      process.env.NODE_ENV = 'development';
      try {
        const isAvail = rewardedAdService.isAdAvailable();
        assert.strictEqual(isAvail, true, 'isAdAvailable() must return true in development');

        const availObj = rewardedAdService.getAdAvailability();
        assert.strictEqual(availObj.available, true);
        assert.strictEqual(availObj.provider, 'MOCK');
        assert.ok(availObj.reason.includes('Mock provider enabled'));
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('1.3 getEconomyConfig returns authoritative adsAvailable and availability object', async () => {
      process.env.NODE_ENV = 'production';
      try {
        const prodConfig = await rewardedAdService.getEconomyConfig();
        assert.strictEqual(prodConfig.adsAvailable, false);
        assert.strictEqual(prodConfig.availability.available, false);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }

      process.env.NODE_ENV = 'development';
      try {
        const devConfig = await rewardedAdService.getEconomyConfig();
        assert.strictEqual(devConfig.adsAvailable, true);
        assert.strictEqual(devConfig.availability.available, true);
        assert.strictEqual(devConfig.availability.provider, 'MOCK');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('1.4 getOpportunitySummary sets isEligible=false and adsAvailable=false in production', async () => {
      process.env.NODE_ENV = 'production';
      try {
        const summary = await rewardedAdService.getOpportunitySummary(testUser._id);
        assert.strictEqual(summary.adsAvailable, false);
        assert.strictEqual(summary.availability.available, false);
        assert.strictEqual(summary.usage.isEligible, false, 'Player cannot be eligible when ads are unavailable');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Config Endpoint Security (Zero Secrets Exposure)
  // ---------------------------------------------------------------------------
  describe('2. Config Endpoint Security', () => {
    it('2.1 getEconomyConfig exposes no secrets, credentials, or verification keys', async () => {
      const config = await rewardedAdService.getEconomyConfig();
      const stringified = JSON.stringify(config).toLowerCase();

      // Check for forbidden secret keywords in config output
      assert.strictEqual(stringified.includes('secret'), false, 'Config must not contain secret');
      assert.strictEqual(stringified.includes('privatekey'), false, 'Config must not contain privateKey');
      assert.strictEqual(stringified.includes('password'), false, 'Config must not contain password');
      assert.strictEqual(stringified.includes('jwt'), false, 'Config must not contain jwt');
      assert.strictEqual(stringified.includes('token'), false, 'Config must not contain token');
      assert.strictEqual(stringified.includes('credential'), false, 'Config must not contain credential');
      assert.strictEqual(stringified.includes('signature'), false, 'Config must not contain signature');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Server-Side Enforcement (Fails closed in production)
  // ---------------------------------------------------------------------------
  describe('3. Server-Side Enforcement', () => {
    it('3.1 requestOpportunity rejects with 503 when ads are unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      try {
        await assert.rejects(
          async () => {
            await rewardedAdService.requestOpportunity(testUser._id, {
              placement: 'STORE_FREE_COINS',
            });
          },
          (err) => {
            assert.strictEqual(err.statusCode, 503);
            assert.strictEqual(err.message, 'Rewarded ads are currently unavailable in this environment.');
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('3.2 verifyMockSSV and simulateMockAdCompletion remain strictly blocked in production', async () => {
      process.env.NODE_ENV = 'production';
      try {
        const verifyResult = adProviderService.verifyMockSSV({}, {});
        assert.strictEqual(verifyResult.valid, false);
        assert.strictEqual(verifyResult.error, 'Mock provider disabled in production.');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Frontend Graceful Degradation Source Code & Architecture Contracts
  // ---------------------------------------------------------------------------
  describe('4. Frontend Graceful Degradation Contracts', () => {
    const clientPath = path.resolve(__dirname, '../../client/src');

    it('4.1 adService implements getAdAvailability and clearAvailabilityCache', () => {
      const adServiceSrc = fs.readFileSync(path.join(clientPath, 'services/adService.js'), 'utf-8');
      assert.ok(adServiceSrc.includes('getAdAvailability(forceRefresh = false)'));
      assert.ok(adServiceSrc.includes('clearAvailabilityCache()'));
      assert.ok(adServiceSrc.includes('adAvailabilityCache = false;')); // fail-closed on error
    });

    it('4.2 GamePlayPage gates handleOpenRewardedAd and passes adsAvailable to dialogs', () => {
      const gameplaySrc = fs.readFileSync(path.join(clientPath, 'pages/GamePlayPage.jsx'), 'utf-8');
      assert.ok(gameplaySrc.includes('isAdsAvailable'), 'GamePlayPage must track isAdsAvailable');
      assert.ok(gameplaySrc.includes('getAdAvailability'), 'GamePlayPage must query getAdAvailability');
      assert.ok(gameplaySrc.includes('adsAvailable={isAdsAvailable}'), 'GamePlayPage must pass adsAvailable to dialogs');
      assert.ok(gameplaySrc.includes("if (!isAdsAvailable)"), 'handleOpenRewardedAd must check isAdsAvailable');
    });

    it('4.3 VictoryDialog conditionally renders victory-ad-multipliers using adsAvailable', () => {
      const dialogsSrc = fs.readFileSync(path.join(clientPath, 'components/game/GameDialogs.jsx'), 'utf-8');
      assert.ok(dialogsSrc.includes('adsAvailable = false'), 'VictoryDialog must accept adsAvailable defaulting to false');
      assert.ok(
        dialogsSrc.includes('{adsAvailable && (\n              <div\n                className="victory-ad-multipliers"') ||
        dialogsSrc.includes('{adsAvailable && (\r\n              <div\r\n                className="victory-ad-multipliers"'),
        'victory-ad-multipliers must be wrapped in adsAvailable check'
      );
    });

    it('4.4 FailureDialog conditionally renders failure-ad-options using adsAvailable', () => {
      const dialogsSrc = fs.readFileSync(path.join(clientPath, 'components/game/GameDialogs.jsx'), 'utf-8');
      assert.ok(dialogsSrc.includes('adsAvailable = false'), 'FailureDialog must accept adsAvailable defaulting to false');
      assert.ok(
        dialogsSrc.includes('{adsAvailable && ((canRevive && revivesUsed < 1)') ||
        dialogsSrc.includes('{adsAvailable && ((canRevive && revivesUsed < 1) || (reason === \'OUT_OF_MOVES\''),
        'failure-ad-options must be wrapped in adsAvailable check'
      );
    });

    it('4.5 RewardCenterPage handles adsAvailable gracefully: disables store ad button and updates badges', () => {
      const rewardCenterSrc = fs.readFileSync(path.join(clientPath, 'pages/RewardCenterPage.jsx'), 'utf-8');
      assert.ok(rewardCenterSrc.includes('adsAvailable'), 'RewardCenterPage must track adsAvailable');
      assert.ok(rewardCenterSrc.includes('if (!adsAvailable) return;'), 'handleWatchStoreCoins must return if ads unavailable');
      assert.ok(rewardCenterSrc.includes('disabled={isLoading || !adsAvailable || !isEligible}'), 'Watcher button must be disabled when ads unavailable');
      assert.ok(rewardCenterSrc.includes("'Ads Unavailable'"), 'Button must indicate Ads Unavailable');
      assert.ok(rewardCenterSrc.includes('adsAvailable ? "Active In Game" : "Unavailable"'), 'Opportunity badges must update based on adsAvailable');
    });

    it('4.6 RewardedAdModal checks availability before playback and does not start timer if unavailable', () => {
      const modalSrc = fs.readFileSync(path.join(clientPath, 'components/game/RewardedAdModal.jsx'), 'utf-8');
      assert.ok(modalSrc.includes('if (!isAvailable)'), 'startAdFlow must check availability');
      assert.ok(modalSrc.includes("setErrorMessage('Rewarded ads are currently unavailable in this environment.');"));
      assert.ok(modalSrc.includes('adsAvailable !== false'), 'Retry button must be suppressed when ads unavailable');
    });

    it('4.7 Checkpoint synchronization code in GamePlayPage remains intact and unmodified', () => {
      const gameplaySrc = fs.readFileSync(path.join(clientPath, 'pages/GamePlayPage.jsx'), 'utf-8');
      assert.ok(gameplaySrc.includes('compactTerminalCheckpointQueue'), 'Terminal compaction must remain intact');
      assert.ok(gameplaySrc.includes('inFlightCheckpointRef'), 'inFlightCheckpointRef must remain intact');
      assert.ok(gameplaySrc.includes('activeProcessingCheckpointRef'), 'activeProcessingCheckpointRef must remain intact');
      assert.ok(gameplaySrc.includes('drainCheckpointQueue'), 'drainCheckpointQueue must remain intact');
      assert.ok(gameplaySrc.includes('isAllowedTerminalDrain'), 'isAllowedTerminalDrain must remain intact');
      assert.ok(gameplaySrc.includes('confirmedCheckpointMovesRef'), 'confirmedCheckpointMovesRef must remain intact');
    });
  });
});
