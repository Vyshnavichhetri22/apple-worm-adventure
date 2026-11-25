/**
 * server/src/services/walletRecoveryService.js
 * 
 * Phase 8 Step 2.4 — Durable Standalone Wallet Recovery & Reconciliation Worker
 * 
 * Authoritative background worker and reconciliation service for recovering
 * interrupted wallet operations:
 *   - Bounded batch processing on Wallet.unsettledOperations
 *   - Cryptographic HMAC-SHA-256 snapshot integrity validation
 *   - Exact financial arithmetic and state transition verification
 *   - Ledger reconciliation and idempotent ledger reconstruction
 *   - Atomic exactly-one snapshot settlement guard ($size: 1)
 *   - Monotonic sequence-guarded User.coins synchronization
 *   - Complete elimination of compensating balance rollbacks
 *   - Zero replica-set transaction dependencies (standalone compatible)
 *   - In-process mutex concurrency protection
 */

import mongoose from 'mongoose';
import Wallet from '../models/Wallet.js';
import WalletTransaction, { TRANSACTION_TYPES, TRANSACTION_DIRECTIONS } from '../models/WalletTransaction.js';
import User from '../models/User.js';
import walletService, { isAmbiguousWriteError } from './walletService.js';
import { verifyFingerprint, FINGERPRINT_VERSION } from '../utils/walletIntegrity.js';

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_INTERVAL_MS = 60000;
export const BASE_RECOVERY_BACKOFF_MS = 15000; // 15 seconds
export const MAX_RECOVERY_BACKOFF_MS = 900000; // 15 minutes

// In-process concurrency and shutdown synchronization state
let isRunning = false;
let isShuttingDown = false;
let intervalHandle = null;
let activeBatchPromise = null;
let activeBatchResolve = null;

/**
 * Calculates exponential backoff delay with safe integer clamping.
 */
export function calculateRecoveryBackoffMs(
  attempts,
  baseMs = BASE_RECOVERY_BACKOFF_MS,
  maxMs = MAX_RECOVERY_BACKOFF_MS
) {
  const safeAttempts = Math.max(1, Math.min(Number(attempts) || 1, 10));
  const delay = baseMs * Math.pow(2, safeAttempts - 1);
  return Math.min(delay, maxMs);
}

/**
 * Validates the schema, arithmetic, and cryptographic HMAC fingerprint of an unsettled snapshot.
 * Fails closed on any inconsistency, format error, or signature failure.
 */
