/**
 * server/src/utils/initializeWalletBaseline.js
 * 
 * Conservative, safe, and idempotent baseline initialization utility for Wallet documents.
 * 
 * Establishes the authoritative accounting baseline for legacy wallets:
 *   - sequence: 0
 *   - baselineBalance: wallet.balance (historical balance frozen at baseline)
 *   - baselineSequence: 0
 *   - unsettledOperations: [] (empty array)
 *   - baselineEstablishedAt: current Date
 * 
 * Safety guarantees:
 *   - Non-destructive: NEVER alters, reduces, or modifies existing balances.
 *   - Preflight inspection: Detects and refuses corrupted balances, fractional values,
 *     unsafe integers, corrupted sequences, partial baselines, and unsettled operations.
 *   - Concurrency-safe: Uses atomic conditional updates matching document _id, exact balance,
 *     and missing baseline fields to prevent racing against live mutations.
 *   - Rerunnable: Cleanly recognizes fully initialized wallets and skips them without changes.
 *   - Scope-limited: Modifies only target wallet documents; NEVER modifies User.coins or
 *     WalletTransaction records, and preserves all unrelated wallet fields.
 *   - Dry-run mode: Supports dryRun: true to inspect and report planned actions without modifying state.
 */

import mongoose from 'mongoose';

/**
 * Classifies the baseline state of a wallet document.
 * 
 * Returns { state, reason } where state is one of:
 *   - 'LEGACY_UNINITIALIZED': Clean legacy wallet ready for baseline establishment.
 *   - 'FULLY_INITIALIZED': Wallet already has a valid, coherent accounting baseline.
 *   - 'CORRUPTED': Wallet has invalid balance, invalid sequence, partial baseline, or invalid state.
 * 
 * @param {Object} wallet - Plain object or Mongoose document
 * @returns {{ state: 'LEGACY_UNINITIALIZED'|'FULLY_INITIALIZED'|'CORRUPTED', reason: string|null }}
 */
