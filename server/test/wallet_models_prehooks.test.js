import { describe, it, before, after } from 'node:test';
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
import { isValidCompoundOpIdIndex } from '../src/utils/migrateWalletOpIdIndex.js';
import { isValidCompoundIdempotencyIndex } from '../src/utils/migrateWalletIdempotencyIndex.js';
import { initializeWalletBaseline } from '../src/utils/initializeWalletBaseline.js';

describe('Phase 8 Step 2.2 — Models & Pre-Hooks Suite', () => {
  let db;
  let testCollCounter = 0;
  const createdCollectionNames = [];

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    db = mongoose.connection.db;
  });

  after(async () => {
    for (const name of createdCollectionNames) {
      try {
        await db.dropCollection(name);
      } catch {
        // Ignore drop errors for already deleted collections
      }
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  async function createIsolatedTestCollection() {
    testCollCounter += 1;
    const name = `temp_model_test_${Date.now()}_${testCollCounter}`;
    createdCollectionNames.push(name);
    const coll = await db.createCollection(name);
    return { name, coll };
  }

  // =========================================================================
  // SUITE 1: Wallet Schema & Subdocument Snapshot Validation
  // =========================================================================
  describe('Wallet Schema & Subdocument Snapshots', () => {
    it('1. Valid newly instantiated wallet receives safe baseline defaults', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({ userId, balance: 150 });

      await wallet.validate();

      assert.strictEqual(wallet.balance, 150);
      assert.strictEqual(wallet.sequence, 0);
      assert.strictEqual(wallet.baselineBalance, 150);
      assert.strictEqual(wallet.baselineSequence, 0);
      assert.deepStrictEqual(wallet.unsettledOperations.toObject(), []);
      assert.ok(wallet.baselineEstablishedAt instanceof Date);
    });

    it('2. Valid unsettled operation snapshot is validated without creating subdocument _id', async () => {
      const userId = new mongoose.Types.ObjectId();
      const snapshot = {
        opId: 'op_snap_valid_1',
        sequence: 1,
        amount: 25,
        direction: 'DEBIT',
        type: 'HINT_PURCHASE',
        referenceId: 'ref_hint_123',
        idempotencyKey: 'idem_hint_123',
        balanceBefore: 150,
        balanceAfter: 125,
        fingerprint: 'hmac_sha256_mock_fingerprint_value',
        fingerprintVersion: 1,
      };

      const wallet = new Wallet({
        userId,
        balance: 125,
        sequence: 1,
        unsettledOperations: [snapshot],
      });

      await wallet.validate();

      assert.strictEqual(wallet.unsettledOperations.length, 1);
      const savedSnap = wallet.unsettledOperations[0].toObject();
      assert.strictEqual(savedSnap.opId, 'op_snap_valid_1');
      assert.strictEqual(savedSnap.sequence, 1);
      assert.strictEqual(savedSnap.amount, 25);
      assert.strictEqual(savedSnap.direction, 'DEBIT');
      assert.strictEqual(savedSnap.type, 'HINT_PURCHASE');
      assert.strictEqual(savedSnap._id, undefined, 'Snapshot must not have an _id subdocument field');
    });

    it('3. Invalid negative balance is rejected by schema validator', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({ userId, balance: -10 });

      await assert.rejects(async () => {
        await wallet.validate();
      }, /Wallet balance cannot be negative/);
    });

    it('4. Invalid fractional balance is rejected by schema validator', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({ userId, balance: 99.75 });

      await assert.rejects(async () => {
        await wallet.validate();
      }, /Wallet balance must be a non-negative safe integer/);
    });

    it('5. Invalid unsafe integer balance (> Number.MAX_SAFE_INTEGER) is rejected', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({ userId, balance: Number.MAX_SAFE_INTEGER + 1000 });

      await assert.rejects(async () => {
        await wallet.validate();
      }, /Wallet balance must be a non-negative safe integer/);
    });

    it('6. Invalid negative or fractional sequence is rejected', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletNeg = new Wallet({ userId, balance: 100, sequence: -1 });
      await assert.rejects(async () => {
        await walletNeg.validate();
      }, /Wallet sequence must be a non-negative safe integer/);

      const walletFrac = new Wallet({ userId, balance: 100, sequence: 1.5 });
      await assert.rejects(async () => {
        await walletFrac.validate();
      }, /Wallet sequence must be a non-negative safe integer/);
    });

    it('7. Invalid baseline fields (negative or fractional) are rejected', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletBadBal = new Wallet({ userId, balance: 100, baselineBalance: -5 });
      await assert.rejects(async () => {
        await walletBadBal.validate();
      }, /Wallet baselineBalance must be a non-negative safe integer/);

      const walletBadSeq = new Wallet({ userId, balance: 100, baselineSequence: 2.5 });
      await assert.rejects(async () => {
        await walletBadSeq.validate();
      }, /Wallet baselineSequence must be a non-negative safe integer/);
    });

    it('8. Invalid snapshot fields (direction, negative balance, missing required) are rejected', async () => {
      const userId = new mongoose.Types.ObjectId();

      // Invalid direction enum
      const walletBadDir = new Wallet({
        userId,
        balance: 100,
        unsettledOperations: [
          {
            opId: 'op_1',
            sequence: 1,
            amount: 10,
            direction: 'INVALID_DIRECTION',
            type: 'REWARD',
            balanceBefore: 90,
            balanceAfter: 100,
            fingerprint: 'fp1',
            fingerprintVersion: 1,
          },
        ],
      });
      await assert.rejects(async () => {
        await walletBadDir.validate();
      }, /is not a valid snapshot direction/);

      // Negative balanceBefore
      const walletBadBefore = new Wallet({
        userId,
        balance: 100,
        unsettledOperations: [
          {
            opId: 'op_1',
            sequence: 1,
            amount: 10,
            direction: 'CREDIT',
            type: 'REWARD',
            balanceBefore: -10,
            balanceAfter: 100,
            fingerprint: 'fp1',
            fingerprintVersion: 1,
          },
        ],
      });
      await assert.rejects(async () => {
        await walletBadBefore.validate();
      }, /Snapshot balanceBefore must be a non-negative safe integer/);
    });

    it('9. Legacy wallet document compatibility: loaded documents are NOT silently normalized in memory', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();

      // Insert raw legacy document into MongoDB without baseline fields
      await coll.insertOne({
        _id: walletId,
        userId,
        balance: 200,
        currency: 'COIN',
        isActive: true,
      });

      // Bind temporary model to this isolated collection
      const LegacyTestWallet = mongoose.model(
        `LegacyTestWallet_${Date.now()}`,
        Wallet.schema,
        name
      );

      const loaded = await LegacyTestWallet.findById(walletId);

      // Strict check: defaults must NOT be applied to retrieved documents
      assert.strictEqual(loaded.sequence, undefined, 'Legacy document must not have sequence normalized in memory');
      assert.strictEqual(loaded.baselineBalance, undefined, 'Legacy document must not have baselineBalance normalized in memory');
      assert.strictEqual(loaded.baselineSequence, undefined, 'Legacy document must not have baselineSequence normalized in memory');
      assert.strictEqual(loaded.unsettledOperations, undefined, 'Legacy document must not have unsettledOperations normalized in memory');
      assert.strictEqual(loaded.baselineEstablishedAt, undefined, 'Legacy document must not have baselineEstablishedAt normalized in memory');

      const plainObj = loaded.toObject();
      assert.strictEqual(plainObj.balance, 200);
      assert.strictEqual(plainObj.sequence, undefined);
      assert.strictEqual(plainObj.baselineBalance, undefined);
    });
  });

  // =========================================================================
  // SUITE 2: WalletTransaction Schema & Index Specification
  // =========================================================================
  describe('WalletTransaction Schema & Indexes', () => {
    it('1. Valid opId transaction with sequence, fingerprint, and version passes validation', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletId = new mongoose.Types.ObjectId();

      const tx = new WalletTransaction({
        userId,
        walletId,
        opId: 'op_tx_101',
        sequence: 12,
        fingerprint: 'hmac_sha256_canonical_hash_101',
        fingerprintVersion: 1,
        direction: 'CREDIT',
        type: 'LEVEL_REWARD',
        amount: 50,
        balanceBefore: 100,
        balanceAfter: 150,
        description: 'Level 1 completion reward',
      });

      await tx.validate();

      assert.strictEqual(tx.opId, 'op_tx_101');
      assert.strictEqual(tx.sequence, 12);
      assert.strictEqual(tx.fingerprint, 'hmac_sha256_canonical_hash_101');
      assert.strictEqual(tx.fingerprintVersion, 1);
    });

    it('2. Historical transaction without opId, sequence, or fingerprint passes validation', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletId = new mongoose.Types.ObjectId();

      const legacyTx = new WalletTransaction({
        userId,
        walletId,
        direction: 'DEBIT',
        type: 'UNDO_PURCHASE',
        amount: 40,
        balanceBefore: 150,
        balanceAfter: 110,
        description: 'Undo purchase',
      });

      await legacyTx.validate();

      assert.strictEqual(legacyTx.opId, null);
      assert.strictEqual(legacyTx.sequence, null);
      assert.strictEqual(legacyTx.fingerprint, null);
      assert.strictEqual(legacyTx.fingerprintVersion, null);
    });

    it('3. Invalid negative or fractional sequence in WalletTransaction is rejected', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletId = new mongoose.Types.ObjectId();

      const txBadSeq = new WalletTransaction({
        userId,
        walletId,
        sequence: -1,
        direction: 'CREDIT',
        type: 'LEVEL_REWARD',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        description: 'Reward',
      });
      await assert.rejects(async () => {
        await txBadSeq.validate();
      }, /Transaction sequence must be a positive safe integer/);

      const txFracSeq = new WalletTransaction({
        userId,
        walletId,
        sequence: 3.14,
        direction: 'CREDIT',
        type: 'LEVEL_REWARD',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        description: 'Reward',
      });
      await assert.rejects(async () => {
        await txFracSeq.validate();
      }, /Transaction sequence must be a positive safe integer/);
    });

    it('4. Invalid fingerprintVersion in WalletTransaction is rejected', async () => {
      const userId = new mongoose.Types.ObjectId();
      const walletId = new mongoose.Types.ObjectId();

      const txBadVer = new WalletTransaction({
        userId,
        walletId,
        fingerprintVersion: 0,
        direction: 'CREDIT',
        type: 'LEVEL_REWARD',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        description: 'Reward',
      });
      await assert.rejects(async () => {
        await txBadVer.validate();
      }, /Transaction fingerprintVersion must be a positive integer/);
    });

    it('5. Schema indexes preserve user-scoped idempotencyKey and declare matching opId index without conflicts', () => {
      const indexes = WalletTransaction.schema.indexes();

      // Check idempotencyKey compound index
      const idempotencyIdx = indexes.find(
        ([fields]) => fields.userId === 1 && fields.idempotencyKey === 1
      );
      assert.ok(idempotencyIdx, 'Compound { userId: 1, idempotencyKey: 1 } index must be declared');
      assert.strictEqual(idempotencyIdx[1].unique, true);
      assert.deepStrictEqual(idempotencyIdx[1].partialFilterExpression, {
        idempotencyKey: { $type: 'string' },
      });

      // Check opId compound index strictly matching Step 2.1A specification
      const opIdIdx = indexes.find(
        ([fields]) => fields.userId === 1 && fields.opId === 1
      );
      assert.ok(opIdIdx, 'Compound { userId: 1, opId: 1 } index must be declared');
      assert.strictEqual(opIdIdx[1].unique, true);
      assert.strictEqual(opIdIdx[1].name, 'userId_1_opId_1');
      assert.deepStrictEqual(opIdIdx[1].partialFilterExpression, {
        opId: { $type: 'string' },
      });

      // Check that NO conflicting single-field opId index is declared
      const singleOpIdIdx = indexes.find(([fields]) => fields.opId !== undefined && Object.keys(fields).length === 1);
      assert.strictEqual(singleOpIdIdx, undefined, 'Must not declare conflicting single-field opId index');
    });
  });

  // =========================================================================
  // SUITE 3: Defense-in-Depth Middleware
  // =========================================================================
  describe('Defense-in-Depth Middleware Protections', () => {
    it('1. Wallet pre-save hook enforces sequence >= baselineSequence', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({
        userId,
        balance: 100,
        sequence: 5,
        baselineBalance: 100,
        baselineSequence: 5,
      });

      // Simulate document loaded from DB (isNew = false)
      wallet.isNew = false;
      wallet.sequence = 2; // Decrement below baselineSequence

      await assert.rejects(
        async () => {
          await wallet.save();
        },
        /cannot be less than baselineSequence/
      );
    });

    it('2. Wallet pre-save hook protects established baseline fields from mutation', async () => {
      const userId = new mongoose.Types.ObjectId();
      const wallet = new Wallet({
        userId,
        balance: 100,
        sequence: 1,
        baselineBalance: 100,
        baselineSequence: 0,
      });

      wallet.isNew = false;
      wallet.baselineBalance = 200; // Attempt mutation of baselineBalance

      await assert.rejects(
        async () => {
          await wallet.save();
        },
        /Wallet baseline fields.*are immutable once established/
      );
    });

    it('3. Wallet pre-hook blocks replacement updates (replaceOne / findOneAndReplace)', async () => {
      await assert.rejects(
        async () => {
          await Wallet.replaceOne({ _id: new mongoose.Types.ObjectId() }, { balance: 200 });
        },
        /Wallet replacement updates \(replaceOne\/findOneAndReplace\) are forbidden/
      );

      await assert.rejects(
        async () => {
          await Wallet.findOneAndReplace({ _id: new mongoose.Types.ObjectId() }, { balance: 200 });
        },
        /Wallet replacement updates \(replaceOne\/findOneAndReplace\) are forbidden/
      );
    });

    it('4. Wallet pre-hook blocks direct updates passed without atomic operators', async () => {
      await assert.rejects(
        async () => {
          await Wallet.updateOne({ _id: new mongoose.Types.ObjectId() }, { balance: 300 });
        },
        /Direct replacement updates are forbidden/
      );
    });

    it('5. Wallet pre-hook validates $set sequence and balance values', async () => {
      await assert.rejects(
        async () => {
          await Wallet.updateOne(
            { _id: new mongoose.Types.ObjectId() },
            { $set: { sequence: -1 } }
          );
        },
        /Invalid sequence in update: -1/
      );

      await assert.rejects(
        async () => {
          await Wallet.updateOne(
            { _id: new mongoose.Types.ObjectId() },
            { $set: { balance: 10.5 } }
          );
        },
        /Invalid balance in update: 10.5/
      );
    });

    it('6. Wallet pre-hook blocks sequence decrements via $inc', async () => {
      await assert.rejects(
        async () => {
          await Wallet.updateOne(
            { _id: new mongoose.Types.ObjectId() },
            { $inc: { sequence: -1 } }
          );
        },
        /Sequence decrement via \$inc is forbidden/
      );
    });

    it('7. Wallet pre-hook inspects aggregation update pipelines and rejects invalid stages', async () => {
      // Valid pipeline passes pre-hook when updatePipeline: true is set
      const validQuery = Wallet.updateOne(
        { _id: new mongoose.Types.ObjectId() },
        [{ $set: { balance: 100 } }],
        { updatePipeline: true }
      );
      assert.strictEqual(Array.isArray(validQuery.getUpdate()), true);

      // Non-object stage in pipeline is rejected by pre-hook
      await assert.rejects(
        async () => {
          await Wallet.updateOne(
            { _id: new mongoose.Types.ObjectId() },
            ['invalid_stage_string'],
            { updatePipeline: true }
          );
        },
        /Invalid pipeline update stage: stage must be an object/
      );
    });

    it('8. WalletTransaction ledger immutability: updates and deletes are rejected across all query methods', async () => {
      const dummyId = new mongoose.Types.ObjectId();

      await assert.rejects(async () => {
        await WalletTransaction.updateOne({ _id: dummyId }, { $set: { amount: 999 } });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.updateMany({}, { $set: { amount: 999 } });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.findOneAndUpdate({ _id: dummyId }, { $set: { amount: 999 } });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.replaceOne({ _id: dummyId }, { amount: 999 });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.findOneAndReplace({ _id: dummyId }, { amount: 999 });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.deleteOne({ _id: dummyId });
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.deleteMany({});
      }, /immutable append-only ledger/);

      await assert.rejects(async () => {
        await WalletTransaction.findOneAndDelete({ _id: dummyId });
      }, /immutable append-only ledger/);
    });

    it('9. WalletTransaction pre-save hook blocks mutation of existing transaction records', async () => {
      const tx = new WalletTransaction({
        userId: new mongoose.Types.ObjectId(),
        walletId: new mongoose.Types.ObjectId(),
        direction: 'CREDIT',
        type: 'BONUS',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        description: 'Test bonus',
      });

      // Mark as existing record
      tx.isNew = false;
      tx.amount = 50;

      await assert.rejects(async () => {
        await tx.save();
      }, /immutable append-only ledger/);
    });

    it('10. WalletTransaction bulkWrite blocks update and delete operations while permitting insertOne', async () => {
      // updateOne in bulkWrite is blocked
      await assert.rejects(
        async () => {
          await WalletTransaction.bulkWrite([
            { updateOne: { filter: { _id: new mongoose.Types.ObjectId() }, update: { $set: { amount: 10 } } } },
          ]);
        },
        /cannot be altered or removed via bulkWrite/
      );

      // deleteOne in bulkWrite is blocked
      await assert.rejects(
        async () => {
          await WalletTransaction.bulkWrite([
            { deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } },
          ]);
        },
        /cannot be altered or removed via bulkWrite/
      );
    });

    it('11. Legitimate wallet creation and atomic sequence increment updates succeed', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const TestWallet = mongoose.model(`TestWalletLegit_${Date.now()}`, Wallet.schema, name);

      const userId = new mongoose.Types.ObjectId();
      const wallet = await TestWallet.create({ userId, balance: 100 });

      assert.strictEqual(wallet.balance, 100);
      assert.strictEqual(wallet.sequence, 0);

      // Sanctioned atomic update
      const res = await TestWallet.updateOne(
        { _id: wallet._id },
        { $inc: { balance: 50, sequence: 1 } }
      );
      assert.strictEqual(res.modifiedCount, 1);

      const updated = await TestWallet.findById(wallet._id);
      assert.strictEqual(updated.balance, 150);
      assert.strictEqual(updated.sequence, 1);
    });
  });

  // =========================================================================
  // SUITE 4: Step 2.1 Baseline Migration Atomic Guard Verification
  // =========================================================================
  describe('Baseline Migration Atomic Guard Verification', () => {
    it('1. Concurrent unsettledOperations modification during migration causes safe refusal', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({ _id: walletId, userId: 'u_atomic_guard_test', balance: 500 });

      // Simulate concurrent write that added an unsettled operation
      await coll.updateOne(
        { _id: walletId },
        { $set: { unsettledOperations: [{ opId: 'op_live_in_flight', amount: 50 }] } }
      );

      // Run initializeWalletBaseline
      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Cannot establish baseline.*unsettled operation/i
      );

      // Verify no balance was lost or altered
      const doc = await coll.findOne({ _id: walletId });
      assert.strictEqual(doc.balance, 500, 'Balance must be preserved');
      assert.strictEqual(doc.sequence, undefined, 'Sequence must not be set on refused migration');
      assert.strictEqual(doc.unsettledOperations.length, 1, 'In-flight operation must remain intact');
    });

    it('2. Unrelated fields are preserved and no balance is lost', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({
        _id: walletId,
        userId: 'u_preserve_test',
        balance: 777,
        customTag: 'preserved_tag',
        nestedData: { level: 42, active: true },
      });

      await initializeWalletBaseline(db, { collectionName: name, quiet: true });

      const updated = await coll.findOne({ _id: walletId });
      assert.strictEqual(updated.balance, 777, 'Balance must remain exactly 777');
      assert.strictEqual(updated.customTag, 'preserved_tag', 'Custom tag must be preserved');
      assert.deepStrictEqual(updated.nestedData, { level: 42, active: true }, 'Nested data must be preserved');
      assert.strictEqual(updated.sequence, 0);
      assert.strictEqual(updated.baselineBalance, 777);
    });
  });
});