export function validateSnapshot(snapshot, wallet) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, reason: 'MISSING_SNAPSHOT_OBJECT' };
  }

  const snapObj = snapshot.toObject ? snapshot.toObject() : snapshot;
  const {
    opId,
    sequence,
    amount,
    direction,
    type,
    balanceBefore,
    balanceAfter,
    fingerprint,
    fingerprintVersion,
  } = snapObj;

  // 1. Validate opId
  if (!opId || typeof opId !== 'string' || opId.trim().length === 0) {
    return { valid: false, reason: 'INVALID_OR_MISSING_OP_ID' };
  }

  // 2. Validate sequence: positive safe integer
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    !Number.isSafeInteger(sequence)
  ) {
    return { valid: false, reason: 'INVALID_SEQUENCE' };
  }

  // 3. Validate amount: positive safe integer
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    !Number.isSafeInteger(amount)
  ) {
    return { valid: false, reason: 'INVALID_AMOUNT' };
  }

  // 4. Validate direction
  if (!TRANSACTION_DIRECTIONS.includes(direction)) {
    return { valid: false, reason: 'INVALID_DIRECTION' };
  }

  // 5. Validate transaction type
  if (!type || typeof type !== 'string' || !TRANSACTION_TYPES.includes(type)) {
    return { valid: false, reason: 'INVALID_TRANSACTION_TYPE' };
  }

  // 6. Validate balance bounds: non-negative safe integers
  if (
    typeof balanceBefore !== 'number' ||
    !Number.isInteger(balanceBefore) ||
    balanceBefore < 0 ||
    !Number.isSafeInteger(balanceBefore)
  ) {
    return { valid: false, reason: 'INVALID_BALANCE_BEFORE' };
  }

  if (
    typeof balanceAfter !== 'number' ||
    !Number.isInteger(balanceAfter) ||
    balanceAfter < 0 ||
    !Number.isSafeInteger(balanceAfter)
  ) {
    return { valid: false, reason: 'INVALID_BALANCE_AFTER' };
  }

  // 7. Validate financial arithmetic invariant
  if (direction === 'CREDIT') {
    if (balanceAfter !== balanceBefore + amount) {
      return { valid: false, reason: 'CREDIT_ARITHMETIC_MISMATCH' };
    }
  } else if (direction === 'DEBIT') {
    if (balanceBefore < amount || balanceAfter !== balanceBefore - amount) {
      return { valid: false, reason: 'DEBIT_ARITHMETIC_MISMATCH' };
    }
  }

  // 8. Validate fingerprint format & version
  if (!fingerprint || typeof fingerprint !== 'string' || !fingerprint.startsWith('v1:')) {
    return { valid: false, reason: 'INVALID_FINGERPRINT_FORMAT' };
  }

  if (typeof fingerprintVersion !== 'number' || fingerprintVersion < 1) {
    return { valid: false, reason: 'INVALID_FINGERPRINT_VERSION' };
  }

  // 9. Cryptographic HMAC-SHA-256 verification against parent wallet & user identity
  const walletId = wallet._id || wallet;
  const userId = wallet.userId;
  const isHmacValid = verifyFingerprint(
    {
      ...snapObj,
      walletId,
      userId,
    },
    fingerprint
  );

  if (!isHmacValid) {
    return { valid: false, reason: 'HMAC_VERIFICATION_FAILED' };
  }

  return { valid: true };
}

/**
 * Searches for an existing ledger record (WalletTransaction) corresponding to the snapshot.
 */
export async function findLedgerRecord(snapshot, wallet, session = null) {
  const orConditions = [{ opId: snapshot.opId }];
  if (snapshot.idempotencyKey) {
    orConditions.push({ idempotencyKey: snapshot.idempotencyKey });
  }

  const query = {
    userId: wallet.userId,
    $or: orConditions,
  };

  const tx = await WalletTransaction.findOne(query, null, session ? { session } : {}).lean();
  if (!tx) {
    return { exists: false, tx: null };
  }

  // Check complete financial identity match
  const isMatch =
    tx.opId === snapshot.opId &&
    tx.amount === snapshot.amount &&
    tx.direction === snapshot.direction &&
    tx.type === snapshot.type &&
    tx.balanceBefore === snapshot.balanceBefore &&
    tx.balanceAfter === snapshot.balanceAfter &&
    tx.sequence === snapshot.sequence &&
    tx.fingerprint === snapshot.fingerprint;

  if (isMatch) {
    return { exists: true, matches: true, tx };
  }

  return { exists: true, matches: false, tx, reason: 'TRANSACTION_FIELDS_MISMATCH' };
}

/**
 * Recovers a single unsettled operation snapshot:
 *   1. Validates snapshot schema, arithmetic, and HMAC fingerprint.
 *   2. Guards against duplicate snapshots in the wallet.
 *   3. Checks ledger state (WalletTransaction):
 *      - If exists and matches: proceeds to settlement.
 *      - If exists and conflicts: fails closed without settlement.
 *      - If does not exist: persists missing ledger record.
 *   4. Atomically settles snapshot ($size: 1 guard).
 *   5. Monotonically syncs User.coins.
 * 
 * NEVER mutates wallet balance!
 */
