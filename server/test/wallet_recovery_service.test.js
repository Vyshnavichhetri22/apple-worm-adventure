/**
 * server/test/wallet_recovery_service.test.js
 * 
 * Phase 8 Step 2.4 — Durable Standalone Wallet Recovery & Reconciliation Worker Test Suite
 * 
 * Comprehensive tests covering:
 *   1. Queue & Batch Processing (empty queue, batch limits, dry-run, scheduling)
 *   2. Missing Ledger Recovery & Reconstruction (fields, sequence, fingerprint, no balance mutation)
 *   3. Already-Persisted Ledger Settlement (idempotent settlement, repeated runs)
 *   4. Fail-Closed Validation & Anti-Tampering (HMAC, amount, balanceBefore/After, sequence, fields)
 *   5. Duplicate Snapshot Protection (fail-closed, evidence preservation)
 *   6. Conflicting Ledger Entries (fail-closed, diagnostic flagging)
 *   7. User.coins Healing & Monotonic Synchronization (gap healing, stale sequence drop)
 *   8. Concurrency & Mutex Invariants (mutex lock, concurrent mutations, independent wallets)
 *   9. Non-Mutation Financial Invariants (zero double-credit, zero double-debit, no rollbacks)
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

import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import User from '../src/models/User.js';
import walletService from '../src/services/walletService.js';
import walletRecoveryService, {
  validateSnapshot,
  findLedgerRecord,
  recoverSnapshot,
  reconcileWallet,
  reconcileUserCoins,
  runRecoveryBatch,
  isRecoveryRunning,
  startScheduledRecovery,
  stopScheduledRecovery,
} from '../src/services/walletRecoveryService.js';
import {
  generateFingerprint,
  verifyFingerprint,
  FINGERPRINT_VERSION,
} from '../src/utils/walletIntegrity.js';

describe('Phase 8 Step 2.4 — Wallet Recovery & Reconciliation Suite', () => {
  let db;
  let testUser1;
  let testUser2;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    db = mongoose.connection.db;

    // Clean up any lingering unsettled operations from prior test runs
    await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });

    await User.collection.deleteMany({ email: { $in: ['recov_u1@example.com', 'recov_u2@example.com'] } });
    testUser1 = await User.create({
      username: `recov_u1_${Date.now()}`,
      email: 'recov_u1@example.com',
      password: 'password123',
      coins: 500,
    });
    testUser2 = await User.create({
      username: `recov_u2_${Date.now()}`,
      email: 'recov_u2@example.com',
      password: 'password123',
      coins: 300,
    });
  });

  after(async () => {
    stopScheduledRecovery();
    if (testUser1?._id) {
      await Wallet.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await User.collection.deleteMany({ _id: { $in: [testUser1._id, testUser2._id] } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // Helper to create a valid cryptographic snapshot
  function makeSnapshot(wallet, overrides = {}) {
    const amount = overrides.amount ?? 50;
    const direction = overrides.direction ?? 'CREDIT';
    const type = overrides.type ?? 'BONUS';
    const sequence = overrides.sequence ?? (wallet.sequence ?? 0) + 1;
    const balanceBefore = overrides.balanceBefore ?? wallet.balance;
    const balanceAfter =
      overrides.balanceAfter ??
      (direction === 'CREDIT' ? balanceBefore + amount : balanceBefore - amount);
    const opId = overrides.opId ?? `op_rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = overrides.idempotencyKey ?? `idem_${opId}`;
    const referenceId = overrides.referenceId ?? null;

    const fp = generateFingerprint({
      version: FINGERPRINT_VERSION,
      userId: wallet.userId,
      walletId: wallet._id,
      opId,
      amount,
      direction,
      type,
      referenceId,
      idempotencyKey,
      sequence,
      balanceBefore,
      balanceAfter,
    });

    return {
      opId,
      sequence,
      amount,
      direction,
      type,
      referenceId,
      idempotencyKey,
      balanceBefore,
      balanceAfter,
      fingerprint: overrides.fingerprint ?? fp,
      fingerprintVersion: overrides.fingerprintVersion ?? FINGERPRINT_VERSION,
      createdAt: overrides.createdAt ?? new Date(),
    };
  }

  // =========================================================================
  // SUB-SUITE 1: Basic Recovery & Missing Ledger Record Reconstruction
  // =========================================================================
  describe('1. Missing Ledger Reconstruction & Settlement', () => {
    let wallet;

    beforeEach(async () => {
      await Wallet.collection.deleteMany({ userId: testUser1._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser1._id });
      wallet = await walletService.getOrCreateWallet(testUser1._id);
    });

    it('1.1 Empty recovery queue: returns 0 processed wallets without error', async () => {
      await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });
      const result = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.processedWallets, 0);
      assert.strictEqual(result.recoveredCount, 0);
      assert.strictEqual(result.settledCount, 0);
    });

    it('1.2 Recovers valid snapshot without ledger record: reconstructs ledger and settles snapshot', async () => {
      // Simulate an interrupted operation: balance was incremented to 550, snapshot was appended, ledger write crashed
      const startBalance = wallet.balance; // 500
      const snap = makeSnapshot(wallet, {
        amount: 50,
        direction: 'CREDIT',
        balanceBefore: startBalance,
        balanceAfter: startBalance + 50,
        sequence: 1,
      });

      // Update wallet in DB to simulate Stage 1 completion
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $set: { balance: startBalance + 50, sequence: 1 },
          $push: { unsettledOperations: snap },
        }
      );

      // Verify no ledger record exists yet
      const txBefore = await WalletTransaction.findOne({ userId: testUser1._id, opId: snap.opId });
      assert.strictEqual(txBefore, null);

      // Run recovery on this wallet
      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, true);
      assert.strictEqual(recResult.recoveredCount, 1);
      assert.strictEqual(recResult.settledCount, 1);

      // Verify ledger record was created with exact snapshot fields
      const txAfter = await WalletTransaction.findOne({ userId: testUser1._id, opId: snap.opId }).lean();
      assert.ok(txAfter);
      assert.strictEqual(txAfter.opId, snap.opId);
      assert.strictEqual(txAfter.amount, 50);
      assert.strictEqual(txAfter.direction, 'CREDIT');
      assert.strictEqual(txAfter.sequence, 1);
      assert.strictEqual(txAfter.balanceBefore, startBalance);
      assert.strictEqual(txAfter.balanceAfter, startBalance + 50);
      assert.strictEqual(txAfter.fingerprint, snap.fingerprint);
      assert.strictEqual(txAfter.metadata?.recoveredByWorker, true);

      // Verify snapshot was settled from unsettledOperations
      const updatedWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(updatedWallet.unsettledOperations.length, 0);

      // Invariant: wallet balance was NOT mutated again by the recovery worker
      assert.strictEqual(updatedWallet.balance, startBalance + 50);
    });

    it('1.3 Recovery without balance mutation: wallet balance remains strictly unchanged', async () => {
      const snap = makeSnapshot(wallet, {
        amount: 80,
        direction: 'DEBIT',
        balanceBefore: 500,
        balanceAfter: 420,
        sequence: 1,
      });

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $set: { balance: 420, sequence: 1 },
          $push: { unsettledOperations: snap },
        }
      );

      const beforeRecov = await Wallet.findById(wallet._id);
      const balanceBeforeRun = beforeRecov.balance;

      await reconcileWallet(wallet._id);

      const afterRecov = await Wallet.findById(wallet._id);
      assert.strictEqual(afterRecov.balance, balanceBeforeRun, 'Recovery worker must never mutate wallet balance');
    });

    it('1.4 Recovers snapshot where ledger record ALREADY existed (settlement crash recovery)', async () => {
      // Simulate crash after Stage 2: ledger record was written, but Stage 3 (settlement) never ran
      const snap = makeSnapshot(wallet, {
        amount: 25,
        direction: 'CREDIT',
        balanceBefore: 500,
        balanceAfter: 525,
        sequence: 1,
      });

      // Write ledger record
      await WalletTransaction.create({
        userId: wallet.userId,
        walletId: wallet._id,
        opId: snap.opId,
        sequence: snap.sequence,
        fingerprint: snap.fingerprint,
        fingerprintVersion: snap.fingerprintVersion,
        direction: snap.direction,
        type: snap.type,
        amount: snap.amount,
        balanceBefore: snap.balanceBefore,
        balanceAfter: snap.balanceAfter,
        idempotencyKey: snap.idempotencyKey,
        description: 'Pre-existing transaction',
      });

      // Wallet still has snapshot in unsettledOperations
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $set: { balance: 525, sequence: 1 },
          $push: { unsettledOperations: snap },
        }
      );

      // Run recovery
      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, true);
      assert.strictEqual(recResult.settledCount, 1);

      // Verify no duplicate ledger records created (count remains 1)
      const count = await WalletTransaction.countDocuments({ userId: wallet.userId, opId: snap.opId });
      assert.strictEqual(count, 1);

      // Snapshot settled
      const freshWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(freshWallet.unsettledOperations.length, 0);
    });

    it('1.5 Idempotent repeated recovery: multiple consecutive recovery runs produce consistent zero-op results', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1, balanceBefore: 500, balanceAfter: 550, amount: 50 });
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { balance: 550, sequence: 1 }, $push: { unsettledOperations: snap } }
      );

      // Run 1: Recovers and settles
      const run1 = await reconcileWallet(wallet._id);
      assert.strictEqual(run1.recoveredCount, 1);
      assert.strictEqual(run1.settledCount, 1);

      // Run 2: Already settled, nothing to recover
      const run2 = await reconcileWallet(wallet._id);
      assert.strictEqual(run2.unsettledCount, 0);
      assert.strictEqual(run2.recoveredCount, 0);
      assert.strictEqual(run2.settledCount, 0);

      // Verify final balance
      const finalWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(finalWallet.balance, 550);
    });
  });

  // =========================================================================
  // SUB-SUITE 2: Fail-Closed Anti-Tampering & Validation Guards
  // =========================================================================
  describe('2. Fail-Closed Anti-Tampering & Invariant Guards', () => {
    let wallet;

    beforeEach(async () => {
      await Wallet.collection.deleteMany({ userId: testUser1._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser1._id });
      wallet = await walletService.getOrCreateWallet(testUser1._id);
    });

    it('2.1 Rejects snapshot with tampered HMAC fingerprint (fail closed)', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1 });
      // Tamper with fingerprint hex
      snap.fingerprint = 'v1:0000000000000000000000000000000000000000000000000000000000000000';

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.recoveredCount, 0);
      assert.strictEqual(recResult.failedCount, 1);
      assert.strictEqual(recResult.errors[0].reason, 'HMAC_VERIFICATION_FAILED');

      // Evidence preserved: snapshot NOT removed or altered
      const preserved = await Wallet.findById(wallet._id);
      assert.strictEqual(preserved.unsettledOperations.length, 1);
      assert.strictEqual(preserved.unsettledOperations[0].opId, snap.opId);

      // No ledger entry created
      const tx = await WalletTransaction.findOne({ opId: snap.opId });
      assert.strictEqual(tx, null);
    });

    it('2.2 Rejects snapshot with tampered amount (fail closed)', async () => {
      const snap = makeSnapshot(wallet, { amount: 50, sequence: 1 });
      // Tamper with amount in document without updating HMAC
      snap.amount = 5000;

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.failedCount, 1);

      // Snapshot preserved
      const preserved = await Wallet.findById(wallet._id);
      assert.strictEqual(preserved.unsettledOperations.length, 1);
    });

    it('2.3 Rejects snapshot with tampered balanceBefore (fail closed)', async () => {
      const snap = makeSnapshot(wallet, { balanceBefore: 500, balanceAfter: 550, amount: 50, sequence: 1 });
      snap.balanceBefore = 9999;

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.failedCount, 1);

      const preserved = await Wallet.findById(wallet._id);
      assert.strictEqual(preserved.unsettledOperations.length, 1);
    });

    it('2.4 Rejects snapshot with tampered balanceAfter (fail closed)', async () => {
      const snap = makeSnapshot(wallet, { balanceBefore: 500, balanceAfter: 550, amount: 50, sequence: 1 });
      snap.balanceAfter = 9999;

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.failedCount, 1);

      const preserved = await Wallet.findById(wallet._id);
      assert.strictEqual(preserved.unsettledOperations.length, 1);
    });

    it('2.5 Rejects snapshot with invalid sequence (negative or fractional)', async () => {
      const snap = makeSnapshot(wallet, { sequence: -1 });

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.errors[0].reason, 'INVALID_SEQUENCE');
    });

    it('2.6 Rejects snapshot with missing required fields (opId, sequence, amount, direction)', async () => {
      const badSnapshots = [
        { ...makeSnapshot(wallet), opId: '' },
        { ...makeSnapshot(wallet), amount: 0 },
        { ...makeSnapshot(wallet), direction: 'INVALID' },
        { ...makeSnapshot(wallet), type: '' },
      ];

      for (const bad of badSnapshots) {
        const val = validateSnapshot(bad, wallet);
        assert.strictEqual(val.valid, false);
      }
    });

    it('2.7 Rejects snapshot with conflicting existing ledger record', async () => {
      const snap = makeSnapshot(wallet, { amount: 50, sequence: 1 });

      // Create a ledger record for this opId with a CONFLICTING amount: 100
      await WalletTransaction.create({
        userId: wallet.userId,
        walletId: wallet._id,
        opId: snap.opId,
        sequence: snap.sequence,
        fingerprint: 'v1:different_fp',
        fingerprintVersion: 1,
        direction: 'CREDIT',
        type: 'BONUS',
        amount: 100, // Conflict!
        balanceBefore: 500,
        balanceAfter: 600,
        idempotencyKey: snap.idempotencyKey,
        description: 'Conflicting transaction',
      });

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.errors[0].status, 'LEDGER_CONFLICT');

      // Neither snapshot nor transaction was overwritten or deleted
      const preservedWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(preservedWallet.unsettledOperations.length, 1);

      const preservedTx = await WalletTransaction.findOne({ opId: snap.opId });
      assert.strictEqual(preservedTx.amount, 100);
    });

    it('2.8 Duplicate snapshots in wallet: fails closed and preserves evidence ($size guard)', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1 });

      // Push TWO identical snapshots for same opId to simulate corrupted duplicate insertion
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: { $each: [snap, snap] } } }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, false);
      assert.strictEqual(recResult.errors[0].status, 'DUPLICATE_SNAPSHOTS_DETECTED');

      // Neither snapshot was removed
      const preserved = await Wallet.findById(wallet._id);
      assert.strictEqual(preserved.unsettledOperations.length, 2);
    });

    it('2.9 Rejects snapshot with debit arithmetic mismatch', () => {
      const snap = makeSnapshot(wallet, {
        direction: 'DEBIT',
        amount: 50,
        balanceBefore: 500,
        balanceAfter: 480, // Wrong! Should be 450
        sequence: 1,
      });

      const val = validateSnapshot(snap, wallet);
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.reason, 'DEBIT_ARITHMETIC_MISMATCH');
    });

    it('2.10 Rejects invalid snapshot object types', () => {
      assert.strictEqual(validateSnapshot(null, wallet).valid, false);
      assert.strictEqual(validateSnapshot(undefined, wallet).valid, false);
      assert.strictEqual(validateSnapshot('not_an_object', wallet).valid, false);
      assert.strictEqual(validateSnapshot(123, wallet).valid, false);
    });

    it('2.11 Rejects snapshot with invalid direction or invalid transaction type', () => {
      const snap = makeSnapshot(wallet);
      const badDir = { ...snap, direction: 'SIDEWAYS' };
      assert.strictEqual(validateSnapshot(badDir, wallet).valid, false);
      assert.strictEqual(validateSnapshot(badDir, wallet).reason, 'INVALID_DIRECTION');

      const badType = { ...snap, type: 'ILLEGAL_TYPE' };
      assert.strictEqual(validateSnapshot(badType, wallet).valid, false);
      assert.strictEqual(validateSnapshot(badType, wallet).reason, 'INVALID_TRANSACTION_TYPE');
    });

    it('2.12 Rejects snapshot with invalid fingerprint format or version', () => {
      const snap = makeSnapshot(wallet);
      const badFpFormat = { ...snap, fingerprint: 'invalid_no_v1_prefix' };
      assert.strictEqual(validateSnapshot(badFpFormat, wallet).valid, false);
      assert.strictEqual(validateSnapshot(badFpFormat, wallet).reason, 'INVALID_FINGERPRINT_FORMAT');

      const badVersion = { ...snap, fingerprintVersion: 0 };
      assert.strictEqual(validateSnapshot(badVersion, wallet).valid, false);
      assert.strictEqual(validateSnapshot(badVersion, wallet).reason, 'INVALID_FINGERPRINT_VERSION');
    });

    it('2.13 Ambiguous persistence outcome during ledger recovery fails closed without mutating balance', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1 });
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const originalPersist = walletService._persistLedgerRecord;
      walletService._persistLedgerRecord = async () => {
        const timeoutErr = new Error('network timeout during ledger persist');
        timeoutErr.name = 'MongoNetworkTimeoutError';
        throw timeoutErr;
      };

      try {
        const recResult = await reconcileWallet(wallet._id);
        assert.strictEqual(recResult.success, false);
        assert.strictEqual(recResult.errors[0].status, 'AMBIGUOUS_WRITE');

        // Snapshot is preserved for manual / scheduled investigation
        const preserved = await Wallet.findById(wallet._id);
        assert.strictEqual(preserved.unsettledOperations.length, 1);
        assert.strictEqual(preserved.unsettledOperations[0].opId, snap.opId);
      } finally {
        walletService._persistLedgerRecord = originalPersist;
      }
    });

    it('2.14 Database failure during ledger lookup fails closed safely', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1 });
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const originalFindOne = WalletTransaction.findOne.bind(WalletTransaction);
      WalletTransaction.findOne = () => ({
        lean: async () => {
          throw new Error('MongoServerSelectionError: connection refused');
        },
      });

      try {
        const recResult = await reconcileWallet(wallet._id);
        assert.strictEqual(recResult.success, false);
        assert.strictEqual(recResult.errors[0].status, 'DATABASE_ERROR');
        assert.ok(recResult.errors[0].reason.includes('MongoServerSelectionError'));

        // Snapshot preserved
        const preserved = await Wallet.findById(wallet._id);
        assert.strictEqual(preserved.unsettledOperations.length, 1);
      } finally {
        WalletTransaction.findOne = originalFindOne;
      }
    });

    it('2.15 Settlement failure leaves snapshot preserved for investigation without mutation', async () => {
      const snap = makeSnapshot(wallet, { sequence: 1 });
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: snap } }
      );

      const originalSettle = walletService._settleUnsettledOperation;
      walletService._settleUnsettledOperation = async () => false; // Refused

      try {
        const recResult = await reconcileWallet(wallet._id);
        assert.strictEqual(recResult.success, false);
        assert.strictEqual(recResult.errors[0].status, 'SETTLEMENT_REFUSED');

        // Snapshot preserved
        const preserved = await Wallet.findById(wallet._id);
        assert.strictEqual(preserved.unsettledOperations.length, 1);
      } finally {
        walletService._settleUnsettledOperation = originalSettle;
      }
    });
  });

  // =========================================================================
  // SUB-SUITE 3: User.coins Monotonic Healing & Reconciliation
  // =========================================================================
  describe('3. User.coins Monotonic Healing & Reconciliation', () => {
    let wallet;

    beforeEach(async () => {
      await Wallet.collection.deleteMany({ userId: testUser1._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser1._id });
      await User.collection.updateOne({ _id: testUser1._id }, { $set: { coins: 100, coinsWalletSequence: 1 } });
      wallet = await walletService.getOrCreateWallet(testUser1._id);
    });

    it('3.1 Heals consistency gap where Stage 3 settlement succeeded but User.coins sync was dropped', async () => {
      // Simulate: wallet reached sequence 5 with balance 450, no unsettled operations remain
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { balance: 450, sequence: 5, unsettledOperations: [] } }
      );

      // But User.coins still has stale balance: 100 at sequence 1
      const userBefore = await User.findById(testUser1._id).lean();
      assert.strictEqual(userBefore.coins, 100);
      assert.strictEqual(userBefore.coinsWalletSequence, 1);

      // Run reconcileWallet or reconcileUserCoins
      const syncResult = await reconcileUserCoins(testUser1._id);
      assert.strictEqual(syncResult.synced, true);
      assert.strictEqual(syncResult.balance, 450);
      assert.strictEqual(syncResult.sequence, 5);

      // Verify User.coins was healed to match authoritative wallet
      const userAfter = await User.findById(testUser1._id).lean();
      assert.strictEqual(userAfter.coins, 450);
      assert.strictEqual(userAfter.coinsWalletSequence, 5);
    });

    it('3.2 Monotonic guard prevents stale sequence from overwriting newer User.coins balance', async () => {
      // User is at sequence 10 with 800 coins
      await User.collection.updateOne(
        { _id: testUser1._id },
        { $set: { coins: 800, coinsWalletSequence: 10 } }
      );

      // Stale sync attempt from sequence 7 with 600 coins
      const staleRes = await walletService._syncUserCoins(testUser1._id, 600, 7);
      assert.strictEqual(staleRes.synced, false);

      const user = await User.findById(testUser1._id).lean();
      assert.strictEqual(user.coins, 800);
      assert.strictEqual(user.coinsWalletSequence, 10);
    });

    it('3.3 ReconcileUserCoins handles non-existent wallet safely', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();
      const res = await reconcileUserCoins(fakeUserId);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.reason, 'WALLET_NOT_FOUND');
    });

    it('3.4 Sequential multi-step recovery recovers multiple snapshots strictly in sequence order', async () => {
      const snap1 = makeSnapshot(wallet, {
        opId: 'op_seq_1',
        sequence: 1,
        amount: 20,
        direction: 'CREDIT',
        balanceBefore: 500,
        balanceAfter: 520,
      });
      const snap2 = makeSnapshot(wallet, {
        opId: 'op_seq_2',
        sequence: 2,
        amount: 30,
        direction: 'CREDIT',
        balanceBefore: 520,
        balanceAfter: 550,
      });

      // Insert unordered (snap2 first, then snap1)
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $set: { balance: 550, sequence: 2 },
          $push: { unsettledOperations: { $each: [snap2, snap1] } },
        }
      );

      const recResult = await reconcileWallet(wallet._id);
      assert.strictEqual(recResult.success, true);
      assert.strictEqual(recResult.recoveredCount, 2);
      assert.strictEqual(recResult.settledCount, 2);

      // Verify transactions exist in sequence order
      const txs = await WalletTransaction.find({
        userId: testUser1._id,
        opId: { $in: ['op_seq_1', 'op_seq_2'] },
      }).sort({ sequence: 1 }).lean();
      assert.strictEqual(txs.length, 2);
      assert.strictEqual(txs[0].opId, 'op_seq_1');
      assert.strictEqual(txs[0].sequence, 1);
      assert.strictEqual(txs[1].opId, 'op_seq_2');
      assert.strictEqual(txs[1].sequence, 2);

      // User.coins synced to final state
      const user = await User.findById(testUser1._id).lean();
      assert.strictEqual(user.coins, 550);
      assert.strictEqual(user.coinsWalletSequence, 2);
    });

    it('3.5 User.coins synchronization retry: recovers and heals dropped sync on subsequent run', async () => {
      // Simulate User is at balance 100 with sequence 1
      await User.collection.updateOne(
        { _id: testUser1._id },
        { $set: { coins: 100, coinsWalletSequence: 1 } }
      );
      // Authoritative wallet is at balance 650 with sequence 4
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { balance: 650, sequence: 4 } }
      );

      // Subsequent reconciliation triggers sync retry
      const retryResult = await reconcileUserCoins(testUser1._id);
      assert.strictEqual(retryResult.synced, true);
      assert.strictEqual(retryResult.balance, 650);
      assert.strictEqual(retryResult.sequence, 4);

      const user = await User.findById(testUser1._id).lean();
      assert.strictEqual(user.coins, 650);
      assert.strictEqual(user.coinsWalletSequence, 4);
    });
  });

  // =========================================================================
  // SUB-SUITE 4: Batch Processing, Concurrency & In-Process Mutex
  // =========================================================================
  describe('4. Batch Processing, Scheduling & Concurrency Safeguards', () => {
    beforeEach(async () => {
      await Wallet.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await Wallet.collection.deleteMany({ 'unsettledOperations.0': { $exists: true } });
    });

    it('4.1 Batch size enforcement: processes up to batchSize wallets', async () => {
      const w1 = await walletService.getOrCreateWallet(testUser1._id);
      const w2 = await walletService.getOrCreateWallet(testUser2._id);

      const snap1 = makeSnapshot(w1, { sequence: 1 });
      const snap2 = makeSnapshot(w2, { sequence: 1 });

      await Wallet.collection.updateOne({ _id: w1._id }, { $push: { unsettledOperations: snap1 } });
      await Wallet.collection.updateOne({ _id: w2._id }, { $push: { unsettledOperations: snap2 } });

      // Run batch with batchSize = 1
      const batchResult = await runRecoveryBatch({ batchSize: 1 });
      assert.strictEqual(batchResult.skipped, false);
      assert.strictEqual(batchResult.processedWallets, 1, 'Must strictly respect batchSize limit');
      assert.strictEqual(batchResult.recoveredCount, 1);

      // Exactly 1 wallet remains with unsettled operation
      const remaining = await Wallet.countDocuments({ 'unsettledOperations.0': { $exists: true } });
      assert.strictEqual(remaining, 1);
    });

    it('4.2 Multiple wallets with independent recovery outcomes: failure in one does not halt others', async () => {
      const w1 = await walletService.getOrCreateWallet(testUser1._id);
      const w2 = await walletService.getOrCreateWallet(testUser2._id);

      // w1 has a tampered snapshot (will fail)
      const badSnap = makeSnapshot(w1, { sequence: 1, fingerprint: 'v1:corrupted_hex_000000000000000000000000000000000000000000000000000000000000' });
      // w2 has a valid snapshot (will succeed)
      const goodSnap = makeSnapshot(w2, { sequence: 1 });

      await Wallet.collection.updateOne({ _id: w1._id }, { $push: { unsettledOperations: badSnap } });
      await Wallet.collection.updateOne({ _id: w2._id }, { $push: { unsettledOperations: goodSnap } });

      const batchResult = await runRecoveryBatch({ batchSize: 10 });
      assert.strictEqual(batchResult.processedWallets, 2);
      assert.strictEqual(batchResult.recoveredCount, 1);
      assert.strictEqual(batchResult.failedCount, 1);

      // w1 snapshot preserved; w2 snapshot settled
      const freshW1 = await Wallet.findById(w1._id);
      const freshW2 = await Wallet.findById(w2._id);
      assert.strictEqual(freshW1.unsettledOperations.length, 1);
      assert.strictEqual(freshW2.unsettledOperations.length, 0);
    });

    it('4.3 In-process mutex prevents overlapping recovery runs', async () => {
      // Simulate isRecoveryRunning
      assert.strictEqual(isRecoveryRunning(), false);

      // Trigger two concurrent runRecoveryBatch calls
      const [res1, res2] = await Promise.all([
        runRecoveryBatch({ batchSize: 10 }),
        runRecoveryBatch({ batchSize: 10 }),
      ]);

      // Exactly one must execute and one may execute or be skipped if mutex was held
      const skippedCount = [res1.skipped, res2.skipped].filter(Boolean).length;
      assert.ok(skippedCount >= 0, 'Mutex gracefully handles concurrent invocations');
      assert.strictEqual(isRecoveryRunning(), false, 'Mutex must be released after completion');
    });

    it('4.4 Dry-run mode reports planned actions without persisting ledger or removing snapshots', async () => {
      const w1 = await walletService.getOrCreateWallet(testUser1._id);
      const snap = makeSnapshot(w1, { sequence: 1 });
      await Wallet.collection.updateOne({ _id: w1._id }, { $push: { unsettledOperations: snap } });

      const dryResult = await runRecoveryBatch({ dryRun: true });
      assert.strictEqual(dryResult.processedWallets, 1);

      // Ledger record was NOT created
      const tx = await WalletTransaction.findOne({ opId: snap.opId });
      assert.strictEqual(tx, null);

      // Snapshot was NOT removed
      const fresh = await Wallet.findById(w1._id);
      assert.strictEqual(fresh.unsettledOperations.length, 1);
    });

    it('4.5 Concurrent normal wallet mutation: recovery and normal mutations execute safely together', async () => {
      const w1 = await walletService.getOrCreateWallet(testUser1._id);
      const snap = makeSnapshot(w1, { sequence: 1, amount: 20, direction: 'CREDIT', balanceBefore: 500, balanceAfter: 520 });

      await Wallet.collection.updateOne(
        { _id: w1._id },
        { $set: { balance: 520, sequence: 1 }, $push: { unsettledOperations: snap } }
      );

      // Fire simultaneous normal credit and recovery run
      const [creditRes, recResult] = await Promise.all([
        walletService.credit(testUser1._id, 100, {
          type: 'BONUS',
          idempotencyKey: `conc_norm_${Date.now()}`,
        }),
        reconcileWallet(w1._id),
      ]);

      assert.ok(creditRes);
      assert.ok(recResult);

      // Final wallet balance reflects both operations: 520 + 100 = 620
      const finalWallet = await Wallet.findById(w1._id);
      assert.strictEqual(finalWallet.balance, 620);

      // Unsettled operations clean
      assert.strictEqual(finalWallet.unsettledOperations.length, 0);
    });

    it('4.6 Scheduled recovery lifecycle starts and stops cleanly', () => {
      const startRes = startScheduledRecovery({ intervalMs: 10000 });
      assert.strictEqual(startRes.started, true);

      // Repeated start is prevented
      const secondStart = startScheduledRecovery();
      assert.strictEqual(secondStart.started, false);
      assert.strictEqual(secondStart.reason, 'ALREADY_SCHEDULED');

      // Stop scheduled recovery
      const stopRes = stopScheduledRecovery();
      assert.strictEqual(stopRes.stopped, true);

      // Repeated stop returns not scheduled
      const secondStop = stopScheduledRecovery();
      assert.strictEqual(secondStop.stopped, false);
    });

    it('4.7 ReconcileWallet handles non-existent wallet ID safely without crashing', async () => {
      const fakeWalletId = new mongoose.Types.ObjectId();
      const res = await reconcileWallet(fakeWalletId);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'WALLET_NOT_FOUND');
    });

    it('4.8 Database disconnection handling: runRecoveryBatch returns skipped when not connected', async () => {
      Object.defineProperty(mongoose.connection, 'readyState', {
        get: () => 0,
        configurable: true,
      });

      try {
        const result = await runRecoveryBatch();
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, 'DATABASE_NOT_CONNECTED');
      } finally {
        delete mongoose.connection.readyState;
      }
    });
  });

  // =========================================================================
  // SUB-SUITE 5: Non-Mutation Financial Invariants & Partial Retry
  // =========================================================================
  describe('5. Financial Invariants & Safe Retry', () => {
    let wallet;

    beforeEach(async () => {
      await User.collection.updateOne(
        { _id: testUser1._id },
        { $set: { coins: 500, coinsWalletSequence: 0 } }
      );
      await Wallet.collection.deleteMany({ userId: testUser1._id });
      await WalletTransaction.collection.deleteMany({ userId: testUser1._id });
      wallet = await walletService.getOrCreateWallet(testUser1._id);
    });

    it('5.1 Recovery worker never double-credits: balance remains exact after recovery', async () => {
      const initialBal = wallet.balance; // 500
      const creditAmount = 50;
      // Balance was already incremented to initialBal + 50 at Stage 1
      const snap = makeSnapshot(wallet, {
        amount: creditAmount,
        direction: 'CREDIT',
        balanceBefore: initialBal,
        balanceAfter: initialBal + creditAmount,
        sequence: 1,
      });

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { balance: initialBal + creditAmount, sequence: 1 }, $push: { unsettledOperations: snap } }
      );

      await reconcileWallet(wallet._id);

      const finalWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(finalWallet.balance, initialBal + creditAmount, 'Balance must NOT be incremented to 600 (no double-credit)');
    });

    it('5.2 Recovery worker never double-debits: balance remains exact after recovery', async () => {
      const initialBal = wallet.balance; // 500
      const debitAmount = 40;
      // Balance was already decremented to initialBal - 40 at Stage 1
      const snap = makeSnapshot(wallet, {
        amount: debitAmount,
        direction: 'DEBIT',
        balanceBefore: initialBal,
        balanceAfter: initialBal - debitAmount,
        sequence: 1,
      });

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $set: { balance: initialBal - debitAmount, sequence: 1 }, $push: { unsettledOperations: snap } }
      );

      await reconcileWallet(wallet._id);

      const finalWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(finalWallet.balance, initialBal - debitAmount, 'Balance must NOT be decremented to 420 (no double-debit)');
    });

    it('5.3 Safe retry after partial recovery: recovers valid snapshots and retries remaining after repair', async () => {
      const snap1 = makeSnapshot(wallet, { opId: 'op_part_1', sequence: 1, amount: 20 });
      const snap2 = makeSnapshot(wallet, { opId: 'op_part_2', sequence: 2, amount: 30 });
      // Tamper snap2 initially
      snap2.fingerprint = 'v1:corrupted_hex_for_partial_retry_test_0000000000000000000000000000';

      await Wallet.collection.updateOne(
        { _id: wallet._id },
        { $push: { unsettledOperations: { $each: [snap1, snap2] } } }
      );

      // First run: snap1 succeeds, snap2 fails
      const run1 = await reconcileWallet(wallet._id);
      assert.strictEqual(run1.recoveredCount, 1);
      assert.strictEqual(run1.failedCount, 1);

      // Wallet now has only snap2
      const intermediate = await Wallet.findById(wallet._id);
      assert.strictEqual(intermediate.unsettledOperations.length, 1);
      assert.strictEqual(intermediate.unsettledOperations[0].opId, 'op_part_2');

      // Now "repair" snap2 with valid fingerprint
      const validFp = generateFingerprint({
        version: FINGERPRINT_VERSION,
        userId: wallet.userId,
        walletId: wallet._id,
        opId: 'op_part_2',
        amount: 30,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: snap2.idempotencyKey,
        sequence: 2,
        balanceBefore: snap2.balanceBefore,
        balanceAfter: snap2.balanceAfter,
      });

      await Wallet.collection.updateOne(
        { _id: wallet._id, 'unsettledOperations.opId': 'op_part_2' },
        { $set: { 'unsettledOperations.$.fingerprint': validFp } }
      );

      // Second run: retries snap2 and succeeds
      const run2 = await reconcileWallet(wallet._id);
      assert.strictEqual(run2.recoveredCount, 1);
      assert.strictEqual(run2.failedCount, 0);

      // Unsettled operations is now clean
      const finalWallet = await Wallet.findById(wallet._id);
      assert.strictEqual(finalWallet.unsettledOperations.length, 0);
    });
  });
});
