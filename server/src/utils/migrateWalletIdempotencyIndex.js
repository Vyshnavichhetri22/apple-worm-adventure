/**
 * server/src/utils/migrateWalletIdempotencyIndex.js
 * 
 * Hardened, safe, and idempotent migration utility for WalletTransaction idempotency indexes.
 * 
 * Transitions the collection from:
 *   - Obsolete global unique index: { idempotencyKey: 1 } (idempotencyKey_1)
 * To:
 *   - User-scoped compound unique index: { userId: 1, idempotencyKey: 1 } (userId_1_idempotencyKey_1)
 *     with partialFilterExpression: { idempotencyKey: { $type: 'string' } }
 * 
 * Safety guarantees:
 *   - Key membership identification: Detects the presence of "idempotencyKey" regardless of
 *     index direction (1, -1, or other values) or index type.
 *   - Strict verification: Verifies exact key patterns, direction, unique: true, and partialFilterExpression.
 *   - Duplicate detection: Preflight scans for duplicate (userId, idempotencyKey) records and aborts
 *     cleanly before modifying indexes if conflicts exist.
 *   - Safe dry-run mode: Supports dryRun: true to report planned index operations without mutating state.
 *   - Conservative replacement: NEVER drops the obsolete global index unless the required
 *     compound unique partial index has been verified to exist and be valid.
 *   - Non-destructive: NEVER modifies, alters, or deletes ledger transaction records.
 *   - Fail-safe abort: If the compound index cannot be created or verified, or if an unexpected
 *     index configuration is discovered, migration aborts immediately with existing indexes preserved.
 *   - Idempotent: Can be executed repeatedly without side effects.
 */

import mongoose from 'mongoose';

/**
 * Checks whether an index specification includes the 'idempotencyKey' field
 * by key membership (independent of value or truthiness).
 */
export function hasIdempotencyKeyField(idx) {
  if (!idx || typeof idx !== 'object' || !idx.key || typeof idx.key !== 'object') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(idx.key, 'idempotencyKey');
}

/**
 * Strictly verifies whether an index specification matches the required compound
 * unique partial index:
 *   - Key pattern: { userId: 1, idempotencyKey: 1 } (exact order, exactly 2 fields, exact values 1)
 *   - unique: true
 *   - partialFilterExpression: { idempotencyKey: { $type: 'string' } }
 */
export function isValidCompoundIdempotencyIndex(idx) {
  if (!hasIdempotencyKeyField(idx)) return false;

  // 1. Exact key pattern: { userId: 1, idempotencyKey: 1 } in this exact order
  const keys = Object.keys(idx.key);
  if (keys.length !== 2 || keys[0] !== 'userId' || keys[1] !== 'idempotencyKey') {
    return false;
  }
  if (idx.key.userId !== 1 || idx.key.idempotencyKey !== 1) {
    return false;
  }

  // 2. Must be strictly unique
  if (idx.unique !== true) {
    return false;
  }

  // 3. Must have exact partialFilterExpression: { idempotencyKey: { $type: 'string' } }
  const pfe = idx.partialFilterExpression;
  if (!pfe || typeof pfe !== 'object') {
    return false;
  }
  const pfeKeys = Object.keys(pfe);
  if (pfeKeys.length !== 1 || pfeKeys[0] !== 'idempotencyKey') {
    return false;
  }
  const idempExpr = pfe.idempotencyKey;
  if (!idempExpr || typeof idempExpr !== 'object') {
    return false;
  }
  const exprKeys = Object.keys(idempExpr);
  if (exprKeys.length !== 1 || exprKeys[0] !== '$type') {
    return false;
  }
  if (idempExpr.$type !== 'string') {
    return false;
  }

  return true;
}

/**
 * Conservatively identifies the exact obsolete global index:
 *   - Key pattern: { idempotencyKey: 1 } (exactly 1 field, direction 1)
 *   - name: 'idempotencyKey_1'
 *   - unique: true
 *   - sparse: true
 */
export function isObsoleteGlobalIdempotencyIndex(idx) {
  if (!hasIdempotencyKeyField(idx)) return false;

  const keys = Object.keys(idx.key);
  if (keys.length !== 1 || keys[0] !== 'idempotencyKey' || idx.key.idempotencyKey !== 1) {
    return false;
  }

  if (idx.name !== 'idempotencyKey_1') {
    return false;
  }

  if (idx.unique !== true || idx.sparse !== true) {
    return false;
  }

  return true;
}

/**
 * Scans the collection for duplicate historical records sharing the same (userId, idempotencyKey)
 * where idempotencyKey is a string.
 */