export async function recoverSnapshot(wallet, snapshot, options = {}) {
  const { session = null, dryRun = false } = options;
  const snapObj = snapshot.toObject ? snapshot.toObject() : snapshot;
  const opId = snapObj.opId;

  // Step A: Cryptographic & Invariant Validation
  const validation = validateSnapshot(snapObj, wallet);
  if (!validation.valid) {
    console.warn(`[WalletRecovery] Snapshot ${opId} validation failed: ${validation.reason}. Skipping recovery.`);
    return {
      success: false,
      opId,
      status: 'VALIDATION_FAILED',
      reason: validation.reason,
      resolved: false,
    };
  }

  // Step B: Guard against duplicate snapshots within the same wallet
  const currentUnsettled = Array.isArray(wallet.unsettledOperations) ? wallet.unsettledOperations : [];
  const duplicateMatches = currentUnsettled.filter((op) => op.opId === opId);
  if (duplicateMatches.length > 1) {
    console.error(
      `[WalletRecovery] CRITICAL: Duplicate snapshots (${duplicateMatches.length}) detected for opId ${opId} in wallet ${wallet._id}. Aborting settlement to prevent corruption.`
    );
    return {
      success: false,
      opId,
      status: 'DUPLICATE_SNAPSHOTS_DETECTED',
      reason: 'DUPLICATE_SNAPSHOTS_IN_WALLET',
      resolved: false,
    };
  }

  // Step C: Inspect Ledger (WalletTransaction)
  let ledgerResult;
  try {
    ledgerResult = await findLedgerRecord(snapObj, wallet, session);
  } catch (err) {
    console.error(`[WalletRecovery] Ledger lookup failed for opId ${opId}:`, err.message);
    return {
      success: false,
      opId,
      status: 'DATABASE_ERROR',
      reason: err.message,
      resolved: false,
    };
  }

  if (ledgerResult.exists) {
    if (!ledgerResult.matches) {
      console.error(
        `[WalletRecovery] CRITICAL: Existing ledger record for opId ${opId} conflicts with unsettled snapshot. Aborting settlement.`
      );
      return {
        success: false,
        opId,
        status: 'LEDGER_CONFLICT',
        reason: ledgerResult.reason,
        resolved: false,
      };
    }
  } else {
    // Ledger record does not exist: persist missing record without mutating balance
    if (dryRun) {
      return {
        success: true,
        opId,
        status: 'DRY_RUN_WOULD_PERSIST',
        resolved: false,
      };
    }

    try {
      await walletService._persistLedgerRecord(wallet, snapObj, {
        session,
        description:
          snapObj.description ||
          (snapObj.direction === 'CREDIT' ? 'Coin credit' : 'Coin debit'),
        metadata: {
          ...(snapObj.metadata || {}),
          recoveredByWorker: true,
          recoveredAt: new Date(),
        },
      });
    } catch (persistErr) {
      if (isAmbiguousWriteError(persistErr)) {
        console.error(`[WalletRecovery] Ambiguous write during ledger recovery for opId ${opId}:`, persistErr.message);
        return {
          success: false,
          opId,
          status: 'AMBIGUOUS_WRITE',
          reason: persistErr.message,
          resolved: false,
        };
      }

      console.error(`[WalletRecovery] Ledger persistence failed during recovery for opId ${opId}:`, persistErr.message);
      return {
        success: false,
        opId,
        status: 'PERSISTENCE_FAILED',
        reason: persistErr.message,
        resolved: false,
      };
    }
  }

  if (dryRun) {
    return {
      success: true,
      opId,
      status: 'DRY_RUN_WOULD_SETTLE',
      resolved: false,
    };
  }

  // Step D: Settle Recovered Snapshot
  const settled = await walletService._settleUnsettledOperation(wallet, snapObj, session);
  if (!settled) {
    // Check if snapshot was already removed (e.g. concurrent race)
    const freshWallet = await Wallet.findById(wallet._id, null, session ? { session } : {});
    const stillPresent = freshWallet?.unsettledOperations?.some((op) => op.opId === opId);
    if (!stillPresent) {
      // Concurrently settled
      return {
        success: true,
        opId,
        status: 'ALREADY_SETTLED_CONCURRENTLY',
        resolved: true,
      };
    }

    console.warn(`[WalletRecovery] Settlement failed or refused for opId ${opId}. Snapshot preserved.`);
    return {
      success: false,
      opId,
      status: 'SETTLEMENT_REFUSED',
      reason: 'SETTLEMENT_FAILED',
      resolved: false,
    };
  }

  // Step E: Monotonically sync User.coins
  await walletService._syncUserCoins(
    wallet.userId,
    snapObj.balanceAfter,
    snapObj.sequence,
    session
  );

  return {
    success: true,
    opId,
    status: 'RECOVERED_AND_SETTLED',
    sequence: snapObj.sequence,
    resolved: true,
  };
}

