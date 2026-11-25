import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const {
  migrateWalletIdempotencyIndex,
  isValidCompoundIdempotencyIndex,
  isObsoleteGlobalIdempotencyIndex,
  hasIdempotencyKeyField,
} = await import('../src/utils/migrateWalletIdempotencyIndex.js');

const {
  migrateWalletOpIdIndex,
  isValidCompoundOpIdIndex,
  hasOpIdField,
  findConflictingOpIdIndexes,
  findDuplicateHistoricalOpIdRecords,
} = await import('../src/utils/migrateWalletOpIdIndex.js');

const {
  initializeWalletBaseline,
  classifyWalletState,
  isLegacyUninitialized,
  isFullyInitialized,
  isCorruptedWallet,
} = await import('../src/utils/initializeWalletBaseline.js');

describe('Wallet Migrations & Test Harness Suite', () => {
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
    // Scoped cleanup: drop exclusively the temporary test collections created during this suite
    for (const name of createdCollectionNames) {
      try {
        await db.dropCollection(name);
      } catch {
        // Ignore drop error if collection does not exist
      }
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // Helper to create an isolated temporary collection for each scenario
  async function createIsolatedTestCollection() {
    testCollCounter += 1;
    const name = `temp_migration_test_${Date.now()}_${testCollCounter}`;
    createdCollectionNames.push(name);
    const coll = await db.createCollection(name);
    return { name, coll };
  }

  // =========================================================================
  // SUITE 1: User-Scoped Idempotency Key Index Migration (Preserved)
  // =========================================================================
  describe('Wallet Idempotency Key Index Migration', () => {
    it('1. Correct compound index already exists: no unnecessary creation or removal', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Create the correct compound index upfront
      await coll.createIndex(
        { userId: 1, idempotencyKey: 1 },
        {
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
          name: 'userId_1_idempotencyKey_1',
        }
      );

      const initialIndexes = await coll.indexes();
      const result = await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });

      assert.strictEqual(result.migrated, false, 'Should report migrated: false');
      assert.strictEqual(result.newIndexCreated, false, 'Should not create new index');
      assert.strictEqual(result.oldIndexDropped, false, 'Should not drop any index');

      const finalIndexes = await coll.indexes();
      assert.strictEqual(finalIndexes.length, initialIndexes.length);
      assert.ok(finalIndexes.some(isValidCompoundIdempotencyIndex));
    });

    it('2. Compound index with wrong uniqueness is rejected and old global index is preserved', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up a compound index that is NOT unique
      await coll.createIndex(
        { userId: 1, idempotencyKey: 1 },
        {
          unique: false,
          name: 'userId_1_idempotencyKey_1',
        }
      );

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
    });

    it('3. Compound index with incorrect partial filter is rejected and old global index is preserved', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up a compound index with wrong partial filter
      await coll.createIndex(
        { userId: 1, idempotencyKey: 1 },
        {
          unique: true,
          partialFilterExpression: { idempotencyKey: { $exists: true } },
          name: 'userId_1_idempotencyKey_1',
        }
      );

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
    });

    it('4. Correct index creation followed by verified old-index removal', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      const result = await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });

      assert.strictEqual(result.migrated, true, 'Should report migrated: true');
      assert.strictEqual(result.newIndexCreated, true, 'Should create new index');
      assert.strictEqual(result.oldIndexDropped, true, 'Should drop old index');

      const finalIndexes = await coll.indexes();
      assert.ok(finalIndexes.some(isValidCompoundIdempotencyIndex), 'New compound index must exist');
      assert.ok(!finalIndexes.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be removed');
    });

    it('5. Compound index creation failure: old global index remains untouched', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      const originalDbCollection = db.collection.bind(db);
      db.collection = (cName) => {
        const c = originalDbCollection(cName);
        if (cName === name) {
          c.createIndex = async () => {
            throw new Error('Simulated IO or lock timeout error during createIndex');
          };
        }
        return c;
      };

      try {
        await assert.rejects(
          async () => {
            await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
          },
          /Migration aborted: Failed to create required compound unique partial index.*Simulated IO or lock timeout error/
        );
      } finally {
        db.collection = originalDbCollection;
      }

      // Crucial: Old global index was preserved and NOT dropped
      const indexesAfter = await coll.indexes();
      const oldIndexStillPresent = indexesAfter.some((i) => i.name === 'idempotencyKey_1');
      assert.strictEqual(oldIndexStillPresent, true, 'Old global index must remain untouched when creation fails');
    });

    it('6. Index verification failure: old global index remains untouched', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      const originalDbCollection = db.collection.bind(db);
      let dropCalled = false;
      db.collection = (cName) => {
        const c = originalDbCollection(cName);
        if (cName === name) {
          const origIndexes = c.indexes.bind(c);
          let callCount = 0;
          c.indexes = async () => {
            const idxs = await origIndexes();
            callCount += 1;
            if (callCount === 2) {
              // Post-creation check: simulate index returned without required partialFilterExpression
              return idxs.map((i) =>
                i.name === 'userId_1_idempotencyKey_1'
                  ? { ...i, partialFilterExpression: undefined }
                  : i
              );
            }
            return idxs;
          };

          const origDrop = c.dropIndex.bind(c);
          c.dropIndex = async (...args) => {
            dropCalled = true;
            return origDrop(...args);
          };
        }
        return c;
      };

      try {
        await assert.rejects(
          async () => {
            await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
          },
          /Migration aborted: Compound index creation appeared to succeed, but post-creation verification failed/
        );
      } finally {
        db.collection = originalDbCollection;
      }

      assert.strictEqual(dropCalled, false, 'dropIndex must NEVER be called if post-creation verification fails');

      // Verify old global index was preserved
      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
    });

    it('7. Repeated migration execution is safe (idempotent)', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // First run: creates compound index, drops old index
      const run1 = await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run1.migrated, true);
      assert.strictEqual(run1.newIndexCreated, true);
      assert.strictEqual(run1.oldIndexDropped, true);

      // Second run: no-op, reports migrated: false
      const run2 = await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run2.migrated, false);
      assert.strictEqual(run2.newIndexCreated, false);
      assert.strictEqual(run2.oldIndexDropped, false);

      // Third run: verify it remains strictly stable
      const run3 = await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run3.migrated, false);

      const finalIndexes = await coll.indexes();
      assert.ok(finalIndexes.some(isValidCompoundIdempotencyIndex));
      assert.ok(!finalIndexes.some((i) => i.name === 'idempotencyKey_1'));
    });

    it('8. Unexpected index configuration aborts safely without dropping indexes', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up an unexpected index on idempotencyKey (e.g. non-unique single field)
      await coll.createIndex({ idempotencyKey: 1 }, { unique: false, name: 'idempotencyKey_non_unique' });

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_non_unique'), 'Unexpected index must be preserved');
    });

    it('9. Unexpected multi-field index containing idempotencyKey aborts safely', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up a 3-field compound index
      await coll.createIndex(
        { userId: 1, idempotencyKey: 1, extraField: 1 },
        { name: 'userId_1_idempotencyKey_1_extraField_1' }
      );

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
      assert.ok(indexesAfter.some((i) => i.name === 'userId_1_idempotencyKey_1_extraField_1'), 'Unexpected index must be preserved');
    });

    it('10. Unexpected reverse direction index { idempotencyKey: -1 } aborts and preserves old global index', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up reversed single-field index
      await coll.createIndex({ idempotencyKey: -1 }, { name: 'idempotencyKey_-1' });

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_-1'), 'Reversed index must be preserved');
    });

    it('11. Unexpected mixed-direction compound index { userId: 1, idempotencyKey: -1 } aborts and preserves old index', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up mixed-direction compound index
      await coll.createIndex({ userId: 1, idempotencyKey: -1 }, { name: 'userId_1_idempotencyKey_-1' });

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
      assert.ok(indexesAfter.some((i) => i.name === 'userId_1_idempotencyKey_-1'), 'Mixed-direction index must be preserved');
    });

    it('12. Unexpected reversed-order or mixed leading index { otherField: 1, idempotencyKey: 1 } aborts and preserves old index', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Set up old global index
      await coll.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' });

      // Set up compound index with unexpected leading field
      await coll.createIndex({ otherField: 1, idempotencyKey: 1 }, { name: 'otherField_1_idempotencyKey_1' });

      await assert.rejects(
        async () => {
          await migrateWalletIdempotencyIndex(db, { collectionName: name, quiet: true });
        },
        /Migration aborted: Found unexpected or malformed index\(es\) containing "idempotencyKey"/
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'idempotencyKey_1'), 'Old global index must be preserved');
      assert.ok(indexesAfter.some((i) => i.name === 'otherField_1_idempotencyKey_1'), 'Unexpected leading index must be preserved');
    });

    it('13. Unit tests: hasIdempotencyKeyField accurately detects key membership across directions and representations', () => {
      assert.strictEqual(hasIdempotencyKeyField(null), false);
      assert.strictEqual(hasIdempotencyKeyField({}), false);
      assert.strictEqual(hasIdempotencyKeyField({ key: null }), false);
      assert.strictEqual(hasIdempotencyKeyField({ key: { userId: 1 } }), false);

      // Truthy and non-truthy representations
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: 1 } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: -1 } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: 0 } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: 'text' } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: 'hashed' } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { userId: 1, idempotencyKey: -1 } }), true);
      assert.strictEqual(hasIdempotencyKeyField({ key: { idempotencyKey: null } }), true);
    });
  });

  // =========================================================================
  // SUITE 2: User-Scoped opId Compound Unique Index Migration (Step 2.1A)
  // =========================================================================
  describe('Wallet opId Compound Unique Index Migration', () => {
    it('1. Correct compound index is created when safe', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Insert clean records with and without opId
      await coll.insertMany([
        { userId: 'user_A', opId: 'op_101', amount: 100 },
        { userId: 'user_B', opId: 'op_101', amount: 50 }, // Different user, same opId is valid in user-scoped index
        { userId: 'user_A', amount: 25 }, // Legacy record without opId
      ]);

      const result = await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });

      assert.strictEqual(result.migrated, true, 'Should report migrated: true');
      assert.strictEqual(result.newIndexCreated, true, 'Should report newIndexCreated: true');
      assert.strictEqual(result.alreadyExists, false, 'Should report alreadyExists: false');

      const indexes = await coll.indexes();
      const validIdx = indexes.find(isValidCompoundOpIdIndex);
      assert.ok(validIdx, 'Valid user-scoped compound opId index must exist');
      assert.strictEqual(validIdx.name, 'userId_1_opId_1');
      assert.strictEqual(validIdx.unique, true);
      assert.deepStrictEqual(validIdx.partialFilterExpression, { opId: { $type: 'string' } });
    });

    it('2. Migration reruns safely (idempotent)', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'user_A', opId: 'op_initial' });

      // First run: creates index
      const run1 = await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run1.migrated, true);
      assert.strictEqual(run1.newIndexCreated, true);

      // Second run: no-op, reports alreadyExists
      const run2 = await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run2.migrated, false);
      assert.strictEqual(run2.alreadyExists, true);
      assert.strictEqual(run2.newIndexCreated, false);

      // Third run: verify strict stability
      const run3 = await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
      assert.strictEqual(run3.migrated, false);
      assert.strictEqual(run3.alreadyExists, true);
    });

    it('3. Existing compatible index is handled correctly without recreation or drop', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Pre-create the exact valid index
      await coll.createIndex(
        { userId: 1, opId: 1 },
        {
          unique: true,
          partialFilterExpression: { opId: { $type: 'string' } },
          name: 'userId_1_opId_1',
        }
      );

      const initialIndexes = await coll.indexes();
      const result = await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });

      assert.strictEqual(result.migrated, false);
      assert.strictEqual(result.alreadyExists, true);
      assert.strictEqual(result.newIndexCreated, false);

      const finalIndexes = await coll.indexes();
      assert.strictEqual(finalIndexes.length, initialIndexes.length);
      assert.ok(finalIndexes.some(isValidCompoundOpIdIndex));
    });

    it('4. Duplicate historical opId records are detected and migration is refused', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Insert duplicate (userId, opId) records for the same user
      await coll.insertMany([
        { userId: 'user_A', opId: 'duplicate_op_123', amount: 100 },
        { userId: 'user_A', opId: 'duplicate_op_123', amount: 200 },
      ]);

      await assert.rejects(
        async () => {
          await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
        },
        /duplicate.*historical record/i
      );

      const indexes = await coll.indexes();
      assert.ok(!indexes.some(isValidCompoundOpIdIndex), 'Index must not be created on duplicate records');
    });

    it('5. Conflicting index configuration causes refusal without modifying indexes', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      // Create a conflicting single-field global opId index
      await coll.createIndex({ opId: 1 }, { unique: true, name: 'opId_1' });

      await assert.rejects(
        async () => {
          await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
        },
        /conflicting or malformed index/i
      );

      const indexesAfter = await coll.indexes();
      assert.ok(indexesAfter.some((i) => i.name === 'opId_1'), 'Conflicting index must be preserved intact');
      assert.ok(!indexesAfter.some(isValidCompoundOpIdIndex), 'Compound index must not be created');
    });

    it('6. Duplicate records are preserved; no financial records are deleted', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const doc1Id = new mongoose.Types.ObjectId();
      const doc2Id = new mongoose.Types.ObjectId();
      const doc3Id = new mongoose.Types.ObjectId();

      await coll.insertMany([
        { _id: doc1Id, userId: 'user_X', opId: 'dup_op', amount: 100 },
        { _id: doc2Id, userId: 'user_X', opId: 'dup_op', amount: 200 },
        { _id: doc3Id, userId: 'user_Y', opId: 'unique_op', amount: 300 },
      ]);

      await assert.rejects(
        async () => {
          await migrateWalletOpIdIndex(db, { collectionName: name, quiet: true });
        },
        /duplicate.*historical record/i
      );

      const remainingDocs = await coll.find().toArray();
      assert.strictEqual(remainingDocs.length, 3, 'All 3 financial records must remain completely intact');
      assert.strictEqual(
        remainingDocs.find((d) => d._id.equals(doc1Id)).amount,
        100
      );
      assert.strictEqual(
        remainingDocs.find((d) => d._id.equals(doc2Id)).amount,
        200
      );
      assert.strictEqual(
        remainingDocs.find((d) => d._id.equals(doc3Id)).amount,
        300
      );
    });

    it('7. Dry-run mode reports planned action without modifying indexes', async () => {
      const { name, coll } = await createIsolatedTestCollection();

      const report = await migrateWalletOpIdIndex(db, { collectionName: name, dryRun: true, quiet: true });

      assert.strictEqual(report.dryRun, true);
      assert.strictEqual(report.migrated, false);
      assert.strictEqual(report.alreadyExists, false);
      assert.strictEqual(report.plannedAction, 'CREATE_UNIQUE_COMPOUND_INDEX');

      const indexes = await coll.indexes();
      assert.ok(!indexes.some(isValidCompoundOpIdIndex), 'Index must not be created during dryRun');
    });

    it('8. Unit tests: helper functions validate opId index properties', () => {
      assert.strictEqual(hasOpIdField(null), false);
      assert.strictEqual(hasOpIdField({}), false);
      assert.strictEqual(hasOpIdField({ key: null }), false);
      assert.strictEqual(hasOpIdField({ key: { userId: 1 } }), false);
      assert.strictEqual(hasOpIdField({ key: { opId: 1 } }), true);
      assert.strictEqual(hasOpIdField({ key: { opId: -1 } }), true);
      assert.strictEqual(hasOpIdField({ key: { userId: 1, opId: 1 } }), true);

      // Valid index specification
      assert.strictEqual(
        isValidCompoundOpIdIndex({
          key: { userId: 1, opId: 1 },
          unique: true,
          partialFilterExpression: { opId: { $type: 'string' } },
        }),
        true
      );

      // Inverted field order is invalid
      assert.strictEqual(
        isValidCompoundOpIdIndex({
          key: { opId: 1, userId: 1 },
          unique: true,
          partialFilterExpression: { opId: { $type: 'string' } },
        }),
        false
      );

      // Missing uniqueness is invalid
      assert.strictEqual(
        isValidCompoundOpIdIndex({
          key: { userId: 1, opId: 1 },
          unique: false,
          partialFilterExpression: { opId: { $type: 'string' } },
        }),
        false
      );

      // Wrong partial filter expression is invalid
      assert.strictEqual(
        isValidCompoundOpIdIndex({
          key: { userId: 1, opId: 1 },
          unique: true,
          partialFilterExpression: { opId: { $exists: true } },
        }),
        false
      );

      // Conflicting indexes detection
      const testIndexes = [
        { name: '_id_', key: { _id: 1 } },
        { name: 'opId_1', key: { opId: 1 }, unique: true }, // conflicting
        {
          name: 'userId_1_opId_1',
          key: { userId: 1, opId: 1 },
          unique: true,
          partialFilterExpression: { opId: { $type: 'string' } },
        }, // valid
      ];
      const conflicts = findConflictingOpIdIndexes(testIndexes);
      assert.strictEqual(conflicts.length, 1);
      assert.strictEqual(conflicts[0].name, 'opId_1');
    });
  });

  // =========================================================================
  // SUITE 3: Conservative Wallet Baseline Migration (Step 2.1B)
  // =========================================================================
  describe('Conservative Wallet Baseline Migration', () => {
    it('1. Clean legacy wallet initializes correctly with baseline fields', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({ _id: walletId, userId: 'user_legacy_1', balance: 500 });

      const result = await initializeWalletBaseline(db, { collectionName: name, quiet: true });

      assert.strictEqual(result.migrated, true);
      assert.strictEqual(result.initializedCount, 1);
      assert.strictEqual(result.alreadyInitialized, 0);
      assert.strictEqual(result.concurrencyConflicts, 0);

      const updated = await coll.findOne({ _id: walletId });
      assert.strictEqual(updated.balance, 500, 'Current balance must be preserved');
      assert.strictEqual(updated.sequence, 0, 'Sequence must be initialized to 0');
      assert.strictEqual(updated.baselineBalance, 500, 'Baseline balance must match frozen historical balance');
      assert.strictEqual(updated.baselineSequence, 0, 'Baseline sequence must be initialized to 0');
      assert.deepStrictEqual(updated.unsettledOperations, [], 'Unsettled operations must be initialized to empty array');
      assert.ok(updated.baselineEstablishedAt instanceof Date, 'Baseline timestamp must be set');
    });

    it('2. Balance is preserved across distinct wallet balances', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertMany([
        { userId: 'u_zero', balance: 0 },
        { userId: 'u_modest', balance: 1250 },
        { userId: 'u_large', balance: 999999 },
      ]);

      await initializeWalletBaseline(db, { collectionName: name, quiet: true });

      const w0 = await coll.findOne({ userId: 'u_zero' });
      const wModest = await coll.findOne({ userId: 'u_modest' });
      const wLarge = await coll.findOne({ userId: 'u_large' });

      assert.strictEqual(w0.balance, 0);
      assert.strictEqual(w0.baselineBalance, 0);
      assert.strictEqual(wModest.balance, 1250);
      assert.strictEqual(wModest.baselineBalance, 1250);
      assert.strictEqual(wLarge.balance, 999999);
      assert.strictEqual(wLarge.baselineBalance, 999999);
    });

    it('3. Baseline fields are set correctly', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const beforeTime = new Date();
      await coll.insertOne({ userId: 'u_test', balance: 42 });

      await initializeWalletBaseline(db, { collectionName: name, quiet: true });

      const doc = await coll.findOne({ userId: 'u_test' });
      assert.strictEqual(doc.sequence, 0);
      assert.strictEqual(doc.baselineBalance, 42);
      assert.strictEqual(doc.baselineSequence, 0);
      assert.ok(Array.isArray(doc.unsettledOperations));
      assert.strictEqual(doc.unsettledOperations.length, 0);
      assert.ok(doc.baselineEstablishedAt >= beforeTime);
    });

    it('4. Migration reruns safely without re-initializing or altering baselines', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_rerun', balance: 300 });

      const first = await initializeWalletBaseline(db, { collectionName: name, quiet: true });
      assert.strictEqual(first.migrated, true);
      assert.strictEqual(first.initializedCount, 1);

      const docAfterFirst = await coll.findOne({ userId: 'u_rerun' });

      const second = await initializeWalletBaseline(db, { collectionName: name, quiet: true });
      assert.strictEqual(second.migrated, false);
      assert.strictEqual(second.initializedCount, 0);
      assert.strictEqual(second.alreadyInitialized, 1);

      const docAfterSecond = await coll.findOne({ userId: 'u_rerun' });
      assert.deepStrictEqual(docAfterFirst, docAfterSecond, 'Doc must remain completely untouched on rerun');
    });

    it('5. Missing sequence is handled as clean legacy uninitialized', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_missing_seq', balance: 150 }); // sequence is undefined

      const result = await initializeWalletBaseline(db, { collectionName: name, quiet: true });
      assert.strictEqual(result.initializedCount, 1);

      const doc = await coll.findOne({ userId: 'u_missing_seq' });
      assert.strictEqual(doc.sequence, 0);
      assert.strictEqual(doc.baselineBalance, 150);
    });

    it('6. Null sequence is handled cleanly as legacy uninitialized', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_null_seq', balance: 200, sequence: null });

      const result = await initializeWalletBaseline(db, { collectionName: name, quiet: true });
      assert.strictEqual(result.initializedCount, 1);

      const doc = await coll.findOne({ userId: 'u_null_seq' });
      assert.strictEqual(doc.sequence, 0);
      assert.strictEqual(doc.baselineBalance, 200);
      assert.strictEqual(doc.baselineSequence, 0);
    });

    it('7. Existing valid baseline is preserved and not corrupted', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const existingEstablishedAt = new Date('2026-01-15T12:00:00Z');
      await coll.insertOne({
        userId: 'u_existing',
        balance: 750,
        sequence: 15,
        baselineBalance: 500,
        baselineSequence: 0,
        unsettledOperations: [],
        baselineEstablishedAt: existingEstablishedAt,
      });

      const result = await initializeWalletBaseline(db, { collectionName: name, quiet: true });
      assert.strictEqual(result.migrated, false);
      assert.strictEqual(result.alreadyInitialized, 1);
      assert.strictEqual(result.initializedCount, 0);

      const doc = await coll.findOne({ userId: 'u_existing' });
      assert.strictEqual(doc.balance, 750);
      assert.strictEqual(doc.sequence, 15);
      assert.strictEqual(doc.baselineBalance, 500);
      assert.strictEqual(doc.baselineSequence, 0);
      assert.strictEqual(doc.baselineEstablishedAt.toISOString(), existingEstablishedAt.toISOString());
    });

    it('8. Partial baseline initialization is refused', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      // Partial: sequence initialized, but baselineBalance and baselineSequence missing
      await coll.insertOne({ userId: 'u_partial', balance: 100, sequence: 0 });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Partial baseline initialization detected/i
      );

      const doc = await coll.findOne({ userId: 'u_partial' });
      assert.strictEqual(doc.baselineBalance, undefined);
    });

    it('9. Negative balance is refused and database state is preserved', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_negative', balance: -50 });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Invalid balance.*negative/i
      );

      const doc = await coll.findOne({ userId: 'u_negative' });
      assert.strictEqual(doc.sequence, undefined);
    });

    it('10. Fractional balance is refused and database state is preserved', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_fractional', balance: 99.95 });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Invalid balance/i
      );

      const doc = await coll.findOne({ userId: 'u_fractional' });
      assert.strictEqual(doc.sequence, undefined);
    });

    it('11. Unsafe integer balance (> Number.MAX_SAFE_INTEGER) is refused', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({ userId: 'u_unsafe_balance', balance: Number.MAX_SAFE_INTEGER + 1000 });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Invalid balance/i
      );
    });

    it('12. Corrupted sequence is refused', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({
        userId: 'u_bad_seq',
        balance: 100,
        sequence: -1,
        baselineBalance: 100,
        baselineSequence: 0,
        unsettledOperations: [],
      });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Invalid sequence/i
      );
    });

    it('13. Wallet with unsettled operations is refused where required', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertOne({
        userId: 'u_unsettled',
        balance: 100,
        unsettledOperations: [{ opId: 'op_unsettled_123', amount: 50 }],
      });

      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Cannot establish baseline.*unsettled operation/i
      );
    });

    it('14. Conditional migration detects a concurrent wallet modification', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({ _id: walletId, userId: 'u_concurrent', balance: 100 });

      // Simulate a concurrent balance update (e.g. gameplay reward awarded concurrently)
      await coll.updateOne({ _id: walletId }, { $set: { balance: 150 } });

      // Run conditional update simulating stale preflight balance: 100
      const filter = {
        _id: walletId,
        balance: 100, // Stale preflight expectation
        $and: [
          { $or: [{ sequence: { $exists: false } }, { sequence: null }] },
          { $or: [{ baselineBalance: { $exists: false } }, { baselineBalance: null }] },
          { $or: [{ baselineSequence: { $exists: false } }, { baselineSequence: null }] },
        ],
      };
      const update = {
        $set: {
          sequence: 0,
          baselineBalance: 100,
          baselineSequence: 0,
          unsettledOperations: [],
          baselineEstablishedAt: new Date(),
        },
      };

      const res = await coll.updateOne(filter, update);
      assert.strictEqual(res.modifiedCount, 0, 'Conditional update must refuse stale write');

      const doc = await coll.findOne({ _id: walletId });
      assert.strictEqual(doc.balance, 150, 'Live modified balance must be preserved');
      assert.strictEqual(doc.sequence, undefined, 'Stale baseline sequence must not be applied');
    });

    it('14b. Conditional migration detects concurrent unsettledOperations modification and refuses stale write', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({ _id: walletId, userId: 'u_concurrent_unsettled', balance: 100 });

      // Simulate a concurrent operation adding an unsettled operation right after preflight inspection
      await coll.updateOne(
        { _id: walletId },
        { $set: { unsettledOperations: [{ opId: 'op_concurrent_live', amount: 20 }] } }
      );

      // Now run initializeWalletBaseline on this collection
      // Since it already has unsettledOperations in DB, the preflight or atomic filter will catch it
      await assert.rejects(
        async () => {
          await initializeWalletBaseline(db, { collectionName: name, quiet: true });
        },
        /Cannot establish baseline.*unsettled operation/i
      );

      // Test the exact atomic update filter with a concurrent push between preflight and update
      const filter = {
        _id: walletId,
        balance: 100,
        $and: [
          { $or: [{ sequence: { $exists: false } }, { sequence: null }] },
          { $or: [{ baselineBalance: { $exists: false } }, { baselineBalance: null }] },
          { $or: [{ baselineSequence: { $exists: false } }, { baselineSequence: null }] },
          {
            $or: [
              { unsettledOperations: { $exists: false } },
              { unsettledOperations: null },
              { unsettledOperations: { $size: 0 } },
            ],
          },
        ],
      };
      const update = {
        $set: {
          sequence: 0,
          baselineBalance: 100,
          baselineSequence: 0,
          unsettledOperations: [],
          baselineEstablishedAt: new Date(),
        },
      };

      const res = await coll.updateOne(filter, update);
      assert.strictEqual(res.modifiedCount, 0, 'Atomic filter must match 0 documents when unsettledOperations is non-empty');

      const doc = await coll.findOne({ _id: walletId });
      assert.strictEqual(doc.unsettledOperations.length, 1, 'Concurrent unsettled operation must be preserved');
      assert.strictEqual(doc.unsettledOperations[0].opId, 'op_concurrent_live');
      assert.strictEqual(doc.sequence, undefined, 'Baseline sequence must not be applied');
    });

    it('15. Migration does not alter unrelated wallet fields', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      const walletId = new mongoose.Types.ObjectId();
      await coll.insertOne({
        _id: walletId,
        userId: 'u_unrelated',
        balance: 200,
        customTag: 'special_vip',
        metadata: { referrer: 'ad_campaign_1', signupCohort: 2026 },
      });

      await initializeWalletBaseline(db, { collectionName: name, quiet: true });

      const updated = await coll.findOne({ _id: walletId });
      assert.strictEqual(updated.customTag, 'special_vip', 'Custom tag must be preserved');
      assert.deepStrictEqual(
        updated.metadata,
        { referrer: 'ad_campaign_1', signupCohort: 2026 },
        'Metadata must be preserved'
      );
      assert.strictEqual(updated.sequence, 0);
      assert.strictEqual(updated.baselineBalance, 200);
    });

    it('16. Migration does not change User.coins', async () => {
      const { name: walletCollName } = await createIsolatedTestCollection();
      const { name: userCollName, coll: userColl } = await createIsolatedTestCollection();

      const userId = new mongoose.Types.ObjectId();
      await userColl.insertOne({ _id: userId, username: 'testuser', coins: 888 });

      const walletColl = db.collection(walletCollName);
      await walletColl.insertOne({ userId, balance: 888 });

      await initializeWalletBaseline(db, { collectionName: walletCollName, quiet: true });

      const user = await userColl.findOne({ _id: userId });
      assert.strictEqual(user.coins, 888, 'User.coins must be strictly unchanged');
    });

    it('17. Migration does not delete or rewrite WalletTransaction records', async () => {
      const { name: walletCollName } = await createIsolatedTestCollection();
      const { name: txCollName, coll: txColl } = await createIsolatedTestCollection();

      const txDocs = [
        { _id: new mongoose.Types.ObjectId(), userId: 'u_tx', opId: 'op_old_1', amount: 50 },
        { _id: new mongoose.Types.ObjectId(), userId: 'u_tx', opId: 'op_old_2', amount: 150 },
      ];
      await txColl.insertMany(txDocs);

      const walletColl = db.collection(walletCollName);
      await walletColl.insertOne({ userId: 'u_tx', balance: 200 });

      await initializeWalletBaseline(db, { collectionName: walletCollName, quiet: true });

      const postTx = await txColl.find().toArray();
      assert.strictEqual(postTx.length, 2, 'Transaction count must remain unchanged');
      assert.deepStrictEqual(
        postTx.map((t) => t._id.toString()),
        txDocs.map((t) => t._id.toString()),
        'Transaction IDs and records must remain strictly identical'
      );
    });

    it('18. Dry-run mode reports planned action without writing to database', async () => {
      const { name, coll } = await createIsolatedTestCollection();
      await coll.insertMany([
        { userId: 'u_dry_1', balance: 100 },
        { userId: 'u_dry_2', balance: 200 },
      ]);

      const report = await initializeWalletBaseline(db, { collectionName: name, dryRun: true, quiet: true });
      assert.strictEqual(report.dryRun, true);
      assert.strictEqual(report.migrated, false);
      assert.strictEqual(report.totalScanned, 2);
      assert.strictEqual(report.needingInitialization, 2);
      assert.strictEqual(report.alreadyInitialized, 0);

      const docs = await coll.find().toArray();
      for (const d of docs) {
        assert.strictEqual(d.sequence, undefined, 'Sequence must not be set during dryRun');
        assert.strictEqual(d.baselineBalance, undefined, 'BaselineBalance must not be set during dryRun');
      }
    });

    it('19. Unit tests: classifyWalletState accurately classifies wallet document shapes', () => {
      assert.strictEqual(classifyWalletState(null).state, 'CORRUPTED');
      assert.strictEqual(classifyWalletState({ balance: 'invalid' }).state, 'CORRUPTED');
      assert.strictEqual(classifyWalletState({ balance: -10 }).state, 'CORRUPTED');
      assert.strictEqual(classifyWalletState({ balance: 10.5 }).state, 'CORRUPTED');
      assert.strictEqual(classifyWalletState({ balance: 100 }).state, 'LEGACY_UNINITIALIZED');
      assert.strictEqual(classifyWalletState({ balance: 100, sequence: null }).state, 'LEGACY_UNINITIALIZED');
      assert.strictEqual(
        classifyWalletState({
          balance: 100,
          sequence: 0,
          baselineBalance: 100,
          baselineSequence: 0,
          unsettledOperations: [],
        }).state,
        'FULLY_INITIALIZED'
      );
      assert.strictEqual(
        classifyWalletState({
          balance: 100,
          sequence: 1,
          baselineBalance: 100,
          baselineSequence: 0,
          unsettledOperations: [],
        }).state,
        'FULLY_INITIALIZED'
      );

      // Invariant: sequence < baselineSequence
      assert.strictEqual(
        classifyWalletState({
          balance: 100,
          sequence: 0,
          baselineBalance: 100,
          baselineSequence: 1,
          unsettledOperations: [],
        }).state,
        'CORRUPTED'
      );

      // Partial baseline
      assert.strictEqual(classifyWalletState({ balance: 100, sequence: 0 }).state, 'CORRUPTED');

      // Unsettled operations on legacy wallet
      assert.strictEqual(
        classifyWalletState({ balance: 100, unsettledOperations: [{ opId: '123' }] }).state,
        'CORRUPTED'
      );

      // Helper function boolean checks
      assert.strictEqual(isLegacyUninitialized({ balance: 100 }), true);
      assert.strictEqual(
        isFullyInitialized({
          balance: 100,
          sequence: 0,
          baselineBalance: 100,
          baselineSequence: 0,
          unsettledOperations: [],
        }),
        true
      );
      assert.strictEqual(isCorruptedWallet({ balance: -5 }), true);
    });
  });
});