export function classifyWalletState(wallet) {
  if (!wallet || typeof wallet !== 'object') {
    return { state: 'CORRUPTED', reason: 'Wallet document is null or not an object' };
  }

  const { balance } = wallet;

  // 1. Balance validation: must be a strictly non-negative safe integer
  if (
    typeof balance !== 'number' ||
    !Number.isInteger(balance) ||
    balance < 0 ||
    !Number.isSafeInteger(balance)
  ) {
    return {
      state: 'CORRUPTED',
      reason: `Invalid balance: ${balance} (must be a non-negative safe integer <= Number.MAX_SAFE_INTEGER)`,
    };
  }

  const hasSeq = wallet.sequence !== undefined && wallet.sequence !== null;
  const hasBaselineBalance = wallet.baselineBalance !== undefined && wallet.baselineBalance !== null;
  const hasBaselineSeq = wallet.baselineSequence !== undefined && wallet.baselineSequence !== null;
  const hasUnsettled = wallet.unsettledOperations !== undefined && wallet.unsettledOperations !== null;

  // 2. Inspect unsettled operations
  if (hasUnsettled) {
    if (!Array.isArray(wallet.unsettledOperations)) {
      return {
        state: 'CORRUPTED',
        reason: 'unsettledOperations field is present but is not an array',
      };
    }
    // If wallet is not fully initialized, non-empty unsettled operations cannot be safely baselined
    if (wallet.unsettledOperations.length > 0 && (!hasSeq || !hasBaselineBalance || !hasBaselineSeq)) {
      return {
        state: 'CORRUPTED',
        reason: `Cannot establish baseline: wallet contains ${wallet.unsettledOperations.length} unsettled operation(s) while uninitialized or partially initialized`,
      };
    }
  }

  // 3. Clean legacy uninitialized check
  const isUninitializedSeq = wallet.sequence === undefined || wallet.sequence === null;
  const isUninitializedBaselineBal = wallet.baselineBalance === undefined || wallet.baselineBalance === null;
  const isUninitializedBaselineSeq = wallet.baselineSequence === undefined || wallet.baselineSequence === null;

  if (isUninitializedSeq && isUninitializedBaselineBal && isUninitializedBaselineSeq) {
    // If unsettledOperations exists on legacy wallet, it must be an empty array
    if (hasUnsettled && Array.isArray(wallet.unsettledOperations) && wallet.unsettledOperations.length > 0) {
      return {
        state: 'CORRUPTED',
        reason: 'Unsettled operations present on legacy uninitialized wallet',
      };
    }
    return { state: 'LEGACY_UNINITIALIZED', reason: null };
  }

  // 4. Partial baseline initialization check
  if (isUninitializedSeq || isUninitializedBaselineBal || isUninitializedBaselineSeq || !hasUnsettled) {
    const present = [];
    const missing = [];
    if (!isUninitializedSeq) present.push('sequence'); else missing.push('sequence');
    if (!isUninitializedBaselineBal) present.push('baselineBalance'); else missing.push('baselineBalance');
    if (!isUninitializedBaselineSeq) present.push('baselineSequence'); else missing.push('baselineSequence');
    if (hasUnsettled) present.push('unsettledOperations'); else missing.push('unsettledOperations');

    return {
      state: 'CORRUPTED',
      reason: `Partial baseline initialization detected: present [${present.join(', ')}], missing [${missing.join(', ')}]`,
    };
  }

  // 5. Fully present fields: validate data types and invariants
  const seq = wallet.sequence;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || !Number.isSafeInteger(seq)) {
    return {
      state: 'CORRUPTED',
      reason: `Invalid sequence: ${seq} (must be a non-negative safe integer)`,
    };
  }

  const bBal = wallet.baselineBalance;
  if (typeof bBal !== 'number' || !Number.isInteger(bBal) || bBal < 0 || !Number.isSafeInteger(bBal)) {
    return {
      state: 'CORRUPTED',
      reason: `Invalid baselineBalance: ${bBal} (must be a non-negative safe integer)`,
    };
  }

  const bSeq = wallet.baselineSequence;
  if (typeof bSeq !== 'number' || !Number.isInteger(bSeq) || bSeq < 0 || !Number.isSafeInteger(bSeq)) {
    return {
      state: 'CORRUPTED',
      reason: `Invalid baselineSequence: ${bSeq} (must be a non-negative safe integer)`,
    };
  }

  if (seq < bSeq) {
    return {
      state: 'CORRUPTED',
      reason: `Sequence invariant violation: sequence (${seq}) is less than baselineSequence (${bSeq})`,
    };
  }

  if (!Array.isArray(wallet.unsettledOperations)) {
    return {
      state: 'CORRUPTED',
      reason: 'unsettledOperations must be an array',
    };
  }

  return { state: 'FULLY_INITIALIZED', reason: null };
}

/**
 * Convenience helper: returns true if wallet is clean legacy uninitialized.
 */
export function isLegacyUninitialized(wallet) {
  return classifyWalletState(wallet).state === 'LEGACY_UNINITIALIZED';
}

/**
 * Convenience helper: returns true if wallet is already fully initialized.
 */
export function isFullyInitialized(wallet) {
  return classifyWalletState(wallet).state === 'FULLY_INITIALIZED';
}

/**
 * Convenience helper: returns true if wallet is in an ambiguous, partial, or corrupted state.
 */
export function isCorruptedWallet(wallet) {
  return classifyWalletState(wallet).state === 'CORRUPTED';
}

/**
 * Executes conservative baseline migration for wallet documents.
 * 
 * @param {Object} [targetDb=null] - MongoDB database handle
 * @param {Object} [options={}] - Migration options
 * @param {boolean} [options.quiet=false] - Suppress console output
 * @param {boolean} [options.dryRun=false] - Preflight mode without database writes
 * @param {string} [options.collectionName='wallets'] - Target collection name
 * @param {any} [options.walletId=null] - Optional specific wallet ID to migrate
 * @returns {Promise<Object>} Migration summary result
 */
