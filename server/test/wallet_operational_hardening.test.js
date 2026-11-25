/**
 * server/test/wallet_operational_hardening.test.js
 * 
 * Phase 8 Step 4B — Wallet Operational Hardening Test Suite
 * 
 * Verifies the three critical operational hardenings:
 *   Part 1: Recovery Queue Starvation Prevention & Exponential Backoff
 *   Part 2: Equal-Sequence & Monotonic User Cache Reconciliation
 *   Part 3: Synchronized Graceful Shutdown & Recovery Lifecycle
 *   Part 4: Safe CLI Migration Wrappers (Non-destructive imports & safety gates)
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
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
  drainAndStopRecovery,
  resetRecoveryState,
  isSchedulerActive,
  isRecoveryRunning,
  calculateRecoveryBackoffMs,
  BASE_RECOVERY_BACKOFF_MS,
  MAX_RECOVERY_BACKOFF_MS,
  recordRecoveryFailure,
} from '../src/services/walletRecoveryService.js';
import {
  gracefulShutdown,
  getServerState,
  resetServerState,
} from '../src/server.js';
import {
  generateFingerprint,
  FINGERPRINT_VERSION,
} from '../src/utils/walletIntegrity.js';
import { runOpIdIndexMigrationRunner } from '../scripts/migrate-wallet-opid-index.js';
import { runWalletBaselineMigrationRunner } from '../scripts/initialize-wallet-baseline.js';

describe('Phase 8 Step 4B — Operational Hardening Suite', () => {
  let userStarveA;
  let userStarveB;
  let userSyncA;
  let userSyncB;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean up lingering unsettled operations from prior test suites
    await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });

    // Clean up test users
    await User.collection.deleteMany({
      email: {
        $in: [
          'hard_starve_a@example.com',
          'hard_starve_b@example.com',
          'hard_sync_a@example.com',
          'hard_sync_b@example.com',
        ],
      },
    });

    userStarveA = await User.create({
      username: `hard_starve_a_${Date.now()}`,
      email: 'hard_starve_a@example.com',
      password: 'password123',
      coins: 100,
      coinsWalletSequence: 0,
    });

    userStarveB = await User.create({
      username: `hard_starve_b_${Date.now()}`,
      email: 'hard_starve_b@example.com',
      password: 'password123',
      coins: 200,
      coinsWalletSequence: 0,
    });

    userSyncA = await User.create({
      username: `hard_sync_a_${Date.now()}`,
      email: 'hard_sync_a@example.com',
      password: 'password123',
      coins: 50,
      coinsWalletSequence: 5,
    });

    userSyncB = await User.create({
      username: `hard_sync_b_${Date.now()}`,
      email: 'hard_sync_b@example.com',
      password: 'password123',
      coins: 100,
      coinsWalletSequence: 10,
    });
  });

  after(async () => {
    resetRecoveryState();
    resetServerState();
    if (mongoose.connection.readyState !== 0) {
      await Wallet.collection.deleteMany({
        userId: {
          $in: [userStarveA?._id, userStarveB?._id, userSyncA?._id, userSyncB?._id].filter(Boolean),
        },
      });
      await WalletTransaction.collection.deleteMany({
        userId: {
          $in: [userStarveA?._id, userStarveB?._id, userSyncA?._id, userSyncB?._id].filter(Boolean),
        },
      });
      await User.collection.deleteMany({
        _id: {
          $in: [userStarveA?._id, userStarveB?._id, userSyncA?._id, userSyncB?._id].filter(Boolean),
        },
      });
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    resetRecoveryState();
    resetServerState();
  });

  // =========================================================================
  // Part 1: Recovery Queue Starvation & Backoff
  // =========================================================================
  describe('Part 1: Recovery Queue Starvation & Backoff', () => {
    it('1.1 calculateRecoveryBackoffMs calculates correct exponential delays', () => {
      // Production defaults (15s base, 15m cap)
      assert.strictEqual(calculateRecoveryBackoffMs(1), 15000);   // 15 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(2), 30000);   // 30 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(3), 60000);   // 60 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(4), 120000);  // 120 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(5), 240000);  // 240 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(6), 480000);  // 480 seconds
      assert.strictEqual(calculateRecoveryBackoffMs(7), 900000);  // 15-minute cap (900000ms)
      assert.strictEqual(calculateRecoveryBackoffMs(10), 900000); // 15-minute cap (900000ms)

      // Invalid, missing, or negative attempt inputs default safely to attempt 1 (15000ms)
      assert.strictEqual(calculateRecoveryBackoffMs(), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(0), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(-1), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(-10), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(null), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(undefined), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs('bad'), 15000);
      assert.strictEqual(calculateRecoveryBackoffMs(NaN), 15000);

      // Custom parameters behavior (preserved from original tests)
      assert.strictEqual(calculateRecoveryBackoffMs(1, 1000, 10000), 1000);
      assert.strictEqual(calculateRecoveryBackoffMs(2, 1000, 10000), 2000);
      assert.strictEqual(calculateRecoveryBackoffMs(3, 1000, 10000), 4000);
      assert.strictEqual(calculateRecoveryBackoffMs(4, 1000, 10000), 8000);
      assert.strictEqual(calculateRecoveryBackoffMs(5, 1000, 10000), 10000); // capped at max
      assert.strictEqual(calculateRecoveryBackoffMs(10, 1000, 10000), 10000);
    });

    it('1.2 A recoverable wallet behind a failing wallet is not starved', async () => {
      // Wallet A: Corrupted snapshot (invalid HMAC) that will consistently fail recovery
      const walletA = await Wallet.create({
        userId: userStarveA._id,
        balance: 100,
        sequence: 1,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_poison_01',
            sequence: 1,
            amount: 50,
            direction: 'CREDIT',
            type: 'BONUS',
            balanceBefore: 50,
            balanceAfter: 100,
            fingerprint: 'v1:invalid_fake_hmac_signature_0000000000000000000000000000000000000000',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      // Wallet B: Valid recoverable snapshot
      const validSeq = 1;
      const validAmount = 50;
      const walletB = await Wallet.create({
        userId: userStarveB._id,
        balance: 250,
        sequence: validSeq,
        baselineBalance: 200,
        baselineSequence: 0,
        unsettledOperations: [],
      });

      const validFingerprint = generateFingerprint({
        version: FINGERPRINT_VERSION,
        userId: userStarveB._id,
        walletId: walletB._id,
        opId: 'op_valid_recoverable_01',
        amount: validAmount,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: null,
        sequence: validSeq,
        balanceBefore: 200,
        balanceAfter: 250,
      });

      await Wallet.collection.updateOne(
        { _id: walletB._id },
        {
          $set: {
            unsettledOperations: [
              {
                opId: 'op_valid_recoverable_01',
                sequence: validSeq,
                amount: validAmount,
                direction: 'CREDIT',
                type: 'BONUS',
                referenceId: null,
                idempotencyKey: null,
                balanceBefore: 200,
                balanceAfter: 250,
                fingerprint: validFingerprint,
                fingerprintVersion: FINGERPRINT_VERSION,
                createdAt: new Date(),
              },
            ],
          },
        }
      );

      // Run Batch 1: Wallet A will fail and receive backoff; Wallet B will be recovered!
      const batchResult1 = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(batchResult1.skipped, false);
      assert.strictEqual(batchResult1.failedCount >= 1, true);

      // Verify Wallet A was NOT settled and has backoff metadata set
      const freshWalletA = await Wallet.findById(walletA._id);
      assert.strictEqual(freshWalletA.unsettledOperations.length, 1);
      assert.strictEqual(freshWalletA.recoveryAttempts >= 1, true);
      assert.ok(freshWalletA.nextRecoveryAttemptAt instanceof Date);
      assert.ok(freshWalletA.nextRecoveryAttemptAt.getTime() > Date.now());
      assert.ok(freshWalletA.lastRecoveryError.includes('HMAC_VERIFICATION_FAILED'));

      // Verify Wallet B was cleanly recovered despite being behind Wallet A
      const freshWalletB = await Wallet.findById(walletB._id);
      assert.strictEqual(freshWalletB.unsettledOperations.length, 0);

      // Run Batch 2: Wallet A is now in backoff window and must be skipped completely
      const batchResult2 = await runRecoveryBatch({ batchSize: 10 });
      // Zero wallets processed because Wallet A is currently in backoff!
      assert.strictEqual(batchResult2.processedWallets, 0);

      // Clean up test wallets
      await Wallet.collection.deleteOne({ _id: walletA._id });
      await Wallet.collection.deleteOne({ _id: walletB._id });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [userStarveA._id, userStarveB._id] } });
    });

    it('1.3 Recovery succeeds when a previously failed wallet becomes recoverable', async () => {
      // Create wallet with invalid snapshot
      const wallet = await Wallet.create({
        userId: userStarveA._id,
        balance: 150,
        sequence: 1,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_fixable_01',
            sequence: 1,
            amount: 50,
            direction: 'CREDIT',
            type: 'BONUS',
            balanceBefore: 100,
            balanceAfter: 150,
            fingerprint: 'v1:corrupted_hash_before_fix_0000000000000000000000000000000000000000',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      // Attempt recovery: fails and enters backoff
      await runRecoveryBatch({ batchSize: 10 });
      let fresh = await Wallet.findById(wallet._id);
      assert.strictEqual(fresh.recoveryAttempts, 1);
      assert.ok(fresh.nextRecoveryAttemptAt > new Date());

      // Operator or system fixes snapshot fingerprint
      const validHmac = generateFingerprint({
        version: FINGERPRINT_VERSION,
        userId: userStarveA._id,
        walletId: wallet._id,
        opId: 'op_fixable_01',
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: null,
        sequence: 1,
        balanceBefore: 100,
        balanceAfter: 150,
      });

      // Update to valid snapshot and set nextRecoveryAttemptAt to past
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $set: {
            'unsettledOperations.0.fingerprint': validHmac,
            nextRecoveryAttemptAt: new Date(Date.now() - 1000), // backoff expired
          },
        }
      );

      // Re-run recovery: now succeeds!
      const secondBatch = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(secondBatch.recoveredCount >= 1, true);

      fresh = await Wallet.findById(wallet._id);
      assert.strictEqual(fresh.unsettledOperations.length, 0);
      assert.strictEqual(fresh.nextRecoveryAttemptAt, null);
      assert.strictEqual(fresh.recoveryAttempts, 0);

      await Wallet.collection.deleteOne({ _id: wallet._id });
      await WalletTransaction.collection.deleteMany({ userId: userStarveA._id });
    });

    it('1.4 Concurrent failure-recording operations update attempts and backoff without losing increments or shortening window', async () => {
      // 1. Create a wallet with an unsettled snapshot
      const wallet = await Wallet.create({
        userId: userStarveA._id,
        balance: 100,
        sequence: 1,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_concurrent_fail_01',
            sequence: 1,
            amount: 50,
            direction: 'CREDIT',
            type: 'BONUS',
            balanceBefore: 50,
            balanceAfter: 100,
            fingerprint: 'v1:poisoned_fingerprint_for_concurrent_test',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      const initialTxCount = await WalletTransaction.countDocuments({ walletId: wallet._id });

      // 2. Simulate competing concurrent recovery failures on the same wallet
      const startTime = Date.now();
      const err1 = [{ opId: 'op_concurrent_fail_01', reason: 'HMAC_VERIFICATION_FAILED_WORKER_1' }];
      const err2 = [{ opId: 'op_concurrent_fail_01', reason: 'HMAC_VERIFICATION_FAILED_WORKER_2' }];

      const [res1, res2] = await Promise.all([
        recordRecoveryFailure(wallet._id, err1),
        recordRecoveryFailure(wallet._id, err2),
      ]);

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.success, true);

      // Verify wallet state after concurrent failure recording:
      const walletAfter = await Wallet.findById(wallet._id);

      // (a) Counter increments must not be lost: 2 attempts recorded
      assert.strictEqual(walletAfter.recoveryAttempts, 2);

      // (b) Retried timestamp must reflect the final retry count (attempt 2 = 30s backoff)
      assert.ok(walletAfter.nextRecoveryAttemptAt instanceof Date);
      const nextAttemptTime = walletAfter.nextRecoveryAttemptAt.getTime();
      // Attempt 2 backoff is 30,000ms. Check that scheduled time is >= startTime + 28,000ms (accounting for clock jitter)
      assert.ok(
        nextAttemptTime >= startTime + 28000,
        `Expected nextRecoveryAttemptAt (${nextAttemptTime}) to reflect attempt 2 backoff >= ${startTime + 28000}`
      );
      assert.ok(
        nextAttemptTime <= Date.now() + 32000,
        `Expected nextRecoveryAttemptAt (${nextAttemptTime}) to be within reasonable upper bound`
      );

      // (c) Monotonic guard: verify that a subsequent lower backoff or out-of-order write
      // cannot shorten an already established retry window
      const farFutureWindow = new Date(Date.now() + 7200000); // 2 hours in future
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { nextRecoveryAttemptAt: farFutureWindow } }
      );

      // Record a 3rd failure (which would normally calculate 60s backoff)
      const res3 = await recordRecoveryFailure(wallet._id, [{ opId: 'op_concurrent_fail_01', reason: 'FAIL_3' }]);
      assert.strictEqual(res3.success, true);

      const walletAfter3 = await Wallet.findById(wallet._id);
      assert.strictEqual(walletAfter3.recoveryAttempts, 3);
      // Window was NOT shortened to 60s; the 2-hour window was preserved!
      assert.strictEqual(walletAfter3.nextRecoveryAttemptAt.getTime(), farFutureWindow.getTime());

      // (d) Safety invariants: financial integrity preserved
      assert.strictEqual(walletAfter3.balance, 100); // Balance untouched
      assert.strictEqual(walletAfter3.sequence, 1);  // Sequence untouched
      assert.strictEqual(walletAfter3.unsettledOperations.length, 1); // Snapshot preserved without mutation

      // (e) Ledger integrity: no transactions created or altered
      const finalTxCount = await WalletTransaction.countDocuments({ walletId: wallet._id });
      assert.strictEqual(finalTxCount, initialTxCount);

      // Cleanup
      await Wallet.collection.deleteOne({ _id: wallet._id });
    });

    it('1.5 CAS exhaustion triggers atomic fallback branch and initializes recovery metadata', async () => {
      // Create wallet with missing/legacy recoveryAttempts field
      const wallet = await Wallet.create({
        userId: userStarveA._id,
        balance: 100,
        sequence: 1,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_fallback_01',
            sequence: 1,
            amount: 50,
            direction: 'CREDIT',
            type: 'BONUS',
            balanceBefore: 50,
            balanceAfter: 100,
            fingerprint: 'v1:fake_fingerprint_fallback_test_01',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      const startTime = Date.now();
      // Force fallback path directly by specifying forceFallback: true
      const res = await recordRecoveryFailure(
        wallet._id,
        [{ opId: 'op_fallback_01', reason: 'CAS_EXHAUSTION_FORCED' }],
        { forceFallback: true }
      );

      // Verify return payload confirms fallback execution
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.fallback, true);
      assert.strictEqual(res.recoveryAttempts, 1);
      assert.ok(res.nextRecoveryAttemptAt instanceof Date);

      // Verify persisted wallet document
      const walletAfter = await Wallet.findById(wallet._id);
      assert.strictEqual(walletAfter.recoveryAttempts, 1);
      assert.ok(walletAfter.nextRecoveryAttemptAt instanceof Date);
      // Attempt 1 backoff = 15,000ms
      assert.ok(walletAfter.nextRecoveryAttemptAt.getTime() >= startTime + 13000);
      assert.ok(walletAfter.nextRecoveryAttemptAt.getTime() <= Date.now() + 17000);
      assert.ok(walletAfter.lastRecoveryError.includes('CAS_EXHAUSTION_FORCED'));

      await Wallet.collection.deleteOne({ _id: wallet._id });
    });

    it('1.6 Concurrent fallback operations increment attempts atomically and enforce monotonic backoff', async () => {
      const wallet = await Wallet.create({
        userId: userStarveA._id,
        balance: 200,
        sequence: 2,
        baselineBalance: 200,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_fallback_concurrent_01',
            sequence: 2,
            amount: 50,
            direction: 'CREDIT',
            type: 'BONUS',
            balanceBefore: 150,
            balanceAfter: 200,
            fingerprint: 'v1:fake_fingerprint_fallback_concurrent',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      const startTime = Date.now();
      const err1 = [{ opId: 'op_fallback_concurrent_01', reason: 'CONCURRENT_FALLBACK_1' }];
      const err2 = [{ opId: 'op_fallback_concurrent_01', reason: 'CONCURRENT_FALLBACK_2' }];
      const err3 = [{ opId: 'op_fallback_concurrent_01', reason: 'CONCURRENT_FALLBACK_3' }];

      // Trigger 3 concurrent fallback operations
      const [res1, res2, res3] = await Promise.all([
        recordRecoveryFailure(wallet._id, err1, { forceFallback: true }),
        recordRecoveryFailure(wallet._id, err2, { forceFallback: true }),
        recordRecoveryFailure(wallet._id, err3, { forceFallback: true }),
      ]);

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res3.success, true);
      assert.strictEqual(res1.fallback, true);
      assert.strictEqual(res2.fallback, true);
      assert.strictEqual(res3.fallback, true);

      // Verify database state: exactly 3 increments recorded (no lost increments)
      const walletAfter = await Wallet.findById(wallet._id);
      assert.strictEqual(walletAfter.recoveryAttempts, 3);

      // Verify that nextRecoveryAttemptAt reflects attempt 3 backoff (60s)
      assert.ok(walletAfter.nextRecoveryAttemptAt instanceof Date);
      const nextTime = walletAfter.nextRecoveryAttemptAt.getTime();
      // Attempt 3 = 60,000ms delay. Must be >= startTime + 58,000ms
      assert.ok(
        nextTime >= startTime + 58000,
        `Expected nextRecoveryAttemptAt (${nextTime}) to reflect attempt 3 backoff >= ${startTime + 58000}`
      );

      // Monotonic guard verification under fallback:
      // Set an existing far-future retry window (2 hours)
      const farFutureWindow = new Date(Date.now() + 7200000);
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { nextRecoveryAttemptAt: farFutureWindow } }
      );

      // Run another fallback failure (attempt 4, which would compute 120s)
      const res4 = await recordRecoveryFailure(
        wallet._id,
        [{ opId: 'op_fallback_concurrent_01', reason: 'CONCURRENT_FALLBACK_4' }],
        { forceFallback: true }
      );
      assert.strictEqual(res4.success, true);
      assert.strictEqual(res4.fallback, true);

      const walletAfter4 = await Wallet.findById(wallet._id);
      assert.strictEqual(walletAfter4.recoveryAttempts, 4);
      // Window was NOT shortened to 120s; the 2-hour window was preserved by $max!
      assert.strictEqual(walletAfter4.nextRecoveryAttemptAt.getTime(), farFutureWindow.getTime());

      await Wallet.collection.deleteOne({ _id: wallet._id });
    });

    it('1.7 Fallback failure updates preserve wallet financial state, snapshots and ledger integrity', async () => {
      const initialBalance = 500;
      const initialSeq = 7;
      const wallet = await Wallet.create({
        userId: userStarveA._id,
        balance: initialBalance,
        sequence: initialSeq,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [
          {
            opId: 'op_invariants_01',
            sequence: initialSeq,
            amount: 50,
            direction: 'DEBIT',
            type: 'PURCHASE',
            balanceBefore: 550,
            balanceAfter: 500,
            fingerprint: 'v1:fake_fingerprint_invariants_test',
            fingerprintVersion: 1,
            createdAt: new Date(),
          },
        ],
      });

      const txCountBefore = await WalletTransaction.countDocuments({ walletId: wallet._id });

      // Run repeated fallback failures
      await recordRecoveryFailure(
        wallet._id,
        [{ opId: 'op_invariants_01', reason: 'INVARIANTS_TEST_1' }],
        { forceFallback: true }
      );
      await recordRecoveryFailure(
        wallet._id,
        [{ opId: 'op_invariants_01', reason: 'INVARIANTS_TEST_2' }],
        { forceFallback: true }
      );

      const freshWallet = await Wallet.findById(wallet._id);

      // Invariant 1: Wallet balance is completely unchanged
      assert.strictEqual(freshWallet.balance, initialBalance);

      // Invariant 2: Wallet sequence is completely unchanged
      assert.strictEqual(freshWallet.sequence, initialSeq);

      // Invariant 3: Unsettled snapshot is preserved exactly
      assert.strictEqual(freshWallet.unsettledOperations.length, 1);
      assert.strictEqual(freshWallet.unsettledOperations[0].opId, 'op_invariants_01');
      assert.strictEqual(freshWallet.unsettledOperations[0].amount, 50);

      // Invariant 4: No unexpected ledger transactions created
      const txCountAfter = await WalletTransaction.countDocuments({ walletId: wallet._id });
      assert.strictEqual(txCountAfter, txCountBefore);

      // Invariant 5: Recovery metadata is valid and bounded
      assert.strictEqual(freshWallet.recoveryAttempts, 2);
      assert.ok(freshWallet.nextRecoveryAttemptAt instanceof Date);
      assert.ok(freshWallet.lastRecoveryError.length <= 500);

      await Wallet.collection.deleteOne({ _id: wallet._id });
    });
  });

  // =========================================================================
  // Part 2: Equal-Sequence & Monotonic User Cache Reconciliation
  // =========================================================================
  describe('Part 2: Equal-Sequence & Monotonic User Cache Reconciliation', () => {
    it('2.1 Lower sequence does not overwrite newer User cache', async () => {
      // User has coins: 100, coinsWalletSequence: 10
      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $set: { coins: 100, coinsWalletSequence: 10 } }
      );

      // Wallet attempt to sync with older sequence 5 and balance 50
      const res = await walletService._syncUserCoins(userSyncA._id, 50, 5);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.matched, false);

      const freshUser = await User.findById(userSyncA._id);
      assert.strictEqual(freshUser.coins, 100);
      assert.strictEqual(freshUser.coinsWalletSequence, 10);
    });

    it('2.2 Higher sequence updates User cache', async () => {
      // User has sequence 10
      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $set: { coins: 100, coinsWalletSequence: 10 } }
      );

      // Wallet advances to sequence 11 with balance 150
      const res = await walletService._syncUserCoins(userSyncA._id, 150, 11);
      assert.strictEqual(res.synced, true);

      const freshUser = await User.findById(userSyncA._id);
      assert.strictEqual(freshUser.coins, 150);
      assert.strictEqual(freshUser.coinsWalletSequence, 11);
    });

    it('2.3 Missing or null sequence updates User cache', async () => {
      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $unset: { coinsWalletSequence: '' } }
      );

      const res = await walletService._syncUserCoins(userSyncA._id, 75, 1);
      assert.strictEqual(res.synced, true);

      let freshUser = await User.findById(userSyncA._id);
      assert.strictEqual(freshUser.coins, 75);
      assert.strictEqual(freshUser.coinsWalletSequence, 1);

      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $set: { coinsWalletSequence: null } }
      );

      const res2 = await walletService._syncUserCoins(userSyncA._id, 85, 2);
      assert.strictEqual(res2.synced, true);

      freshUser = await User.findById(userSyncA._id);
      assert.strictEqual(freshUser.coins, 85);
      assert.strictEqual(freshUser.coinsWalletSequence, 2);
    });

    it('2.4 Equal sequence with differing coins is healed', async () => {
      // User has sequence 5 and stale coins 30
      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $set: { coins: 30, coinsWalletSequence: 5 } }
      );

      // Authoritative wallet is sequence 5 with balance 50
      const res = await walletService._syncUserCoins(userSyncA._id, 50, 5);
      assert.strictEqual(res.synced, true);

      const freshUser = await User.findById(userSyncA._id);
      assert.strictEqual(freshUser.coins, 50);
      assert.strictEqual(freshUser.coinsWalletSequence, 5);
    });

    it('2.5 Equal sequence with matching coins is a no-op (never overwrites unnecessarily)', async () => {
      // User already has sequence 5 and coins 50
      await User.collection.updateOne(
        { _id: userSyncA._id },
        { $set: { coins: 50, coinsWalletSequence: 5 } }
      );

      const res = await walletService._syncUserCoins(userSyncA._id, 50, 5);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.matched, false);
    });

    it('2.6 reconcileStaleUserCaches discovers and heals equal-sequence desync', async () => {
      // Create wallet with sequence 8, balance 80, empty unsettledOperations
      const wallet = await Wallet.create({
        userId: userSyncB._id,
        balance: 80,
        sequence: 8,
        baselineBalance: 0,
        baselineSequence: 0,
        unsettledOperations: [],
      });

      // Set user to sequence 8 but stale coins 20
      await User.collection.updateOne(
        { _id: userSyncB._id },
        { $set: { coins: 20, coinsWalletSequence: 8 } }
      );

      const healResult = await reconcileStaleUserCaches({ limit: 10 });
      assert.strictEqual(healResult.healedCount >= 1, true);

      const freshUser = await User.findById(userSyncB._id);
      assert.strictEqual(freshUser.coins, 80);
      assert.strictEqual(freshUser.coinsWalletSequence, 8);

      await Wallet.collection.deleteOne({ _id: wallet._id });
    });
  });

  // =========================================================================
  // Part 3: Synchronized Graceful Shutdown & Recovery Lifecycle
  // =========================================================================
  describe('Part 3: Synchronized Graceful Shutdown & Recovery Lifecycle', () => {
    it('3.1 Shutdown with no active recovery stops scheduler and disconnects cleanly', async () => {
      startScheduledRecovery({ intervalMs: 60000 });
      assert.strictEqual(isSchedulerActive(), true);

      const shutdownRes = await gracefulShutdown('SIGTERM', { recoveryTimeoutMs: 1000 });
      assert.strictEqual(shutdownRes.stopped, true);
      assert.strictEqual(shutdownRes.schedulerStopped, true);
      assert.strictEqual(shutdownRes.recoveryDrained, true);
      assert.strictEqual(shutdownRes.recoveryTimedOut, false);
      assert.strictEqual(isSchedulerActive(), false);

      // Reconnect mongoose for remaining tests
      const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
      await mongoose.connect(mongoUri);
    });

    it('3.2 Repeated shutdown calls return alreadyShuttingDown', async () => {
      const p1 = gracefulShutdown('SIGTERM', { recoveryTimeoutMs: 1000 });
      const p2 = gracefulShutdown('SIGINT', { recoveryTimeoutMs: 1000 });

      const [res1, res2] = await Promise.all([p1, p2]);
      assert.ok(res1.stopped || res1.alreadyShuttingDown);
      assert.ok(res2.stopped || res2.alreadyShuttingDown);
      assert.strictEqual(res1.alreadyShuttingDown || res2.alreadyShuttingDown, true);

      const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
      await mongoose.connect(mongoUri);
    });

    it('3.3 drainAndStopRecovery prevents new batches from starting', async () => {
      const drainRes = await drainAndStopRecovery(500);
      assert.strictEqual(drainRes.stopped, true);
      assert.strictEqual(drainRes.drained, true);

      // Attempting to run batch while shutting down must be skipped
      const batchRes = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(batchRes.skipped, true);
      assert.strictEqual(batchRes.reason, 'SHUTTING_DOWN');

      resetRecoveryState();
    });
  });

  // =========================================================================
  // Part 4: Safe CLI Wrappers (Import & Gate Verification)
  // =========================================================================
  describe('Part 4: Safe CLI Wrappers', () => {
    let savedEnv;

    beforeEach(() => {
      savedEnv = {
        MONGODB_URI: process.env.MONGODB_URI,
        NODE_ENV: process.env.NODE_ENV,
        MIGRATION_EXPECTED_DB_NAME: process.env.MIGRATION_EXPECTED_DB_NAME,
        MIGRATION_ALLOWED_HOSTS: process.env.MIGRATION_ALLOWED_HOSTS,
      };
      process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
      process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_adventure_test';
      process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1,localhost';
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    });

    it('4.1 OpId runner refuses execution if MONGODB_URI is missing', async () => {
      const origUri = process.env.MONGODB_URI;
      delete process.env.MONGODB_URI;

      const res = await runOpIdIndexMigrationRunner([]);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'MISSING_MONGODB_URI');

      process.env.MONGODB_URI = origUri;
    });

    it('4.2 Baseline runner refuses live execution in production without confirmation', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await runWalletBaselineMigrationRunner(['--apply']);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'MISSING_PRODUCTION_CONFIRMATION');

      process.env.NODE_ENV = origEnv;
    });

    it('4.3 Baseline runner defaults to dry-run mode without writes', async () => {
      const res = await runWalletBaselineMigrationRunner([]);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.report.dryRun, true);
    });
  });
});
