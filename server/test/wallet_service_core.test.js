/**
 * server/test/wallet_service_core.test.js
 * 
 * Phase 8 Step 2.3 — Authoritative Standalone Wallet Service Core Test Suite
 * 
 * Comprehensive tests covering:
 *   1. Keyed HMAC-SHA-256 Fingerprint Generation & Verification (walletIntegrity.js)
 *   2. Atomic Wallet Mutation Primitive (_mutateWalletAtomic)
 *   3. Exactly-Once Ledger Persistence & Duplicate Classification (_persistLedgerRecord)
 *   4. Exactly-One Snapshot Settlement Guard (_settleUnsettledOperation)
 *   5. Monotonic User.coins Synchronization (_syncUserCoins)
 *   6. High-Level Financial Operations (credit & debit)
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
import walletService, {
  isIdempotencyKeyDuplicateError,
  isAmbiguousWriteError,
  supportsTransactions,
} from '../src/services/walletService.js';
import {
  FINGERPRINT_VERSION,
  MAX_UNSETTLED_OPERATIONS,
  getIntegritySecret,
  normalizeOperationInput,
  deriveCanonicalOpId,
  buildCanonicalFingerprintPayload,
  generateFingerprint,
  verifyFingerprint,
} from '../src/utils/walletIntegrity.js';

describe('Phase 8 Step 2.3 — Wallet Service Core Suite', () => {
  let db;
  let testUser1;
  let testUser2;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    db = mongoose.connection.db;

    // Create persistent test users for service-level operations
    await User.deleteMany({ email: { $in: ['core_test_1@example.com', 'core_test_2@example.com'] } });
    testUser1 = await User.create({
      username: `core_u1_${Date.now()}`,
      email: 'core_test_1@example.com',
      password: 'password123',
      coins: 500,
    });
    testUser2 = await User.create({
      username: `core_u2_${Date.now()}`,
      email: 'core_test_2@example.com',
      password: 'password123',
      coins: 200,
    });
  });

  after(async () => {
    if (testUser1?._id) {
      await Wallet.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await WalletTransaction.collection.deleteMany({ userId: { $in: [testUser1._id, testUser2._id] } });
      await User.collection.deleteMany({ _id: { $in: [testUser1._id, testUser2._id] } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // =========================================================================
  // SUB-SUITE 1: Cryptographic HMAC-SHA-256 Fingerprint & Integrity Utilities
  // =========================================================================
  describe('1. Cryptographic HMAC-SHA-256 Fingerprint & Integrity Utilities', () => {
    const samplePayload = {
      version: 1,
      userId: new mongoose.Types.ObjectId(),
      walletId: new mongoose.Types.ObjectId(),
      opId: 'op_test_12345',
      amount: 100,
      direction: 'CREDIT',
      type: 'LEVEL_REWARD',
      referenceId: 'level_5',
      idempotencyKey: 'idem_key_abc',
      sequence: 1,
      balanceBefore: 0,
      balanceAfter: 100,
    };

    it('1.1 Generates deterministic fingerprint for identical payload', () => {
      const fp1 = generateFingerprint(samplePayload);
      const fp2 = generateFingerprint(samplePayload);
      assert.strictEqual(typeof fp1, 'string');
      assert.strictEqual(fp1, fp2, 'Fingerprints generated from identical data must be strictly identical');
    });

    it('1.2 Fingerprint adheres to v1:<64-char-hex> format', () => {
      const fp = generateFingerprint(samplePayload);
      assert.ok(fp.startsWith('v1:'), 'Fingerprint must start with v1: prefix');
      const hex = fp.slice(3);
      assert.strictEqual(hex.length, 64, 'HMAC-SHA-256 digest must be exactly 64 hex characters');
      assert.match(hex, /^[0-9a-f]{64}$/, 'Digest must contain valid lowercase hexadecimal characters');
    });

    it('1.3 Successfully verifies valid fingerprint with active secret', () => {
      const fp = generateFingerprint(samplePayload);
      const isValid = verifyFingerprint(samplePayload, fp);
      assert.strictEqual(isValid, true, 'Valid payload and fingerprint must verify as true');
    });

    it('1.4 Rejects payload alterations across all critical financial and identity fields', () => {
      const originalFp = generateFingerprint(samplePayload);

      const fieldMutations = [
        { field: 'version', mutated: 2 },
        { field: 'userId', mutated: new mongoose.Types.ObjectId() },
        { field: 'walletId', mutated: new mongoose.Types.ObjectId() },
        { field: 'opId', mutated: 'op_tampered_999' },
        { field: 'amount', mutated: 101 },
        { field: 'direction', mutated: 'DEBIT' },
        { field: 'type', mutated: 'BONUS' },
        { field: 'referenceId', mutated: 'level_6' },
        { field: 'idempotencyKey', mutated: 'idem_key_tampered' },
        { field: 'sequence', mutated: 2 },
        { field: 'balanceBefore', mutated: 10 },
        { field: 'balanceAfter', mutated: 110 },
      ];

      for (const { field, mutated } of fieldMutations) {
        const altered = { ...samplePayload, [field]: mutated };
        const result = verifyFingerprint(altered, originalFp);
        assert.strictEqual(
          result,
          false,
          `Tampering field "${field}" must cause fingerprint verification to fail`
        );
      }
    });

    it('1.5 Supports secret rotation: validates fingerprint created with previous secret', () => {
      const oldSecret = 'old_secret_key_rotation_test_32chars_min';
      const fpOld = generateFingerprint(samplePayload, oldSecret);

      // Verify that default active secret does NOT validate it
      const activeValid = verifyFingerprint(samplePayload, fpOld);
      assert.strictEqual(activeValid, false, 'Should fail under different active secret without previous secret configured');

      // Set WALLET_INTEGRITY_SECRET_PREVIOUS and verify rotation fallback
      const prevEnv = process.env.WALLET_INTEGRITY_SECRET_PREVIOUS;
      try {
        process.env.WALLET_INTEGRITY_SECRET_PREVIOUS = oldSecret;
        const rotationValid = verifyFingerprint(samplePayload, fpOld);
        assert.strictEqual(rotationValid, true, 'Must verify successfully against previous secret during rotation');
      } finally {
        if (prevEnv) {
          process.env.WALLET_INTEGRITY_SECRET_PREVIOUS = prevEnv;
        } else {
          delete process.env.WALLET_INTEGRITY_SECRET_PREVIOUS;
        }
      }
    });

    it('1.6 Production secret guard: throws when WALLET_INTEGRITY_SECRET is missing or < 32 chars in production', () => {
      const origEnv = process.env.NODE_ENV;
      const origSec = process.env.WALLET_INTEGRITY_SECRET;
      try {
        process.env.NODE_ENV = 'production';

        // Missing secret
        delete process.env.WALLET_INTEGRITY_SECRET;
        assert.throws(
          () => getIntegritySecret('v1'),
          /CRITICAL CONFIGURATION ERROR.*WALLET_INTEGRITY_SECRET/
        );

        // Secret too short
        process.env.WALLET_INTEGRITY_SECRET = 'short_secret_only_24_chars';
        assert.throws(
          () => getIntegritySecret('v1'),
          /CRITICAL CONFIGURATION ERROR.*at least 32 characters/
        );

        // Valid secret (>= 32 chars)
        process.env.WALLET_INTEGRITY_SECRET = 'production_super_secret_integrity_key_32chars!';
        const sec = getIntegritySecret('v1');
        assert.strictEqual(sec, 'production_super_secret_integrity_key_32chars!');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origSec) {
          process.env.WALLET_INTEGRITY_SECRET = origSec;
        } else {
          delete process.env.WALLET_INTEGRITY_SECRET;
        }
      }
    });

    it('1.7 Malformed fingerprints are rejected safely', () => {
      const invalidFps = [
        null,
        undefined,
        '',
        'v1:',
        'v1:not_hex',
        'v2:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // wrong version prefix
        'v1:short_hex',
        'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefEXTRA', // 69 chars
      ];

      for (const fp of invalidFps) {
        assert.strictEqual(verifyFingerprint(samplePayload, fp), false, `Invalid fingerprint "${fp}" must return false`);
      }
    });

    it('1.8 normalizeOperationInput validates and normalizes inputs strictly', () => {
      const validUserId = new mongoose.Types.ObjectId();

      // Non-positive amounts
      assert.throws(() => normalizeOperationInput(validUserId, 0, 'CREDIT'), /positive safe integer/);
      assert.throws(() => normalizeOperationInput(validUserId, -10, 'CREDIT'), /positive safe integer/);
      assert.throws(() => normalizeOperationInput(validUserId, 12.34, 'CREDIT'), /positive safe integer/);
      assert.throws(() => normalizeOperationInput(validUserId, Number.MAX_SAFE_INTEGER + 1, 'CREDIT'), /positive safe integer/);

      // Invalid direction & type
      assert.throws(() => normalizeOperationInput(validUserId, 50, 'INVALID_DIR'), /Invalid transaction direction/);
      assert.throws(() => normalizeOperationInput(validUserId, 50, 'CREDIT', { type: 'INVALID_TYPE' }), /Invalid transaction type/);

      // String trimming and whitespace mapping
      const norm = normalizeOperationInput(validUserId, 50, 'CREDIT', {
        idempotencyKey: '   idem_123   ',
        referenceId: '   ',
        description: '   Valid description   ',
      });
      assert.strictEqual(norm.idempotencyKey, 'idem_123');
      assert.strictEqual(norm.referenceId, null, 'Whitespace-only string must normalize to null');
      assert.strictEqual(norm.description, 'Valid description');
      assert.ok(norm.opId.startsWith('op_idem_'), 'Supplied idempotencyKey must derive deterministic op_idem_ ID');
    });

    it('1.9 deriveCanonicalOpId produces deterministic opId across retries', () => {
      const uid = new mongoose.Types.ObjectId();
      const op1 = deriveCanonicalOpId(uid, 'same_idem_key');
      const op2 = deriveCanonicalOpId(uid, 'same_idem_key');
      assert.strictEqual(op1, op2, 'Derivation must be deterministic for identical user and idempotencyKey');
      assert.ok(op1.startsWith('op_idem_'));

      // Explicit opId preserved
      const explicit = deriveCanonicalOpId(uid, 'some_key', 'explicit_op_99');
      assert.strictEqual(explicit, 'explicit_op_99');

      // Random opId when no key provided
      const rnd1 = deriveCanonicalOpId(uid, null);
      const rnd2 = deriveCanonicalOpId(uid, null);
      assert.ok(rnd1.startsWith('op_rnd_'));
      assert.notStrictEqual(rnd1, rnd2, 'Random opIds without idempotencyKey must be distinct');
    });
  });

  // =========================================================================
  // SUB-SUITE 2: Atomic Wallet Mutation Primitive (_mutateWalletAtomic)
  // =========================================================================
  describe('2. Atomic Wallet Mutation Primitive (_mutateWalletAtomic)', () => {
    let testWalletUser;

    beforeEach(async () => {
      testWalletUser = new mongoose.Types.ObjectId();
      await Wallet.deleteMany({ userId: testWalletUser });
    });

    it('2.1 Clean credit advances sequence, increases balance, and appends valid unsettled snapshot', async () => {
      const wallet = await walletService.getOrCreateWallet(testWalletUser);
      assert.strictEqual(wallet.balance, 0);

      const result = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 150,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: 'ref_bonus_1',
        idempotencyKey: 'idem_atomic_credit_1',
        opId: 'op_atomic_credit_1',
        description: 'Test atomic credit',
        metadata: { tag: 'unit' },
      });

      assert.strictEqual(result.alreadyInFlight, false);
      assert.strictEqual(result.wallet.balance, 150);
      assert.strictEqual(result.wallet.sequence, 1);
      assert.strictEqual(result.wallet.unsettledOperations.length, 1);

      const snap = result.snapshot;
      assert.strictEqual(snap.opId, 'op_atomic_credit_1');
      assert.strictEqual(snap.sequence, 1);
      assert.strictEqual(snap.amount, 150);
      assert.strictEqual(snap.direction, 'CREDIT');
      assert.strictEqual(snap.balanceBefore, 0);
      assert.strictEqual(snap.balanceAfter, 150);

      // Validate HMAC fingerprint stored in snapshot
      const isFpValid = verifyFingerprint(
        { ...snap, walletId: result.wallet._id, userId: testWalletUser },
        snap.fingerprint
      );
      assert.strictEqual(isFpValid, true, 'Snapshot must have valid HMAC fingerprint matching exact state');
    });

    it('2.2 Clean debit advances sequence, decrements balance, and appends valid unsettled snapshot', async () => {
      // First credit 300
      await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 300,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_prep_credit',
        opId: 'op_prep_credit',
        description: 'Prep credit',
        metadata: {},
      });

      // Now debit 120
      const debitResult = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 120,
        direction: 'DEBIT',
        type: 'HINT_PURCHASE',
        referenceId: 'hint_level_1',
        idempotencyKey: 'idem_atomic_debit_1',
        opId: 'op_atomic_debit_1',
        description: 'Test atomic debit',
        metadata: {},
      });

      assert.strictEqual(debitResult.wallet.balance, 180);
      assert.strictEqual(debitResult.wallet.sequence, 2);
      assert.strictEqual(debitResult.snapshot.balanceBefore, 300);
      assert.strictEqual(debitResult.snapshot.balanceAfter, 180);
      assert.strictEqual(debitResult.snapshot.amount, 120);

      const isFpValid = verifyFingerprint(
        { ...debitResult.snapshot, walletId: debitResult.wallet._id, userId: testWalletUser },
        debitResult.snapshot.fingerprint
      );
      assert.strictEqual(isFpValid, true);
    });

    it('2.3 Rejects debit when balance is insufficient (HTTP 400)', async () => {
      await walletService.getOrCreateWallet(testWalletUser);

      await assert.rejects(
        async () => {
          await walletService._mutateWalletAtomic({
            userId: testWalletUser,
            amount: 50,
            direction: 'DEBIT',
            type: 'UNDO_PURCHASE',
            referenceId: null,
            idempotencyKey: 'idem_overdraft',
            opId: 'op_overdraft',
            description: 'Overdraft attempt',
            metadata: {},
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /Insufficient balance/);
          return true;
        }
      );
    });

    it('2.4 Rejects credit exceeding maximum safe integer limit (HTTP 400)', async () => {
      // Set balance to MAX_SAFE_INTEGER - 10
      await Wallet.collection.insertOne({
        userId: testWalletUser,
        balance: Number.MAX_SAFE_INTEGER - 10,
        currency: 'COINS',
        isActive: true,
        sequence: 1,
        baselineBalance: 0,
        baselineSequence: 0,
        unsettledOperations: [],
      });

      await assert.rejects(
        async () => {
          await walletService._mutateWalletAtomic({
            userId: testWalletUser,
            amount: 20, // would exceed MAX_SAFE_INTEGER
            direction: 'CREDIT',
            type: 'BONUS',
            referenceId: null,
            idempotencyKey: 'idem_overflow',
            opId: 'op_overflow',
            description: 'Overflow attempt',
            metadata: {},
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /Credit exceeds maximum safe balance integer limit/);
          return true;
        }
      );
    });

    it('2.5 Legacy wallet baseline initialization: atomic pipeline establishes baseline fields', async () => {
      // Insert bare legacy wallet document without sequence or baseline fields
      await Wallet.collection.insertOne({
        userId: testWalletUser,
        balance: 250,
        currency: 'COINS',
        isActive: true,
      });

      const res = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_legacy_init',
        opId: 'op_legacy_init',
        description: 'First mutation on legacy doc',
        metadata: {},
      });

      assert.strictEqual(res.wallet.balance, 300);
      assert.strictEqual(res.wallet.sequence, 1);
      assert.strictEqual(res.wallet.baselineBalance, 250);
      assert.strictEqual(res.wallet.baselineSequence, 0);
      assert.ok(res.wallet.baselineEstablishedAt);
    });

    it('2.6 Pipeline $literal safety: strings with $, dots, and special chars are treated as literals', async () => {
      await walletService.getOrCreateWallet(testWalletUser);

      const specialOpId = '$literal.opId$test.key';
      const specialRef = '$ref.nested.field';
      const specialDesc = '$100 bonus with $nested.operator';

      const res = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 75,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: specialRef,
        idempotencyKey: '$special.idem.key',
        opId: specialOpId,
        description: specialDesc,
        metadata: { special: true },
      });

      const snap = res.snapshot;
      assert.strictEqual(snap.opId, specialOpId);
      assert.strictEqual(snap.referenceId, specialRef);

      // Verify DB stored exact literal values
      const dbDoc = await Wallet.collection.findOne({ userId: testWalletUser });
      const dbSnap = dbDoc.unsettledOperations.find((op) => op.opId === specialOpId);
      assert.ok(dbSnap, 'Snapshot with $ and . characters must be saved verbatim');
      assert.strictEqual(dbSnap.opId, specialOpId);
      assert.strictEqual(dbSnap.referenceId, specialRef);
    });

    it('2.7 Duplicate in-flight opId with identical parameters returns existing snapshot without re-mutating', async () => {
      await walletService.getOrCreateWallet(testWalletUser);

      // First mutation
      const res1 = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 60,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_in_flight',
        opId: 'op_in_flight_1',
        description: 'First run',
        metadata: {},
      });
      assert.strictEqual(res1.alreadyInFlight, false);
      assert.strictEqual(res1.wallet.balance, 60);

      // Second identical in-flight mutation attempt before settlement
      const res2 = await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 60,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_in_flight',
        opId: 'op_in_flight_1',
        description: 'Second run',
        metadata: {},
      });

      assert.strictEqual(res2.alreadyInFlight, true);
      assert.strictEqual(res2.wallet.balance, 60, 'Balance must NOT be incremented twice');
      assert.strictEqual(res2.snapshot.opId, 'op_in_flight_1');
    });

    it('2.8 Duplicate in-flight opId with conflicting parameters is rejected with HTTP 409', async () => {
      await walletService.getOrCreateWallet(testWalletUser);

      await walletService._mutateWalletAtomic({
        userId: testWalletUser,
        amount: 60,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_conflict_flight',
        opId: 'op_conflict_flight',
        description: 'Initial operation',
        metadata: {},
      });

      // Conflicting amount for same opId
      await assert.rejects(
        async () => {
          await walletService._mutateWalletAtomic({
            userId: testWalletUser,
            amount: 90, // conflicting amount!
            direction: 'CREDIT',
            type: 'BONUS',
            referenceId: null,
            idempotencyKey: 'idem_conflict_flight',
            opId: 'op_conflict_flight',
            description: 'Conflicting operation',
            metadata: {},
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.match(err.message, /Idempotency key collision/);
          return true;
        }
      );
    });

    it('2.9 Capacity limit backpressure: rejects mutations with HTTP 503 when unsettled operations reach limit', async () => {
      // Pre-fill wallet with 100 fake unsettled operations
      const dummySnapshots = Array.from({ length: MAX_UNSETTLED_OPERATIONS }, (_, i) => ({
        opId: `dummy_op_${i}`,
        sequence: i + 1,
        amount: 1,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: `dummy_idem_${i}`,
        balanceBefore: i,
        balanceAfter: i + 1,
        fingerprint: 'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        fingerprintVersion: 1,
        createdAt: new Date(),
      }));

      await Wallet.collection.insertOne({
        userId: testWalletUser,
        balance: 100,
        currency: 'COINS',
        isActive: true,
        sequence: 100,
        baselineBalance: 0,
        baselineSequence: 0,
        unsettledOperations: dummySnapshots,
      });

      await assert.rejects(
        async () => {
          await walletService._mutateWalletAtomic({
            userId: testWalletUser,
            amount: 10,
            direction: 'CREDIT',
            type: 'BONUS',
            referenceId: null,
            idempotencyKey: 'idem_backpressure',
            opId: 'op_backpressure',
            description: 'Backpressure test',
            metadata: {},
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 503);
          assert.match(err.message, /Capacity limit reached/);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUB-SUITE 3: Exactly-Once Ledger Persistence Primitive (_persistLedgerRecord)
  // =========================================================================
  describe('3. Exactly-Once Ledger Persistence Primitive (_persistLedgerRecord)', () => {
    let ledgerUser;
    let ledgerWallet;

    beforeEach(async () => {
      ledgerUser = new mongoose.Types.ObjectId();
      await Wallet.collection.deleteMany({ userId: ledgerUser });
      await WalletTransaction.collection.deleteMany({ userId: ledgerUser });
      ledgerWallet = await walletService.getOrCreateWallet(ledgerUser);
    });

    it('3.1 Clean persistence records all snapshot fields, financial state, and HMAC fingerprint', async () => {
      const snapshot = {
        opId: 'op_ledger_clean_1',
        sequence: 1,
        amount: 100,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: 'ref_1',
        idempotencyKey: 'idem_ledger_clean_1',
        balanceBefore: 0,
        balanceAfter: 100,
        fingerprint: generateFingerprint({
          version: 1,
          userId: ledgerUser,
          walletId: ledgerWallet._id,
          opId: 'op_ledger_clean_1',
          amount: 100,
          direction: 'CREDIT',
          type: 'BONUS',
          referenceId: 'ref_1',
          idempotencyKey: 'idem_ledger_clean_1',
          sequence: 1,
          balanceBefore: 0,
          balanceAfter: 100,
        }),
        fingerprintVersion: 1,
      };

      const res = await walletService._persistLedgerRecord(ledgerWallet, snapshot, {
        description: 'Clean ledger test',
        metadata: { test: true },
      });

      assert.strictEqual(res.isDuplicate, false);
      assert.strictEqual(res.transaction.opId, 'op_ledger_clean_1');
      assert.strictEqual(res.transaction.amount, 100);
      assert.strictEqual(res.transaction.balanceBefore, 0);
      assert.strictEqual(res.transaction.balanceAfter, 100);
      assert.strictEqual(res.transaction.fingerprint, snapshot.fingerprint);
      assert.strictEqual(res.transaction.fingerprintVersion, 1);
    });

    it('3.2 Idempotent retry returns existing transaction with isDuplicate: true', async () => {
      const snapshot = {
        opId: 'op_ledger_retry_1',
        sequence: 1,
        amount: 75,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_ledger_retry_1',
        balanceBefore: 0,
        balanceAfter: 75,
        fingerprint: 'v1:fake_fingerprint_hex',
        fingerprintVersion: 1,
      };

      // First call
      const res1 = await walletService._persistLedgerRecord(ledgerWallet, snapshot, {
        description: 'First call',
      });
      assert.strictEqual(res1.isDuplicate, false);

      // Second identical call
      const res2 = await walletService._persistLedgerRecord(ledgerWallet, snapshot, {
        description: 'Second call',
      });
      assert.strictEqual(res2.isDuplicate, true);
      assert.strictEqual(res1.transaction._id.toString(), res2.transaction._id.toString());
    });

    it('3.3 Duplicate-key with conflicting parameters is rejected with HTTP 409', async () => {
      const snapshot = {
        opId: 'op_ledger_conflict_1',
        sequence: 1,
        amount: 50,
        direction: 'DEBIT',
        type: 'HINT_PURCHASE',
        referenceId: null,
        idempotencyKey: 'idem_ledger_conflict_1',
        balanceBefore: 100,
        balanceAfter: 50,
        fingerprint: 'v1:fake_fp',
        fingerprintVersion: 1,
      };

      await walletService._persistLedgerRecord(ledgerWallet, snapshot);

      // Attempt with conflicting amount
      const conflictingSnapshot = {
        ...snapshot,
        amount: 99, // Conflicting!
      };

      await assert.rejects(
        async () => {
          await walletService._persistLedgerRecord(ledgerWallet, conflictingSnapshot);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.match(err.message, /Idempotency key collision/);
          return true;
        }
      );
    });

    it('3.4 Ambiguous write where ledger DID persist is recovered via verification without error', async () => {
      const snapshot = {
        opId: 'op_ambig_persisted',
        sequence: 1,
        amount: 40,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_ambig_persisted',
        balanceBefore: 0,
        balanceAfter: 40,
        fingerprint: 'v1:fake_fp',
        fingerprintVersion: 1,
      };

      const originalCreate = WalletTransaction.create.bind(WalletTransaction);
      WalletTransaction.create = async (doc) => {
        // Write directly to DB to simulate successful persistence
        await originalCreate(doc);
        // Throw simulated network timeout
        const timeoutErr = new Error('Connection timed out waiting for server ack');
        timeoutErr.name = 'MongoNetworkTimeoutError';
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      };

      try {
        const res = await walletService._persistLedgerRecord(ledgerWallet, snapshot);
        assert.ok(res.transaction);
        assert.strictEqual(res.transaction.opId, 'op_ambig_persisted');
        assert.strictEqual(res.transaction.amount, 40);
      } finally {
        WalletTransaction.create = originalCreate;
      }
    });

    it('3.5 Ambiguous write where verification fails throws explicit 500 with uncertainty metadata', async () => {
      const snapshot = {
        opId: 'op_ambig_uncertain',
        sequence: 1,
        amount: 60,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_ambig_uncertain',
        balanceBefore: 0,
        balanceAfter: 60,
        fingerprint: 'v1:fake_fp',
        fingerprintVersion: 1,
      };

      const originalCreate = WalletTransaction.create.bind(WalletTransaction);
      const originalFindOne = WalletTransaction.findOne.bind(WalletTransaction);

      WalletTransaction.create = async () => {
        const timeoutErr = new Error('socket timed out');
        timeoutErr.name = 'MongoNetworkTimeoutError';
        throw timeoutErr;
      };

      WalletTransaction.findOne = async () => {
        const netErr = new Error('server selection timed out');
        netErr.name = 'MongoServerSelectionError';
        throw netErr;
      };

      try {
        await assert.rejects(
          async () => {
            await walletService._persistLedgerRecord(ledgerWallet, snapshot);
          },
          (err) => {
            assert.strictEqual(err.statusCode, 500);
            assert.strictEqual(err.isAmbiguous, true);
            assert.strictEqual(err.persistenceUncertain, true);
            assert.match(err.message, /Compensation was aborted/);
            assert.ok(err.discrepancy);
            assert.strictEqual(err.discrepancy.opId, 'op_ambig_uncertain');
            return true;
          }
        );
      } finally {
        WalletTransaction.create = originalCreate;
        WalletTransaction.findOne = originalFindOne;
      }
    });
  });

  // =========================================================================
  // SUB-SUITE 4: Exactly-One Snapshot Settlement Guard (_settleUnsettledOperation)
  // =========================================================================
  describe('4. Exactly-One Snapshot Settlement Guard (_settleUnsettledOperation)', () => {
    let settleUser;
    let settleWallet;

    beforeEach(async () => {
      settleUser = new mongoose.Types.ObjectId();
      await Wallet.collection.deleteMany({ userId: settleUser });
      settleWallet = await walletService.getOrCreateWallet(settleUser);
    });

    it('4.1 Exactly removes matching snapshot when opId, sequence, and fingerprint match', async () => {
      const mutation = await walletService._mutateWalletAtomic({
        userId: settleUser,
        amount: 80,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_settle_clean',
        opId: 'op_settle_clean',
        description: 'Settle clean',
        metadata: {},
      });

      assert.strictEqual(mutation.wallet.unsettledOperations.length, 1);

      // Execute settlement
      const settled = await walletService._settleUnsettledOperation(mutation.wallet, mutation.snapshot);
      assert.strictEqual(settled, true);

      // Verify wallet document unsettledOperations is now empty
      const freshWallet = await Wallet.collection.findOne({ _id: mutation.wallet._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 0);
    });

    it('4.2 Rejects settlement if fingerprint verification fails (tampered snapshot)', async () => {
      const mutation = await walletService._mutateWalletAtomic({
        userId: settleUser,
        amount: 80,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_settle_tamper',
        opId: 'op_settle_tamper',
        description: 'Settle tamper',
        metadata: {},
      });

      // Provide tampered fingerprint
      const tamperedSnapshot = {
        ...mutation.snapshot,
        fingerprint: 'v1:0000000000000000000000000000000000000000000000000000000000000000',
      };

      const settled = await walletService._settleUnsettledOperation(mutation.wallet, tamperedSnapshot);
      assert.strictEqual(settled, false, 'Settlement must abort when fingerprint is invalid');

      // Snapshot must NOT be removed from wallet
      const freshWallet = await Wallet.collection.findOne({ _id: mutation.wallet._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 1);
    });

    it('4.3 Rejects settlement if sequence does not match', async () => {
      const mutation = await walletService._mutateWalletAtomic({
        userId: settleUser,
        amount: 80,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_settle_seq',
        opId: 'op_settle_seq',
        description: 'Settle seq',
        metadata: {},
      });

      const wrongSeqSnapshot = {
        ...mutation.snapshot,
        sequence: 999, // Wrong sequence!
      };

      const settled = await walletService._settleUnsettledOperation(mutation.wallet, wrongSeqSnapshot);
      assert.strictEqual(settled, false, 'Settlement must fail when sequence does not match');

      const freshWallet = await Wallet.collection.findOne({ _id: mutation.wallet._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 1);
    });

    it('4.4 Fails closed if duplicate snapshots with identical opId exist ($size === 1 guard)', async () => {
      const opId = 'op_dup_snapshot';
      const fp = generateFingerprint({
        version: 1,
        userId: settleUser,
        walletId: settleWallet._id,
        opId,
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_dup',
        sequence: 1,
        balanceBefore: 0,
        balanceAfter: 50,
      });

      const duplicateSnapshot = {
        opId,
        sequence: 1,
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_dup',
        balanceBefore: 0,
        balanceAfter: 50,
        fingerprint: fp,
        fingerprintVersion: 1,
        createdAt: new Date(),
      };

      // Manually push TWO identical snapshots to simulate anomalous duplicate insertion
      await Wallet.collection.updateOne(
        { _id: settleWallet._id },
        { $push: { unsettledOperations: { $each: [duplicateSnapshot, duplicateSnapshot] } } }
      );

      // Attempt settlement
      const settled = await walletService._settleUnsettledOperation(settleWallet, duplicateSnapshot);
      assert.strictEqual(settled, false, 'Settlement must fail closed (modifiedCount 0) when duplicate snapshots exist');

      // Verify neither snapshot was pulled
      const freshWallet = await Wallet.collection.findOne({ _id: settleWallet._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 2);
    });

    it('4.5 Repeated settlement calls are idempotent (subsequent call returns false cleanly)', async () => {
      const mutation = await walletService._mutateWalletAtomic({
        userId: settleUser,
        amount: 50,
        direction: 'CREDIT',
        type: 'BONUS',
        referenceId: null,
        idempotencyKey: 'idem_settle_repeat',
        opId: 'op_settle_repeat',
        description: 'Settle repeat',
        metadata: {},
      });

      const firstSettle = await walletService._settleUnsettledOperation(mutation.wallet, mutation.snapshot);
      assert.strictEqual(firstSettle, true);

      // Second settlement call on already settled operation
      const secondSettle = await walletService._settleUnsettledOperation(mutation.wallet, mutation.snapshot);
      assert.strictEqual(secondSettle, false, 'Subsequent settlement must return false without throwing');
    });
  });

  // =========================================================================
  // SUB-SUITE 5: Monotonic User.coins Synchronization (_syncUserCoins)
  // =========================================================================
  describe('5. Monotonic User.coins Synchronization (_syncUserCoins)', () => {
    let syncUser;

    beforeEach(async () => {
      await User.deleteMany({ email: 'sync_test_user@example.com' });
      syncUser = await User.create({
        username: `sync_u_${Date.now()}`,
        email: 'sync_test_user@example.com',
        password: 'password123',
        coins: 100,
      });
    });

    it('5.1 Safely synchronizes User.coins when sequence > coinsWalletSequence', async () => {
      const res = await walletService._syncUserCoins(syncUser._id, 250, 5);
      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.matched, true);

      const updatedUser = await User.findById(syncUser._id).lean();
      assert.strictEqual(updatedUser.coins, 250);
      assert.strictEqual(updatedUser.coinsWalletSequence, 5);
    });

    it('5.2 Initializes coinsWalletSequence on legacy user document without sequence field', async () => {
      // Ensure user has no coinsWalletSequence field
      await User.collection.updateOne({ _id: syncUser._id }, { $unset: { coinsWalletSequence: '' } });

      const res = await walletService._syncUserCoins(syncUser._id, 180, 1);
      assert.strictEqual(res.synced, true);

      const updatedUser = await User.findById(syncUser._id).lean();
      assert.strictEqual(updatedUser.coins, 180);
      assert.strictEqual(updatedUser.coinsWalletSequence, 1);
    });

    it('5.3 Stale sequence update is dropped without error and without overwriting newer balance', async () => {
      // Advance user to sequence 10 with balance 500
      await walletService._syncUserCoins(syncUser._id, 500, 10);

      // Delayed/stale sync operation from sequence 8 trying to set balance 400
      const staleRes = await walletService._syncUserCoins(syncUser._id, 400, 8);
      assert.strictEqual(staleRes.synced, false, 'Stale sequence must NOT update user document');
      assert.strictEqual(staleRes.matched, false);

      const userAfter = await User.findById(syncUser._id).lean();
      assert.strictEqual(userAfter.coins, 500, 'Newer coins balance must remain untouched');
      assert.strictEqual(userAfter.coinsWalletSequence, 10);
    });

    it('5.4 Missing User document is handled gracefully without throwing', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await walletService._syncUserCoins(nonExistentId, 100, 1);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.matched, false);
    });
  });

  // =========================================================================
  // SUB-SUITE 6: High-Level End-to-End Financial Operations (credit & debit)
  // =========================================================================
  describe('6. High-Level End-to-End Financial Operations (credit & debit)', () => {
    let e2eUser;

    beforeEach(async () => {
      await User.collection.deleteMany({ email: 'e2e_wallet_test@example.com' });
      e2eUser = await User.create({
        username: `e2e_u_${Date.now()}`,
        email: 'e2e_wallet_test@example.com',
        password: 'password123',
        coins: 100,
      });
      await Wallet.collection.deleteMany({ userId: e2eUser._id });
      await WalletTransaction.collection.deleteMany({ userId: e2eUser._id });
    });

    it('6.1 End-to-end credit executes all 4 stages: mutation, ledger, settlement, sync', async () => {
      const res = await walletService.credit(e2eUser._id, 200, {
        type: 'BONUS',
        idempotencyKey: 'idem_e2e_credit',
        description: 'E2E Bonus credit',
      });

      assert.strictEqual(res.isDuplicate, false);
      assert.strictEqual(res.balanceBefore, 100);
      assert.strictEqual(res.balanceAfter, 300);
      assert.strictEqual(res.wallet.balance, 300);

      // Ledger record persisted
      const tx = await WalletTransaction.findOne({ userId: e2eUser._id, idempotencyKey: 'idem_e2e_credit' });
      assert.ok(tx);
      assert.strictEqual(tx.amount, 200);
      assert.strictEqual(tx.direction, 'CREDIT');

      // Snapshot settled (unsettledOperations empty)
      const freshWallet = await Wallet.findOne({ userId: e2eUser._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 0);

      // User.coins synchronized
      const freshUser = await User.findById(e2eUser._id);
      assert.strictEqual(freshUser.coins, 300);
    });

    it('6.2 End-to-end debit executes all 4 stages: mutation, ledger, settlement, sync', async () => {
      // First credit to 500
      await walletService.credit(e2eUser._id, 400, {
        type: 'BONUS',
        idempotencyKey: 'idem_e2e_prep',
      });

      // Now debit 150
      const res = await walletService.debit(e2eUser._id, 150, {
        type: 'HINT_PURCHASE',
        idempotencyKey: 'idem_e2e_debit',
        description: 'E2E Hint purchase',
      });

      assert.strictEqual(res.isDuplicate, false);
      assert.strictEqual(res.balanceBefore, 500);
      assert.strictEqual(res.balanceAfter, 350);
      assert.strictEqual(res.wallet.balance, 350);

      const tx = await WalletTransaction.findOne({ userId: e2eUser._id, idempotencyKey: 'idem_e2e_debit' });
      assert.ok(tx);
      assert.strictEqual(tx.amount, 150);
      assert.strictEqual(tx.direction, 'DEBIT');

      const freshWallet = await Wallet.findOne({ userId: e2eUser._id });
      assert.strictEqual(freshWallet.unsettledOperations.length, 0);

      const freshUser = await User.findById(e2eUser._id);
      assert.strictEqual(freshUser.coins, 350);
    });

    it('6.3 Fast-path idempotent replay returns existing ledger transaction with isDuplicate: true', async () => {
      const key = `fast_path_${Date.now()}`;

      const res1 = await walletService.credit(e2eUser._id, 75, {
        type: 'LEVEL_REWARD',
        idempotencyKey: key,
      });
      assert.strictEqual(res1.isDuplicate, false);

      const res2 = await walletService.credit(e2eUser._id, 75, {
        type: 'LEVEL_REWARD',
        idempotencyKey: key,
      });
      assert.strictEqual(res2.isDuplicate, true);
      assert.strictEqual(res1.transaction._id.toString(), res2.transaction._id.toString());
      assert.strictEqual(res2.balanceAfter, res1.balanceAfter);

      // Verify no extra ledger entries created
      const count = await WalletTransaction.countDocuments({ userId: e2eUser._id, idempotencyKey: key });
      assert.strictEqual(count, 1);
    });

    it('6.4 Concurrent debit requests with same idempotencyKey resolve cleanly without double-debiting', async () => {
      // Balance is 100 initially
      const concKey = `conc_e2e_debit_${Date.now()}`;

      const [resA, resB] = await Promise.all([
        walletService.debit(e2eUser._id, 40, {
          type: 'UNDO_PURCHASE',
          idempotencyKey: concKey,
        }),
        walletService.debit(e2eUser._id, 40, {
          type: 'UNDO_PURCHASE',
          idempotencyKey: concKey,
        }),
      ]);

      assert.ok(resA && resB);
      const isDups = [resA.isDuplicate, resB.isDuplicate];
      assert.ok(isDups.includes(false), 'One call must be original');
      assert.ok(isDups.includes(true), 'One call must be duplicate');

      // Balance reduced exactly once: 100 - 40 = 60
      const finalWallet = await Wallet.findOne({ userId: e2eUser._id });
      assert.strictEqual(finalWallet.balance, 60);

      const finalUser = await User.findById(e2eUser._id);
      assert.strictEqual(finalUser.coins, 60);
    });

    it('6.5 Concurrent credit requests with same idempotencyKey resolve cleanly without double-crediting', async () => {
      const concKey = `conc_e2e_credit_${Date.now()}`;

      const [resA, resB] = await Promise.all([
        walletService.credit(e2eUser._id, 50, {
          type: 'BONUS',
          idempotencyKey: concKey,
        }),
        walletService.credit(e2eUser._id, 50, {
          type: 'BONUS',
          idempotencyKey: concKey,
        }),
      ]);

      assert.ok(resA && resB);
      const isDups = [resA.isDuplicate, resB.isDuplicate];
      assert.ok(isDups.includes(false));
      assert.ok(isDups.includes(true));

      // Balance increased exactly once: 100 + 50 = 150
      const finalWallet = await Wallet.findOne({ userId: e2eUser._id });
      assert.strictEqual(finalWallet.balance, 150);

      const finalUser = await User.findById(e2eUser._id);
      assert.strictEqual(finalUser.coins, 150);
    });

    it('6.6 Conflicting parameters on same idempotencyKey reject loser with HTTP 409', async () => {
      const conflictKey = `e2e_conflict_${Date.now()}`;

      await walletService.credit(e2eUser._id, 50, {
        type: 'BONUS',
        idempotencyKey: conflictKey,
      });

      // Attempt conflicting debit with same key
      await assert.rejects(
        async () => {
          await walletService.debit(e2eUser._id, 50, {
            type: 'HINT_PURCHASE',
            idempotencyKey: conflictKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.match(err.message, /Idempotency key collision/);
          return true;
        }
      );
    });

    it('6.7 Transaction history pagination and filtering operates accurately', async () => {
      // Create 3 distinct transactions
      await walletService.credit(e2eUser._id, 20, { type: 'BONUS', idempotencyKey: `hist_1_${Date.now()}` });
      await walletService.credit(e2eUser._id, 30, { type: 'LEVEL_REWARD', idempotencyKey: `hist_2_${Date.now()}` });
      await walletService.debit(e2eUser._id, 15, { type: 'HINT_PURCHASE', idempotencyKey: `hist_3_${Date.now()}` });

      const history = await walletService.getTransactionHistory(e2eUser._id, { page: 1, limit: 10 });
      assert.ok(history.transactions.length >= 3);
      assert.strictEqual(history.pagination.page, 1);
      assert.strictEqual(history.pagination.limit, 10);

      // Filter by type
      const hints = await walletService.getTransactionHistory(e2eUser._id, { type: 'HINT_PURCHASE' });
      assert.ok(hints.transactions.every((t) => t.type === 'HINT_PURCHASE'));
    });

    it('6.8 Wallet summary accurately reflects sequence and unsettled count', async () => {
      const summary = await walletService.getWalletSummary(e2eUser._id);
      assert.strictEqual(summary.userId.toString(), e2eUser._id.toString());
      assert.strictEqual(typeof summary.balance, 'number');
      assert.strictEqual(typeof summary.sequence, 'number');
      assert.strictEqual(typeof summary.unsettledCount, 'number');
      assert.strictEqual(summary.currency, 'COIN');
      assert.strictEqual(summary.isActive, true);
    });
  });
});