/**
 * Concurrency-safe atomic failure recorder for recovery backoff.
 * 
 * Uses an optimistic Compare-And-Set (CAS) loop matching the exact observed
 * `recoveryAttempts` counter to prevent concurrent recovery workers from
 * calculating exponential backoff from stale in-memory state.
 * 
 * In addition, enforces a monotonic timestamp guard so concurrent or out-of-order
 * failure recordings can never unintentionally shorten an already-established retry window.
 * 
 * If contention exceeds maxRetries (default: 5), falls back to an atomic `$inc`
 * with a monotonic guard to guarantee counter increments are never lost under high contention.
 *
 * @param {ObjectId|string} walletId - Target wallet ID
 * @param {Array|Object|string} errors - Error or array of errors encountered during recovery
 * @param {Object} [options={}] - Execution options
 * @param {ClientSession} [options.session] - Optional Mongoose/MongoDB session
 * @param {number} [options.maxRetries=5] - Maximum CAS attempts before fallback
 * @param {number} [options.baseDelayMs] - Base delay for backoff formula
 * @param {number} [options.maxDelayMs] - Max delay cap for backoff formula
 * @returns {Promise<{success: boolean, walletId: any, recoveryAttempts: number, nextRecoveryAttemptAt: Date, retries?: number, fallback?: boolean}>}
 */
export async function recordRecoveryFailure(walletId, errors = [], options = {}) {
  const {
    session = null,
    maxRetries = 5,
    baseDelayMs,
    maxDelayMs,
    forceFallback = false,
  } = options;

  const errorSummary = (Array.isArray(errors) ? errors : [errors])
    .map((e) => {
      if (!e) return 'UNKNOWN_ERROR';
      if (typeof e === 'string') return e;
      return `${e.opId ? e.opId + ': ' : ''}${e.reason || e.status || e.message || 'UNKNOWN'}`;
    })
    .join('; ')
    .slice(0, 500);

  const targetId =
    typeof walletId === 'string' && mongoose.Types.ObjectId.isValid(walletId)
      ? new mongoose.Types.ObjectId(walletId)
      : walletId;

  // Normal CAS retry loop (skipped if forceFallback is true or maxRetries <= 0)
  if (!forceFallback && maxRetries > 0) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 1. Read fresh recovery metadata directly from database
      const currentDoc = await Wallet.collection.findOne(
        { _id: targetId },
        {
          projection: { recoveryAttempts: 1, nextRecoveryAttemptAt: 1 },
          ...(session ? { session } : {}),
        }
      );

      if (!currentDoc) {
        return { success: false, reason: 'WALLET_NOT_FOUND' };
      }

      const currentAttempts = currentDoc.recoveryAttempts || 0;
      const targetAttempts = currentAttempts + 1;
      const backoffMs = calculateRecoveryBackoffMs(targetAttempts, baseDelayMs, maxDelayMs);
      const calculatedNext = new Date(Date.now() + backoffMs);

      // Monotonic guard: never shorten an already scheduled retry window
      const existingNextTime = currentDoc.nextRecoveryAttemptAt
        ? new Date(currentDoc.nextRecoveryAttemptAt).getTime()
        : 0;
      const targetNextAttempt =
        existingNextTime > calculatedNext.getTime()
          ? new Date(existingNextTime)
          : calculatedNext;

      const now = new Date();

      // 2. Optimistic CAS filter: match exact current recoveryAttempts value
      const filter = {
        _id: targetId,
        ...(currentAttempts === 0
          ? {
              $or: [
                { recoveryAttempts: 0 },
                { recoveryAttempts: null },
                { recoveryAttempts: { $exists: false } },
              ],
            }
          : { recoveryAttempts: currentAttempts }),
      };

      const update = {
        $set: {
          recoveryAttempts: targetAttempts,
          nextRecoveryAttemptAt: targetNextAttempt,
          lastRecoveryAttemptAt: now,
          lastRecoveryError: errorSummary,
        },
      };

      const result = await Wallet.collection.updateOne(
        filter,
        update,
        session ? { session } : {}
      );

      if (result.matchedCount > 0) {
        return {
          success: true,
          walletId: targetId,
          recoveryAttempts: targetAttempts,
          nextRecoveryAttemptAt: targetNextAttempt,
          retries: attempt,
        };
      }
    }
  }

  // 3. Fallback under CAS exhaustion / high contention:
  // Step 3a: Atomic pipeline findOneAndUpdate increments counter and records failure metadata
  // safely handling missing, null, and non-numeric values without lost increments.
  const updatedDoc = await Wallet.collection.findOneAndUpdate(
    { _id: targetId },
    [
      {
        $set: {
          recoveryAttempts: { $add: [{ $ifNull: ['$recoveryAttempts', 0] }, 1] },
          lastRecoveryAttemptAt: '$$NOW',
          lastRecoveryError: { $literal: errorSummary },
        },
      },
    ],
    {
      returnDocument: 'after',
      projection: { recoveryAttempts: 1, nextRecoveryAttemptAt: 1 },
      session: session || undefined,
    }
  );

  const doc = updatedDoc?.value || updatedDoc;
  if (!doc) {
    return { success: false, reason: 'WALLET_NOT_FOUND' };
  }

  const resultingAttempts = doc.recoveryAttempts || 1;
  const fallbackBackoff = calculateRecoveryBackoffMs(resultingAttempts, baseDelayMs, maxDelayMs);
  const fallbackNext = new Date(Date.now() + fallbackBackoff);

  // Step 3b: Atomic monotonic $max write ensures concurrent fallback executions
  // or lagging writes can NEVER overwrite or shorten a larger/future retry window in storage.
  await Wallet.collection.updateOne(
    { _id: targetId },
    {
      $max: { nextRecoveryAttemptAt: fallbackNext },
    },
    session ? { session } : {}
  );

  // Read authoritative nextRecoveryAttemptAt after monotonic resolution
  const finalDoc = await Wallet.collection.findOne(
    { _id: targetId },
    {
      projection: { nextRecoveryAttemptAt: 1 },
      session: session || undefined,
    }
  );

  const safeNext = finalDoc?.nextRecoveryAttemptAt || fallbackNext;

  return {
    success: true,
    walletId: targetId,
    fallback: true,
    recoveryAttempts: resultingAttempts,
    nextRecoveryAttemptAt: safeNext,
  };
}

