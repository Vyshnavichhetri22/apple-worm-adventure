/**
 * server/test/wallet_operational_remediation.test.js
 * 
 * Phase 8 Step 3 — Operational Remediation Test Suite
 * 
 * Verifies the two critical operational fixes from Phase 8 Step 2.5 audit:
 *   Part A: Recovery Scheduler Lifecycle Integration (startup, shutdown, duplicate protection)
 *   Part B: Stale User.coins Cache Discovery & Reconciliation (proactive discovery & read healing)
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
import walletService from '../src/services/walletService.js';
import walletRecoveryService, {
  reconcileStaleUserCaches,
  runRecoveryBatch,
  startScheduledRecovery,
  stopScheduledRecovery,
  isSchedulerActive,
} from '../src/services/walletRecoveryService.js';
import {
  gracefulShutdown,
  getServerState,
} from '../src/server.js';
import {
  generateFingerprint,
  FINGERPRINT_VERSION,
} from '../src/utils/walletIntegrity.js';

describe('Phase 8 Step 3 — Operational Remediation Suite', () => {
  let testUserA;
  let testUserB;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean up lingering unsettled operations from prior test suites
    await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });

    // Clean up test users
    await User.collection.deleteMany({ email: { $in: ['remed_a@example.com', 'remed_b@example.com'] } });
    testUserA = await User.create({
      username: `remed_a_${Date.now()}`,
      email: 'remed_a@example.com',
      password: 'password123',
      coins: 500,
    });
    testUserB = await User.create({
      username: `remed_b_${Date.now()}`,
      email: 'remed_b@example.com',
      password: 'password123',
      coins: 200,
    });
  });

  after(async () => {
    stopScheduledRecovery();
    if (testUserA?._id) {
      await Wallet.collection.deleteMany({ userId: { $in: [testUserA._id, testUserB._id] } });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [testUserA._id, testUserB._id] } });
      await User.collection.deleteMany({ _id: { $in: [testUserA._id, testUserB._id] } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // =========================================================================
  // SUB-SUITE 1: Recovery Scheduler Lifecycle Integration
  // =========================================================================
  describe('1. Recovery Scheduler Lifecycle Integration', () => {
    beforeEach(() => {
      stopScheduledRecovery();
    });

    it('1.1 Scheduler starts cleanly with configurable interval and batch size', () => {
      assert.strictEqual(isSchedulerActive(), false);

      const res = startScheduledRecovery({ intervalMs: 30000, batchSize: 25 });
      assert.strictEqual(res.started, true);
      assert.strictEqual(res.intervalMs, 30000);
      assert.strictEqual(res.batchSize, 25);
      assert.strictEqual(isSchedulerActive(), true);

      stopScheduledRecovery();
      assert.strictEqual(isSchedulerActive(), false);
    });

    it('1.2 Duplicate scheduler start is prevented (ALREADY_SCHEDULED)', () => {
      const first = startScheduledRecovery({ intervalMs: 20000 });
      assert.strictEqual(first.started, true);

      const second = startScheduledRecovery({ intervalMs: 20000 });
      assert.strictEqual(second.started, false);
      assert.strictEqual(second.reason, 'ALREADY_SCHEDULED');

      stopScheduledRecovery();
    });

    it('1.3 Stopping an unstarted scheduler returns clean NOT_SCHEDULED status', () => {
      assert.strictEqual(isSchedulerActive(), false);
      const res = stopScheduledRecovery();
      assert.strictEqual(res.stopped, false);
      assert.strictEqual(res.reason, 'NOT_SCHEDULED');
    });

    it('1.4 Multiple consecutive stop calls are safe and idempotent', () => {
      startScheduledRecovery();
      assert.strictEqual(isSchedulerActive(), true);

      const stop1 = stopScheduledRecovery();
      assert.strictEqual(stop1.stopped, true);
      assert.strictEqual(isSchedulerActive(), false);

      const stop2 = stopScheduledRecovery();
      assert.strictEqual(stop2.stopped, false);
      assert.strictEqual(stop2.reason, 'NOT_SCHEDULED');
    });

    it('1.5 gracefulShutdown stops the recovery scheduler and reports clean shutdown', async () => {
      startScheduledRecovery({ intervalMs: 15000 });
      assert.strictEqual(isSchedulerActive(), true);

      const shutdownRes = await gracefulShutdown('SIGTERM');
      assert.strictEqual(shutdownRes.stopped, true);
      assert.strictEqual(shutdownRes.schedulerStopped, true);
      assert.strictEqual(isSchedulerActive(), false);

      // Re-connect mongoose if disconnected for subsequent tests
      if (mongoose.connection.readyState === 0) {
        const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
        await mongoose.connect(mongoUri);
      }
    });

    it('1.6 getServerState correctly reflects scheduler and lifecycle status', () => {
      stopScheduledRecovery();
      const stateBefore = getServerState();
      assert.strictEqual(typeof stateBefore.isStarted, 'boolean');
      assert.strictEqual(typeof stateBefore.isSchedulerActive, 'boolean');
      assert.strictEqual(stateBefore.isSchedulerActive, false);

      startScheduledRecovery();
      const stateAfter = getServerState();
      assert.strictEqual(stateAfter.isSchedulerActive, true);
      stopScheduledRecovery();
    });
  });

  // =========================================================================
  // SUB-SUITE 2: Stale User.coins Cache Discovery & Reconciliation
  // =========================================================================
  describe('2. Stale User.coins Cache Discovery & Reconciliation', () => {
    let walletA;

    beforeEach(async () => {
      await Wallet.collection.deleteMany({ userId: { $in: [testUserA._id, testUserB._id] } });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [testUserA._id, testUserB._id] } });
      await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 500, coinsWalletSequence: 0 } }
      );
      walletA = await walletService.getOrCreateWallet(testUserA._id);
    });

    it('2.1 Discovers and heals a settled wallet whose User.coins sync dropped', async () => {
      // Simulate: Wallet is at sequence 4 with balance 650, unsettledOperations is EMPTY
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        {
          $set: {
            balance: 650,
            sequence: 4,
            unsettledOperations: [],
          },
        }
      );

      // But User.coins is stale: 500 at sequence 1
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 500, coinsWalletSequence: 1 } }
      );

      const txCountBefore = await WalletTransaction.countDocuments({ userId: testUserA._id });

      // Run secondary bounded discovery
      const result = await reconcileStaleUserCaches({ limit: 10 });
      assert.ok(result.scanned >= 1);
      assert.strictEqual(result.healedCount, 1);

      // Verify User document is healed to authoritative wallet state
      const healedUser = await User.findById(testUserA._id).lean();
      assert.strictEqual(healedUser.coins, 650);
      assert.strictEqual(healedUser.coinsWalletSequence, 4);

      // Invariant: wallet balance was NOT mutated
      const freshWallet = await Wallet.findById(walletA._id);
      assert.strictEqual(freshWallet.balance, 650);
      assert.strictEqual(freshWallet.sequence, 4);

      // Invariant: no new ledger records were created
      const txCountAfter = await WalletTransaction.countDocuments({ userId: testUserA._id });
      assert.strictEqual(txCountAfter, txCountBefore, 'Cache healing must never create extra ledger records');
    });

    it('2.2 Cache reconciliation is idempotent: repeated runs find 0 drift', async () => {
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        { $set: { balance: 700, sequence: 5, unsettledOperations: [] } }
      );
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 500, coinsWalletSequence: 2 } }
      );

      // Run 1: Heals
      const run1 = await reconcileStaleUserCaches({ limit: 10 });
      assert.strictEqual(run1.healedCount, 1);

      // Run 2: Already healed -> 0 drift
      const run2 = await reconcileStaleUserCaches({ limit: 10 });
      assert.strictEqual(run2.healedCount, 0);

      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 700);
      assert.strictEqual(user.coinsWalletSequence, 5);
    });

    it('2.3 runRecoveryBatch executes secondary cache discovery and reports cacheHealedCount', async () => {
      // Simulate: Wallet has 0 unsettled operations, but stale cache
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        { $set: { balance: 800, sequence: 6, unsettledOperations: [] } }
      );
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 500, coinsWalletSequence: 3 } }
      );

      const batchResult = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(batchResult.skipped, false);
      assert.strictEqual(batchResult.processedWallets, 0, 'No unsettled wallets to process in Phase 1');
      assert.strictEqual(batchResult.cacheHealedCount, 1, 'Phase 2 discovered and healed stale cache');

      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 800);
      assert.strictEqual(user.coinsWalletSequence, 6);
    });

    it('2.4 Active read-time healing: getWalletSummary heals stale cache immediately on read', async () => {
      // Wallet is at sequence 7 with balance 950
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        { $set: { balance: 950, sequence: 7, unsettledOperations: [] } }
      );
      // User is stale: 300 at sequence 2
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 300, coinsWalletSequence: 2 } }
      );

      // Client performs read (GET /api/wallet -> getWalletSummary)
      const summary = await walletService.getWalletSummary(testUserA._id);
      assert.strictEqual(summary.balance, 950);
      assert.strictEqual(summary.sequence, 7);

      // Verify User.coins was atomically healed on read
      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 950);
      assert.strictEqual(user.coinsWalletSequence, 7);
    });

    it('2.5 Monotonic guard prevents stale sequence from overwriting newer User.coins cache', async () => {
      // User is at newer sequence 10 with 1000 coins
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 1000, coinsWalletSequence: 10 } }
      );

      // Attempting to sync from older sequence 6 with 600 coins
      const syncRes = await walletService._syncUserCoins(testUserA._id, 600, 6);
      assert.strictEqual(syncRes.synced, false);

      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 1000);
      assert.strictEqual(user.coinsWalletSequence, 10);
    });

    it('2.6 Handles legacy user with missing/null coinsWalletSequence safely', async () => {
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        { $set: { balance: 400, sequence: 2, unsettledOperations: [] } }
      );
      // Legacy document without coinsWalletSequence
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 150 }, $unset: { coinsWalletSequence: '' } }
      );

      const result = await reconcileStaleUserCaches({ limit: 10 });
      assert.strictEqual(result.healedCount, 1);

      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 400);
      assert.strictEqual(user.coinsWalletSequence, 2);
    });

    it('2.7 Combined recovery: runRecoveryBatch recovers unsettled operation AND heals stale cache together', async () => {
      // Wallet A has an unsettled operation
      const snap = {
        opId: `op_comb_${Date.now()}`,
        sequence: 2,
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: `idem_comb_${Date.now()}`,
        balanceBefore: 500,
        balanceAfter: 550,
        fingerprint: '',
        fingerprintVersion: FINGERPRINT_VERSION,
        createdAt: new Date(),
      };
      snap.fingerprint = generateFingerprint({
        version: FINGERPRINT_VERSION,
        userId: testUserA._id,
        walletId: walletA._id,
        ...snap,
      });

      await Wallet.collection.updateOne(
        { _id: walletA._id },
        {
          $set: { balance: 550, sequence: 2 },
          $push: { unsettledOperations: snap },
        }
      );

      // Wallet B has 0 unsettled operations, but stale cache
      await Wallet.collection.deleteMany({ userId: testUserB._id });
      const walletB = await walletService.getOrCreateWallet(testUserB._id);
      await Wallet.collection.updateOne(
        { _id: walletB._id },
        { $set: { balance: 350, sequence: 3, unsettledOperations: [] } }
      );
      await User.collection.updateOne(
        { _id: testUserB._id },
        { $set: { coins: 100, coinsWalletSequence: 1 } }
      );

      // Single run of runRecoveryBatch handles BOTH!
      const batchResult = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(batchResult.skipped, false);
      assert.strictEqual(batchResult.processedWallets, 1, 'Phase 1 recovered Wallet A');
      assert.strictEqual(batchResult.recoveredCount, 1);
      assert.strictEqual(batchResult.settledCount, 1);
      assert.strictEqual(batchResult.cacheHealedCount, 1, 'Phase 2 healed Wallet B cache');

      // Verify Wallet A settled
      const freshWalletA = await Wallet.findById(walletA._id);
      assert.strictEqual(freshWalletA.unsettledOperations.length, 0);

      // Verify Wallet B cache healed
      const freshUserB = await User.findById(testUserB._id).lean();
      assert.strictEqual(freshUserB.coins, 350);
      assert.strictEqual(freshUserB.coinsWalletSequence, 3);
    });

    it('2.8 Dry-run mode for cache reconciliation reports drift without writing to database', async () => {
      await Wallet.collection.updateOne(
        { _id: walletA._id },
        { $set: { balance: 888, sequence: 8, unsettledOperations: [] } }
      );
      await User.collection.updateOne(
        { _id: testUserA._id },
        { $set: { coins: 100, coinsWalletSequence: 1 } }
      );

      const dryRes = await reconcileStaleUserCaches({ limit: 10, dryRun: true });
      assert.strictEqual(dryRes.healedCount, 1);

      // Database was NOT modified
      const user = await User.findById(testUserA._id).lean();
      assert.strictEqual(user.coins, 100);
      assert.strictEqual(user.coinsWalletSequence, 1);
    });
  });
});