export async function initializeWalletBaseline(targetDb = null, options = {}) {
  const {
    quiet = false,
    dryRun = false,
    collectionName = 'wallets',
    walletId = null,
  } = options;

  const db = targetDb || mongoose.connection?.db;
  if (!db) {
    throw new Error('Database handle is required to execute wallet baseline migration.');
  }

  const collection = db.collection(collectionName);

  // 1. Fetch wallet documents (either single target or entire collection)
  const query = walletId ? { _id: walletId } : {};
  const wallets = await collection.find(query).toArray();

  const legacyWallets = [];
  const initializedWallets = [];
  const corruptedWallets = [];

  // 2. Preflight inspection
  for (const wallet of wallets) {
    const classification = classifyWalletState(wallet);
    if (classification.state === 'CORRUPTED') {
      corruptedWallets.push({
        _id: wallet._id,
        balance: wallet.balance,
        reason: classification.reason,
      });
    } else if (classification.state === 'FULLY_INITIALIZED') {
      initializedWallets.push(wallet);
    } else if (classification.state === 'LEGACY_UNINITIALIZED') {
      legacyWallets.push(wallet);
    }
  }

  // 3. Refuse migration immediately if any corrupted or ambiguous wallets exist
  if (corruptedWallets.length > 0) {
    const sample = corruptedWallets
      .slice(0, 3)
      .map((w) => `(id: ${w._id}, reason: ${w.reason})`)
      .join('; ');

    throw new Error(
      `Baseline migration aborted: Found ${corruptedWallets.length} corrupted or ambiguous wallet document(s) in "${collectionName}": [${sample}]. ` +
        `Refusing to modify database. Database state preserved.`
    );
  }

  // 4. Dry-run mode: report planned action without modifying state
  if (dryRun) {
    const report = {
      dryRun: true,
      migrated: false,
      totalScanned: wallets.length,
      alreadyInitialized: initializedWallets.length,
      needingInitialization: legacyWallets.length,
      corruptedCount: 0,
      plannedAction:
        wallets.length === 0
          ? 'NONE_EMPTY_COLLECTION'
          : legacyWallets.length > 0
          ? 'INITIALIZE_LEGACY_BASELINES'
          : 'NONE_ALL_INITIALIZED',
      targetCollection: collectionName,
    };

    if (!quiet) {
      console.log('[BASELINE MIGRATION DRY-RUN] Preflight report:', report);
    }
    return report;
  }

  // 5. If all wallets are already fully initialized (idempotent rerun), return cleanly
  if (legacyWallets.length === 0) {
    if (!quiet) {
      console.log(
        `[BASELINE MIGRATION] All ${wallets.length} wallet document(s) in "${collectionName}" already have valid baselines. No changes needed.`
      );
    }
    return {
      dryRun: false,
      migrated: false,
      totalScanned: wallets.length,
      alreadyInitialized: initializedWallets.length,
      initializedCount: 0,
      concurrencyConflicts: 0,
      conflictDetails: [],
      targetCollection: collectionName,
      verified: true,
    };
  }

  // 6. Conditional atomic update per legacy wallet
  let initializedCount = 0;
  let concurrencyConflicts = 0;
  const conflictDetails = [];
  const now = new Date();

  for (const wallet of legacyWallets) {
    const filter = {
      _id: wallet._id,
      balance: wallet.balance, // Strict optimistic concurrency guard on exact balance
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
        baselineBalance: wallet.balance,
        baselineSequence: 0,
        unsettledOperations: [],
        baselineEstablishedAt: now,
      },
    };

    const res = await collection.updateOne(filter, update);

    if (res.modifiedCount === 1) {
      initializedCount += 1;
    } else {
      concurrencyConflicts += 1;
      conflictDetails.push({
        _id: wallet._id,
        expectedBalance: wallet.balance,
      });
    }
  }

  // 7. Post-migration verification
  const verifyWallets = await collection.find(query).toArray();
  for (const wallet of verifyWallets) {
    const classification = classifyWalletState(wallet);
    if (classification.state === 'CORRUPTED') {
      throw new Error(
        `Baseline migration aborted post-verification: Wallet ${wallet._id} was left in corrupted state: ${classification.reason}`
      );
    }
  }

  const result = {
    dryRun: false,
    migrated: initializedCount > 0,
    totalScanned: wallets.length,
    alreadyInitialized: initializedWallets.length,
    initializedCount,
    concurrencyConflicts,
    conflictDetails,
    targetCollection: collectionName,
    verified: true,
  };

  if (!quiet) {
    console.log(
      `[BASELINE MIGRATION] ✅ Initialized ${initializedCount} wallet(s), ${initializedWallets.length} were already initialized, ${concurrencyConflicts} concurrency conflicts.`
    );
  }

  return result;
}

export default initializeWalletBaseline;