/**
 * Reconciles a single wallet:
 *   - Recovers all valid unsettled operations in sequence order.
 *   - Resolves consistency gaps where snapshot settlement occurred before User.coins sync.
 *   - Preserves invalid or conflicting snapshots without mutation.
 */
export async function reconcileWallet(walletOrId, options = {}) {
  const { session = null, dryRun = false } = options;

  const walletId =
    walletOrId && typeof walletOrId === 'object' && walletOrId._id
      ? walletOrId._id
      : walletOrId;

  const wallet = await Wallet.findById(walletId, null, session ? { session } : {});

  if (!wallet) {
    return {
      success: false,
      reason: 'WALLET_NOT_FOUND',
      recoveredCount: 0,
      settledCount: 0,
      failedCount: 0,
    };
  }

  const unsettled = Array.isArray(wallet.unsettledOperations) ? wallet.unsettledOperations : [];

  // If wallet has no unsettled operations, reconcile User.coins cache against authoritative wallet state
  if (unsettled.length === 0) {
    if (!dryRun) {
      await walletService._syncUserCoins(wallet.userId, wallet.balance, wallet.sequence ?? 0, session);
    }
    return {
      success: true,
      walletId: wallet._id,
      userId: wallet.userId,
      unsettledCount: 0,
      recoveredCount: 0,
      settledCount: 0,
      failedCount: 0,
      errors: [],
    };
  }

  // Sort snapshots deterministically by sequence ascending
  const sortedSnapshots = [...unsettled].sort((a, b) => a.sequence - b.sequence);

  let recoveredCount = 0;
  let settledCount = 0;
  let failedCount = 0;
  const errors = [];

  for (const snapshot of sortedSnapshots) {
    try {
      const result = await recoverSnapshot(wallet, snapshot, { session, dryRun });
      if (result.success && result.resolved) {
        recoveredCount += 1;
        settledCount += 1;
      } else if (!result.success) {
        failedCount += 1;
        errors.push({ opId: snapshot.opId, reason: result.reason, status: result.status });
      }
    } catch (err) {
      failedCount += 1;
      errors.push({ opId: snapshot.opId, reason: err.message, status: 'UNHANDLED_ERROR' });
    }
  }

  // After processing snapshots, heal User.coins to match authoritative wallet balance and sequence
  if (!dryRun) {
    const finalWallet = await Wallet.findById(wallet._id, null, session ? { session } : {});
    if (finalWallet) {
      await walletService._syncUserCoins(
        finalWallet.userId,
        finalWallet.balance,
        finalWallet.sequence ?? 0,
        session
      );
    }

    // Starvation prevention: update backoff atomically on failure or clear backoff on complete resolution
    if (failedCount > 0) {
      await recordRecoveryFailure(wallet._id, errors, { session });
    } else if (settledCount > 0) {
      await Wallet.collection.updateOne(
        { _id: wallet._id },
        {
          $unset: {
            nextRecoveryAttemptAt: '',
            lastRecoveryAttemptAt: '',
            lastRecoveryError: '',
            recoveryAttempts: '',
          },
        },
        session ? { session } : {}
      );
    }
  }

  return {
    success: failedCount === 0,
    walletId: wallet._id,
    userId: wallet.userId,
    unsettledCount: unsettled.length,
    recoveredCount,
    settledCount,
    failedCount,
    errors,
  };
}