export async function findDuplicateHistoricalIdempotencyRecords(collection) {
  const pipeline = [
    { $match: { idempotencyKey: { $type: 'string' } } },
    {
      $group: {
        _id: { userId: '$userId', idempotencyKey: '$idempotencyKey' },
        count: { $sum: 1 },
        docIds: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ];

  return await collection.aggregate(pipeline).toArray();
}

/**
 * Executes hardened migration of wallet idempotency indexes.
 * 
 * @param {object} [targetDb=null] - MongoDB database handle
 * @param {object} [options={}] - Options object
 * @param {boolean} [options.dryRun=false] - When true, inspects indexes and reports planned actions without mutations
 * @param {boolean} [options.quiet=false] - When true, suppresses progress logging
 * @param {string} [options.collectionName='wallettransactions'] - Target collection name
 * @returns {Promise<object>} Migration execution or dry-run report
 */
export async function migrateWalletIdempotencyIndex(targetDb = null, options = {}) {
  const {
    quiet = false,
    dryRun = false,
    collectionName = 'wallettransactions',
  } = options;
  const db = targetDb || mongoose.connection?.db;

  if (!db) {
    throw new Error('Database handle is required to execute wallet idempotency index migration.');
  }

  const collection = db.collection(collectionName);
  let initialIndexes = [];
  try {
    initialIndexes = await collection.indexes();
  } catch (err) {
    if (err.code === 26 || err.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(err.message)) {
      initialIndexes = [];
    } else {
      throw err;
    }
  }

  // 1. Identify all indexes that contain the 'idempotencyKey' field by key membership
  const idempIndexes = initialIndexes.filter(hasIdempotencyKeyField);

  // 2. Classify indexes into valid compound, obsolete global, and unexpected
  const validCompoundIndex = idempIndexes.find(isValidCompoundIdempotencyIndex);
  let hasValidCompound = Boolean(validCompoundIndex);

  const obsoleteGlobalIndex = idempIndexes.find(isObsoleteGlobalIdempotencyIndex);

  // Check for any index involving idempotencyKey that does not match either supported pattern
  const unexpectedIdempIndexes = idempIndexes.filter(
    (idx) => !isValidCompoundIdempotencyIndex(idx) && !isObsoleteGlobalIdempotencyIndex(idx)
  );

  // Check for reserved index names that might point to invalid/mismatched configurations
  const namedCompoundConflict = initialIndexes.find(
    (idx) => idx.name === 'userId_1_idempotencyKey_1' && !isValidCompoundIdempotencyIndex(idx)
  );
  const namedGlobalConflict = initialIndexes.find(
    (idx) => idx.name === 'idempotencyKey_1' && !isObsoleteGlobalIdempotencyIndex(idx)
  );

  if (unexpectedIdempIndexes.length > 0 || namedCompoundConflict || namedGlobalConflict) {
    const offending = [
      ...unexpectedIdempIndexes,
      ...(namedCompoundConflict && !unexpectedIdempIndexes.includes(namedCompoundConflict)
        ? [namedCompoundConflict]
        : []),
      ...(namedGlobalConflict && !unexpectedIdempIndexes.includes(namedGlobalConflict)
        ? [namedGlobalConflict]
        : []),
    ];

    const descriptions = offending
      .map(
        (idx) =>
          `"${idx.name}" (key: ${JSON.stringify(idx.key)}, unique: ${Boolean(idx.unique)})`
      )
      .join(', ');

    throw new Error(
      `Migration aborted: Found unexpected or malformed index(es) containing "idempotencyKey": [${descriptions}]. ` +
        `The migration requires strictly the valid compound index { userId: 1, idempotencyKey: 1 } (unique, partialFilterExpression: { idempotencyKey: { $type: "string" } }) ` +
        `and/or the known obsolete global index { idempotencyKey: 1 } (unique, sparse, name: "idempotencyKey_1"). ` +
        `Refusing to modify or drop any indexes. Database state preserved.`
    );
  }

  // 3. Scan for duplicate historical records if compound index needs to be created
  if (!hasValidCompound) {
    const duplicates = await findDuplicateHistoricalIdempotencyRecords(collection);
    if (duplicates.length > 0) {
      const sample = duplicates
        .slice(0, 3)
        .map((d) => `(userId: ${d._id.userId}, idempotencyKey: "${d._id.idempotencyKey}", count: ${d.count})`)
        .join(', ');

      throw new Error(
        `Migration aborted: Found ${duplicates.length} duplicate (userId, idempotencyKey) historical record set(s) in "${collectionName}": [${sample}]. ` +
          `Cannot create unique index without violating data integrity. No records were modified or deleted.`
      );
    }
  }

  // 4. Dry-run mode: report planned action without making any database mutations
  if (dryRun) {
    let plannedAction = 'NO_CHANGE';
    if (!hasValidCompound && obsoleteGlobalIndex) {
      plannedAction = 'CREATE_COMPOUND_AND_DROP_GLOBAL';
    } else if (!hasValidCompound) {
      plannedAction = 'CREATE_COMPOUND_INDEX';
    } else if (obsoleteGlobalIndex) {
      plannedAction = 'DROP_OBSOLETE_GLOBAL';
    }

    const report = {
      dryRun: true,
      migrated: false,
      alreadyExists: hasValidCompound,
      obsoleteGlobalExists: Boolean(obsoleteGlobalIndex),
      plannedAction,
      targetCollection: collectionName,
      targetIndex: {
        key: { userId: 1, idempotencyKey: 1 },
        name: 'userId_1_idempotencyKey_1',
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
      obsoleteIndexName: obsoleteGlobalIndex ? obsoleteGlobalIndex.name : null,
      duplicatesFound: 0,
      conflictsFound: 0,
      initialIndexNames: initialIndexes.map((idx) => idx.name),
      finalIndexNames: initialIndexes.map((idx) => idx.name),
    };

    if (!quiet) {
      console.log('[MIGRATION DRY-RUN] Preflight report:', report);
    }
    return report;
  }

  const result = {
    dryRun: false,
    migrated: false,
    alreadyExists: hasValidCompound,
    oldIndexDropped: false,
    newIndexCreated: false,
    initialIndexNames: initialIndexes.map((idx) => idx.name),
    finalIndexNames: [],
  };

  if (!quiet) {
    console.log(`[MIGRATION] Inspecting ${collectionName} indexes...`);
    console.log(`[MIGRATION] Valid compound unique partial index present: ${hasValidCompound}`);
    console.log(`[MIGRATION] Obsolete global unique index present: ${Boolean(obsoleteGlobalIndex)}`);
  }

  // 5. If valid compound index does NOT exist, create it
  if (!hasValidCompound) {
    if (!quiet) {
      console.log(`[MIGRATION] Creating user-scoped compound unique index on ${collectionName}...`);
    }

    try {
      await collection.createIndex(
        { userId: 1, idempotencyKey: 1 },
        {
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
          name: 'userId_1_idempotencyKey_1',
        }
      );
      result.newIndexCreated = true;
      result.migrated = true;
    } catch (createErr) {
      throw new Error(
        `Migration aborted: Failed to create required compound unique partial index on ${collectionName}: ${createErr.message}. ` +
          `Old global index was preserved.`
      );
    }

    // 6. Inspect resulting indexes again and strictly VERIFY the required compound index
    const postCreateIndexes = await collection.indexes();
    hasValidCompound = postCreateIndexes.some(isValidCompoundIdempotencyIndex);

    if (!hasValidCompound) {
      throw new Error(
        `Migration aborted: Compound index creation appeared to succeed, but post-creation verification failed. ` +
          `Required options (unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }) were not confirmed in MongoDB. ` +
          `Old global index was preserved.`
      );
    }

    if (!quiet) {
      console.log('[MIGRATION] ✅ User-scoped compound unique index verified and confirmed active.');
    }
  }

  // 7. ONLY after compound index is verified, drop obsolete global index if present
  if (obsoleteGlobalIndex) {
    if (!hasValidCompound) {
      // Defensive invariant check
      throw new Error('CRITICAL: Cannot drop obsolete global index because valid compound index is not verified.');
    }

    if (!quiet) {
      console.log(`[MIGRATION] Dropping obsolete global unique index "${obsoleteGlobalIndex.name}" from ${collectionName}...`);
    }

    try {
      await collection.dropIndex(obsoleteGlobalIndex.name);
      result.oldIndexDropped = true;
      result.migrated = true;
    } catch (dropErr) {
      throw new Error(
        `Migration warning: Valid compound index was verified, but dropping obsolete index "${obsoleteGlobalIndex.name}" failed: ${dropErr.message}.`
      );
    }

    if (!quiet) {
      console.log(`[MIGRATION] ✅ Obsolete index "${obsoleteGlobalIndex.name}" dropped cleanly.`);
    }
  }

  // 8. Re-verify final active indexes
  const finalIndexes = await collection.indexes();
  const finalHasValidCompound = finalIndexes.some(isValidCompoundIdempotencyIndex);
  if (!finalHasValidCompound) {
    throw new Error('CRITICAL: Final verification failed: required compound index is not active in database!');
  }

  const finalHasOldGlobal = finalIndexes.some((idx) => idx.name === 'idempotencyKey_1');
  if (finalHasOldGlobal) {
    throw new Error('CRITICAL: Final verification failed: obsolete global index is still active in database!');
  }

  result.finalIndexNames = finalIndexes.map((idx) => idx.name);

  if (!quiet) {
    console.log(`[MIGRATION] Migration complete. Active indexes on ${collectionName}:`, result.finalIndexNames);
  }

  return result;
}

export default migrateWalletIdempotencyIndex;
