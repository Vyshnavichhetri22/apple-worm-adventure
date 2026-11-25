/**
 * server/src/utils/migrateWalletOpIdIndex.js
 * 
 * Hardened, safe, and idempotent migration utility for WalletTransaction opId unique index.
 * 
 * Establishes the user-scoped unique compound index:
 *   - Key pattern: { userId: 1, opId: 1 }
 *   - Name: 'userId_1_opId_1'
 *   - unique: true
 *   - partialFilterExpression: { opId: { $type: 'string' } }
 * 
 * Safety guarantees:
 *   - Non-destructive: NEVER deletes, merges, alters, or drops any financial records.
 *   - Preserves existing idempotency index: Strictly preserves { userId: 1, idempotencyKey: 1 }.
 *   - Preflight inspection: Inspects existing indexes before creating or modifying indexes.
 *   - Duplicate detection: Scans for duplicate (userId, opId) records and refuses migration if any exist.
 *   - Conflicting index refusal: Refuses migration if any conflicting, malformed, or unexpected
 *     index involving opId exists. Never automatically drops or overwrites conflicting indexes.
 *   - Safe dry-run mode: Supports dryRun: true to report planned actions without modifying state.
 *   - Idempotent: Can be executed repeatedly without side effects.
 */

import mongoose from 'mongoose';

/**
 * Checks whether an index specification includes the 'opId' field
 * by key membership (independent of value or direction).
 */
export function hasOpIdField(idx) {
  if (!idx || typeof idx !== 'object' || !idx.key || typeof idx.key !== 'object') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(idx.key, 'opId');
}

/**
 * Strictly verifies whether an index specification matches the required compound
 * unique partial index:
 *   - Key pattern: { userId: 1, opId: 1 } (exact order, exactly 2 fields, exact values 1)
 *   - unique: true
 *   - partialFilterExpression: { opId: { $type: 'string' } }
 */
export function isValidCompoundOpIdIndex(idx) {
  if (!hasOpIdField(idx)) return false;

  // 1. Exact key pattern: { userId: 1, opId: 1 } in this exact order
  const keys = Object.keys(idx.key);
  if (keys.length !== 2 || keys[0] !== 'userId' || keys[1] !== 'opId') {
    return false;
  }
  if (idx.key.userId !== 1 || idx.key.opId !== 1) {
    return false;
  }

  // 2. Must be strictly unique
  if (idx.unique !== true) {
    return false;
  }

  // 3. Must have exact partialFilterExpression: { opId: { $type: 'string' } }
  const pfe = idx.partialFilterExpression;
  if (!pfe || typeof pfe !== 'object') {
    return false;
  }
  const pfeKeys = Object.keys(pfe);
  if (pfeKeys.length !== 1 || pfeKeys[0] !== 'opId') {
    return false;
  }
  const opIdExpr = pfe.opId;
  if (!opIdExpr || typeof opIdExpr !== 'object') {
    return false;
  }
  const exprKeys = Object.keys(opIdExpr);
  if (exprKeys.length !== 1 || exprKeys[0] !== '$type') {
    return false;
  }
  if (opIdExpr.$type !== 'string') {
    return false;
  }

  return true;
}

/**
 * Finds any index involving opId that does NOT match the required compound index specification,
 * or any index named 'userId_1_opId_1' that has incompatible properties.
 */
export function findConflictingOpIdIndexes(indexes) {
  const conflicting = [];

  for (const idx of indexes) {
    const hasField = hasOpIdField(idx);
    const hasTargetName = idx.name === 'userId_1_opId_1';

    if (hasField || hasTargetName) {
      if (!isValidCompoundOpIdIndex(idx)) {
        conflicting.push(idx);
      }
    }
  }

  return conflicting;
}

/**
 * Scans the collection for duplicate historical records sharing the same (userId, opId)
 * where opId is a string.
 */