/**
 * Reconciles the User.coins cached representation for a user with the authoritative Wallet balance.
 */
export async function reconcileUserCoins(userId, options = {}) {
  const { session = null } = options;
  const wallet = await Wallet.findOne({ userId }, null, session ? { session } : {});
  if (!wallet) {
    return { synced: false, reason: 'WALLET_NOT_FOUND' };
  }

  const res = await walletService._syncUserCoins(userId, wallet.balance, wallet.sequence ?? 0, session);
  return { synced: res.synced, matched: res.matched, balance: wallet.balance, sequence: wallet.sequence };
}

/**
 * Discovers and heals wallets that have completed settlement but whose User.coins
 * cached representation remains stale (e.g. if Stage 4 sync dropped during an interruption).
 * 
 * Safety invariants:
 *   - Bounded discovery: limits candidate inspection to limit (default 50).
 *   - Never mutates wallet balance or sequence.
 *   - Never inserts or alters ledger records.
 *   - Reuses authoritative monotonic sequence guard in walletService._syncUserCoins.
 *   - Standalone MongoDB compatible (uses $lookup aggregation pipeline).
 */
export async function reconcileStaleUserCaches(options = {}) {
  const { limit = DEFAULT_BATCH_SIZE, dryRun = false } = options;

  if (mongoose.connection.readyState !== 1) {
    return { skipped: true, reason: 'DATABASE_NOT_CONNECTED', scanned: 0, healedCount: 0, healedUsers: [] };
  }

  // Find wallets where sequence > 0 and unsettledOperations is empty or absent
  const candidates = await Wallet.aggregate([
    {
      $match: {
        sequence: { $gt: 0 },
        $or: [
          { 'unsettledOperations.0': { $exists: false } },
          { unsettledOperations: { $size: 0 } },
          { unsettledOperations: { $exists: false } },
          { unsettledOperations: null },
        ],
      },
    },
    { $sort: { updatedAt: -1, _id: 1 } },
    { $limit: limit * 2 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $match: {
        $expr: {
          $or: [
            { $lt: [{ $ifNull: ['$user.coinsWalletSequence', -1] }, { $ifNull: ['$sequence', 0] }] },
            { $eq: [{ $ifNull: ['$user.coinsWalletSequence', null] }, null] },
            { $ne: ['$user.coins', '$balance'] },
          ],
        },
      },
    },
    { $limit: limit },
  ]);

  let healedCount = 0;
  const healedUsers = [];

  for (const doc of candidates) {
    if (!dryRun) {
      const res = await walletService._syncUserCoins(doc.userId, doc.balance, doc.sequence ?? 0);
      if (res.synced) {
        healedCount += 1;
        healedUsers.push(doc.userId);
      }
    } else {
      healedCount += 1;
      healedUsers.push(doc.userId);
    }
  }

  return {
    scanned: candidates.length,
    healedCount,
    healedUsers,
  };
}

/**
 * Runs a single bounded batch of wallet recovery across all wallets with pending unsettled operations
 * as well as a secondary bounded scan for stale User.coins caches.
 * 
 * Safety invariants:
 *   - In-process mutex prevents overlapping batch executions.
 *   - Verifies active database connection before executing.
 *   - Bounded batch size (default 50) prevents memory exhaustion.
 *   - Deterministic processing order ({ updatedAt: 1, _id: 1 }).
 *   - Isolated error handling: error in one wallet does not abort processing of others.
 */
export async function runRecoveryBatch(options = {}) {
  // 1. Shutdown guard
  if (isShuttingDown) {
    return {
      skipped: true,
      reason: 'SHUTTING_DOWN',
      processedWallets: 0,
      recoveredCount: 0,
      settledCount: 0,
      failedCount: 0,
    };
  }

  // 2. In-process mutex guard
  if (isRunning) {
    return {
      skipped: true,
      reason: 'ALREADY_RUNNING',
      processedWallets: 0,
      recoveredCount: 0,
      settledCount: 0,
      failedCount: 0,
    };
  }

  // 3. Database connectivity check
  if (mongoose.connection.readyState !== 1) {
    return {
      skipped: true,
      reason: 'DATABASE_NOT_CONNECTED',
      processedWallets: 0,
      recoveredCount: 0,
      settledCount: 0,
      failedCount: 0,
    };
  }

  isRunning = true;
  activeBatchPromise = new Promise((resolve) => {
    activeBatchResolve = resolve;
  });

  const startTime = Date.now();
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    dryRun = false,
    ignoreBackoff = false,
  } = options;

  let processedWallets = 0;
  let processedOperations = 0;
  let totalRecovered = 0;
  let totalSettled = 0;
  let totalFailed = 0;
  const errors = [];

  try {
    // Starvation-safe query: filter out wallets currently in backoff unless ignoreBackoff is true
    const now = new Date();
    const query = {
      'unsettledOperations.0': { $exists: true },
    };

    if (!ignoreBackoff) {
      query.$or = [
        { nextRecoveryAttemptAt: { $exists: false } },
        { nextRecoveryAttemptAt: null },
        { nextRecoveryAttemptAt: { $lte: now } },
      ];
    }

    const wallets = await Wallet.find(query)
      .sort({ nextRecoveryAttemptAt: 1, updatedAt: 1, _id: 1 })
      .limit(batchSize);

    for (const wallet of wallets) {
      processedWallets += 1;
      processedOperations += wallet.unsettledOperations?.length || 0;

      try {
        const walletResult = await reconcileWallet(wallet, { dryRun });
        totalRecovered += walletResult.recoveredCount;
        totalSettled += walletResult.settledCount;
        totalFailed += walletResult.failedCount;
        if (walletResult.errors.length > 0) {
          errors.push({ walletId: wallet._id, walletErrors: walletResult.errors });
        }
      } catch (walletErr) {
        totalFailed += 1;
        errors.push({ walletId: wallet._id, error: walletErr.message });
      }
    }

    // 2. Secondary bounded discovery: heal settled wallets with stale User.coins cache
    let cacheHealedCount = 0;
    try {
      const cacheResult = await reconcileStaleUserCaches({ limit: batchSize, dryRun });
      cacheHealedCount = cacheResult.healedCount;
    } catch (cacheErr) {
      errors.push({ error: `Cache reconciliation warning: ${cacheErr.message}` });
    }

    const durationMs = Date.now() - startTime;

    // Structured operational logging
    if (processedWallets > 0 || cacheHealedCount > 0 || totalFailed > 0) {
      console.log(
        `[WalletRecovery] Batch completed in ${durationMs}ms: ` +
        `wallets=${processedWallets}, ops=${processedOperations}, recovered=${totalRecovered}, ` +
        `settled=${totalSettled}, failed=${totalFailed}, cacheHealed=${cacheHealedCount}.`
      );
    }

    return {
      skipped: false,
      processedWallets,
      processedOperations,
      recoveredCount: totalRecovered,
      settledCount: totalSettled,
      failedCount: totalFailed,
      cacheHealedCount,
      errors,
      durationMs,
    };
  } finally {
    isRunning = false;
    if (activeBatchResolve) {
      activeBatchResolve();
      activeBatchResolve = null;
    }
    activeBatchPromise = null;
  }
}