export async function findDuplicateHistoricalOpIdRecords(collection) {
  const pipeline = [
    { $match: { opId: { $type: 'string' } } },
    {
      $group: {
        _id: { userId: '$userId', opId: '$opId' },
        count: { $sum: 1 },
        docIds: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ];

  return await collection.aggregate(pipeline).toArray();
}

/**
 * Executes the hardened, conservative migration for the WalletTransaction opId index.
 */
export async function migrateWalletOpIdIndex(targetDb = null, options = {}) {
  const {
    quiet = false,
    dryRun = false,
    collectionName = 'wallettransactions',
  } = options;

  const db = targetDb || mongoose.connection?.db;
  if (!db) {
    throw new Error('Database handle is required to execute wallet opId index migration.');
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

  // 1. Inspect existing indexes
  const validIndex = initialIndexes.find(isValidCompoundOpIdIndex);
  const hasValidIndex = Boolean(validIndex);
  const conflictingIndexes = findConflictingOpIdIndexes(initialIndexes);

  // 2. Refuse migration if conflicting or malformed indexes exist
  if (conflictingIndexes.length > 0) {
    const descriptions = conflictingIndexes
      .map(
        (idx) =>
          `"${idx.name}" (key: ${JSON.stringify(idx.key)}, unique: ${Boolean(idx.unique)})`
      )
      .join(', ');

    throw new Error(
      `Migration aborted: Found conflicting or malformed index(es) involving "opId": [${descriptions}]. ` +
        `The migration requires strictly { userId: 1, opId: 1 } (unique: true, partialFilterExpression: { opId: { $type: "string" } }). ` +
        `Refusing to modify or drop any indexes. Database state preserved.`
    );
  }

  // 3. Scan for duplicate historical records
  const duplicates = await findDuplicateHistoricalOpIdRecords(collection);
  if (duplicates.length > 0) {
    const sample = duplicates
      .slice(0, 3)
      .map((d) => `(userId: ${d._id.userId}, opId: "${d._id.opId}", count: ${d.count})`)
      .join(', ');

    throw new Error(
      `Migration aborted: Found ${duplicates.length} duplicate (userId, opId) historical record set(s) in "${collectionName}": [${sample}]. ` +
        `Cannot create unique index without violating data integrity. No records were modified or deleted.`
    );
  }

  // 4. Dry-run mode: report planned action without making changes
  if (dryRun) {
    const report = {
      dryRun: true,
      migrated: false,
      alreadyExists: hasValidIndex,
      plannedAction: hasValidIndex ? 'NONE_ALREADY_EXISTS' : 'CREATE_UNIQUE_COMPOUND_INDEX',
      targetCollection: collectionName,
      targetIndex: {
        key: { userId: 1, opId: 1 },
        name: 'userId_1_opId_1',
        unique: true,
        partialFilterExpression: { opId: { $type: 'string' } },
      },
      duplicatesFound: 0,
      conflictsFound: 0,
    };

    if (!quiet) {
      console.log('[MIGRATION DRY-RUN] Preflight report:', report);
    }
    return report;
  }

  const result = {
    dryRun: false,
    migrated: false,
    alreadyExists: hasValidIndex,
    newIndexCreated: false,
    targetCollection: collectionName,
    initialIndexNames: initialIndexes.map((idx) => idx.name),
    finalIndexNames: [],
  };

  // 5. If valid index already exists, return cleanly (idempotent rerun)
  if (hasValidIndex) {
    if (!quiet) {
      console.log(`[MIGRATION] Valid compound opId index "${validIndex.name}" already exists on ${collectionName}. No changes needed.`);
    }
    result.finalIndexNames = initialIndexes.map((idx) => idx.name);
    return result;
  }

  // 6. Create the user-scoped compound unique index
  if (!quiet) {
    console.log(`[MIGRATION] Creating user-scoped compound unique index on ${collectionName}...`);
  }

  try {
    await collection.createIndex(
      { userId: 1, opId: 1 },
      {
        unique: true,
        partialFilterExpression: { opId: { $type: 'string' } },
        name: 'userId_1_opId_1',
      }
    );
    result.newIndexCreated = true;
    result.migrated = true;
  } catch (createErr) {
    throw new Error(
      `Migration aborted: Failed to create required compound unique opId index on ${collectionName}: ${createErr.message}. ` +
        `Database state preserved.`
    );
  }

  // 7. Post-creation verification
  const postCreateIndexes = await collection.indexes();
  const verified = postCreateIndexes.some(isValidCompoundOpIdIndex);
  if (!verified) {
    throw new Error(
      `Migration aborted: Index creation appeared to succeed, but post-creation verification failed. ` +
        `Required options (unique: true, partialFilterExpression: { opId: { $type: "string" } }) were not confirmed in MongoDB.`
    );
  }

  result.finalIndexNames = postCreateIndexes.map((idx) => idx.name);

  if (!quiet) {
    console.log('[MIGRATION] ✅ User-scoped compound unique opId index verified and confirmed active.');
  }

  return result;
}

export default migrateWalletOpIdIndex;