/**
 * Returns whether a recovery batch run is currently active.
 */
export function isRecoveryRunning() {
  return isRunning;
}

/**
 * Returns whether recovery is currently shutting down.
 */
export function isRecoveryShuttingDown() {
  return isShuttingDown;
}

/**
 * Returns whether the background recovery scheduler timer is currently active.
 */
export function isSchedulerActive() {
  return intervalHandle !== null;
}

/**
 * Starts scheduled background recovery on a periodic interval.
 */
export function startScheduledRecovery(options = {}) {
  const { intervalMs = DEFAULT_INTERVAL_MS, batchSize = DEFAULT_BATCH_SIZE } = options;

  if (intervalHandle) {
    return { started: false, reason: 'ALREADY_SCHEDULED' };
  }

  isShuttingDown = false;

  intervalHandle = setInterval(async () => {
    try {
      await runRecoveryBatch({ batchSize });
    } catch (err) {
      console.error('[WalletRecovery] Background recovery error:', err.message);
    }
  }, intervalMs);

  // Unref timer so it does not keep node process alive in tests or shutdown
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }

  return { started: true, intervalMs, batchSize };
}

/**
 * Stops scheduled background recovery cleanly.
 */
export function stopScheduledRecovery() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    return { stopped: true };
  }
  return { stopped: false, reason: 'NOT_SCHEDULED' };
}

/**
 * Drains active recovery and stops background scheduler cleanly with a bounded timeout.
 * 
 * Guarantees:
 *   - Stops new intervals immediately.
 *   - Prevents new batches from starting (isShuttingDown = true).
 *   - Awaits in-flight batch up to timeoutMs.
 *   - Reports explicit drained vs timedOut status without deadlocks.
 */
export async function drainAndStopRecovery(timeoutMs = 10000) {
  isShuttingDown = true;
  stopScheduledRecovery();

  if (!activeBatchPromise) {
    return { stopped: true, drained: true, timedOut: false, durationMs: 0 };
  }

  const startTime = Date.now();
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  const result = await Promise.race([
    activeBatchPromise.then(() => ({ timedOut: false })),
    timeoutPromise,
  ]);

  clearTimeout(timeoutId);
  const durationMs = Date.now() - startTime;

  if (result.timedOut) {
    console.warn(
      `[WalletRecovery] Shutdown timeout (${timeoutMs}ms) exceeded while waiting for active recovery batch to drain.`
    );
    return { stopped: true, drained: false, timedOut: true, durationMs };
  }

  return { stopped: true, drained: true, timedOut: false, durationMs };
}

/**
 * Resets recovery state (for test isolation and clean teardown).
 */
export function resetRecoveryState() {
  stopScheduledRecovery();
  isRunning = false;
  isShuttingDown = false;
  activeBatchPromise = null;
  activeBatchResolve = null;
}

export const walletRecoveryService = {
  validateSnapshot,
  findLedgerRecord,
  recoverSnapshot,
  reconcileWallet,
  recordRecoveryFailure,
  reconcileUserCoins,
  reconcileStaleUserCaches,
  runRecoveryBatch,
  isRecoveryRunning,
  isRecoveryShuttingDown,
  isSchedulerActive,
  startScheduledRecovery,
  stopScheduledRecovery,
  drainAndStopRecovery,
  resetRecoveryState,
  calculateRecoveryBackoffMs,
  BASE_RECOVERY_BACKOFF_MS,
  MAX_RECOVERY_BACKOFF_MS,
};

export default walletRecoveryService;
