/**
 * server/src/services/walletService.js
 * 
 * Authoritative standalone wallet service implementing:
 *   - Canonical operation input normalization
 *   - Keyed HMAC-SHA-256 fingerprint generation & verification
 *   - Atomic MongoDB update-pipeline wallet balance mutation & snapshot appending
 *   - Exactly-once ledger persistence with structured duplicate-key collision validation
 *   - Atomic exactly-one snapshot settlement guard
 *   - Monotonic sequence-guarded User.coins synchronization (coinsWalletSequence)
 *   - Complete elimination of unsafe compensating balance rollbacks
 */

import mongoose from 'mongoose';
import Wallet from '../models/Wallet.js';
import WalletTransaction, { TRANSACTION_TYPES, TRANSACTION_DIRECTIONS } from '../models/WalletTransaction.js';
import User from '../models/User.js';
import {
  FINGERPRINT_VERSION,
  MAX_UNSETTLED_OPERATIONS,
  normalizeOperationInput,
  deriveCanonicalOpId,
  buildCanonicalFingerprintPayload,
  generateFingerprint,
  verifyFingerprint,
} from '../utils/walletIntegrity.js';

/**
 * Determines whether an error is specifically an E11000 duplicate key error
 * caused by the user-scoped idempotencyKey or opId unique index constraints.
 */
export function isIdempotencyKeyDuplicateError(err, idempotencyKey = null) {
  if (!err) return false;

  // Must be MongoDB duplicate key code 11000
  if (err.code !== 11000 && err.codeName !== 'DuplicateKey') {
    return false;
  }

  // Check keyPattern if populated by MongoDB driver
  if (err.keyPattern && typeof err.keyPattern === 'object') {
    if (Object.prototype.hasOwnProperty.call(err.keyPattern, 'idempotencyKey')) return true;
    if (Object.prototype.hasOwnProperty.call(err.keyPattern, 'opId')) return true;
  }

  // Fallback: check error message for index name or field reference
  if (typeof err.message === 'string') {
    return (
      err.message.includes('idempotencyKey') ||
      err.message.includes('userId_1_idempotencyKey_1') ||
      err.message.includes('idempotencyKey_1') ||
      err.message.includes('userId_1_opId_1') ||
      err.message.includes('opId')
    );
  }

  return false;
}

/**
 * Determines whether a database write failure represents an ambiguous outcome
 * (e.g. network timeout, socket disconnect, or server selection failure)
 * where ledger persistence cannot be confirmed without re-querying.
 */
export function isAmbiguousWriteError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = (err.message || '').toLowerCase();
  const code = err.code;

  return (
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoTimeoutError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoServerClosedError' ||
    name === 'MongoSocketClosedError' ||
    name === 'MongoNotWritablePrimaryError' ||
    name === 'MongoNodeIsRecoveringError' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 50 || // MaxTimeMSExpired
    code === 91 || // ShutdownInProgress
    code === 13435 || // NotWritablePrimary
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('connection closed') ||
    msg.includes('socket closed') ||
    msg.includes('network error')
  );
}

/**
 * Evaluates whether the active MongoDB deployment topology supports multi-document transactions.
 */
export function supportsTransactions() {
  if (process.env.ENABLE_TRANSACTIONS === 'false') return false;
  const client = mongoose.connection?.client;
  if (!client || !client.topology) return false;
  const desc = client.topology.description;
  if (!desc) return false;
  if (desc.type === 'Single' && !desc.setName) return false;
  return desc.type === 'ReplicaSetWithPrimary' || desc.type === 'Sharded';
}

export const walletService = {
  isIdempotencyKeyDuplicateError,
  isAmbiguousWriteError,
  supportsTransactions,

  /**
   * Retrieves an existing wallet for a user or creates one with baseline defaults.
   * Migrates existing legacy User.coins balance if present.
   */
  async getOrCreateWallet(userId, session = null) {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid userId format');
      error.statusCode = 400;
      throw error;
    }

    const query = { userId: new mongoose.Types.ObjectId(userId) };
    let wallet = await Wallet.findOne(query, null, session ? { session } : {});

    if (!wallet) {
      try {
        // Check if user has legacy coins recorded
        const user = await User.findById(userId, null, session ? { session } : {}).lean();
        const legacyBalance = user && Number.isInteger(user.coins) && user.coins > 0 ? user.coins : 0;

        wallet = await Wallet.create(
          [
            {
              userId: new mongoose.Types.ObjectId(userId),
              balance: legacyBalance,
            },
          ],
          session ? { session } : {}
        );
        wallet = wallet[0];

        // Record migration ledger entry if initial coins existed
        if (legacyBalance > 0) {
          const migrationOpId = `op_migration_${userId}`;
          const fingerprint = generateFingerprint({
            version: FINGERPRINT_VERSION,
            userId: wallet.userId,
            walletId: wallet._id,
            opId: migrationOpId,
            amount: legacyBalance,
            direction: 'CREDIT',
            type: 'BONUS',
            referenceId: null,
            idempotencyKey: `migration_user_${userId}`,
            sequence: 0,
            balanceBefore: 0,
            balanceAfter: legacyBalance,
          });

          await WalletTransaction.create(
            [
              {
                userId: wallet.userId,
                walletId: wallet._id,
                opId: migrationOpId,
                sequence: null,
                fingerprint,
                fingerprintVersion: FINGERPRINT_VERSION,
                direction: 'CREDIT',
                type: 'BONUS',
                amount: legacyBalance,
                balanceBefore: 0,
                balanceAfter: legacyBalance,
                idempotencyKey: `migration_user_${userId}`,
                description: 'Initial legacy balance migration to wallet',
                metadata: { initialMigration: true },
              },
            ],
            session ? { session } : {}
          ).catch((err) => {
            if (err.code !== 11000) console.error('Migration ledger warning:', err.message);
          });
        }
      } catch (err) {
        if (err.code === 11000) {
          // Concurrent wallet creation race: re-query existing wallet
          wallet = await Wallet.findOne(query, null, session ? { session } : {});
          if (wallet) return wallet;
        }
        throw err;
      }
    }

    return wallet;
  },

  /**
   * Performs the atomic wallet mutation primitive.
   * 
   * In a single atomic MongoDB aggregation update pipeline:
   *   1. Guards wallet identity, balance bounds, sequence integer bounds, and backpressure.
   *   2. Advances sequence monotonically: sequence = (sequence ?? 0) + 1.
   *   3. Applies balance arithmetic: balance += amount (credit) or balance -= amount (debit).
   *   4. Establishes baseline fields on legacy documents if missing.
   *   5. Appends snapshot to unsettledOperations with exact financial state and HMAC fingerprint.
   * 
   * Uses optimistic concurrency retry loop on conflict.
   */
  async _mutateWalletAtomic(params) {
    const {
      userId,
      amount,
      direction,
      type,
      referenceId,
      idempotencyKey,
      opId,
      description,
      metadata,
      session = null,
      maxAttempts = 5,
    } = params;

    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;

      // 1. Fetch current wallet state
      const wallet = await this.getOrCreateWallet(userId, session);

      // Preflight: check if this operation was already persisted to the ledger by a concurrent winner
      const existingTx = await WalletTransaction.findOne(
        {
          userId,
          $or: [
            { opId },
            ...(idempotencyKey ? [{ idempotencyKey }] : []),
          ],
        },
        null,
        session ? { session } : {}
      );

      if (existingTx) {
        const isMatch =
          existingTx.amount === amount &&
          existingTx.direction === direction &&
          existingTx.type === type;

        if (isMatch) {
          return {
            wallet,
            snapshot: {
              opId: existingTx.opId,
              sequence: existingTx.sequence,
              amount: existingTx.amount,
              direction: existingTx.direction,
              type: existingTx.type,
              referenceId: existingTx.referenceId,
              idempotencyKey: existingTx.idempotencyKey,
              balanceBefore: existingTx.balanceBefore,
              balanceAfter: existingTx.balanceAfter,
              fingerprint: existingTx.fingerprint,
              fingerprintVersion: existingTx.fingerprintVersion,
            },
            alreadyPersisted: true,
            transaction: existingTx,
          };
        }

        const conflictError = new Error(
          `Idempotency key collision: key "${idempotencyKey || opId}" already used with different transaction parameters`
        );
        conflictError.statusCode = 409;
        throw conflictError;
      }

      // Preflight: unsettled operations capacity check (backpressure)
      const currentUnsettled = Array.isArray(wallet.unsettledOperations)
        ? wallet.unsettledOperations
        : [];

      if (currentUnsettled.length >= MAX_UNSETTLED_OPERATIONS) {
        const error = new Error(
          `Operation rejected: wallet has ${currentUnsettled.length} unsettled operations pending reconciliation. Capacity limit reached.`
        );
        error.statusCode = 503;
        throw error;
      }

      // Preflight: check if this opId is already in unsettledOperations
      const existingInFlight = currentUnsettled.find((op) => op.opId === opId);
      if (existingInFlight) {
        const snapObj =
          existingInFlight && typeof existingInFlight.toObject === 'function'
            ? existingInFlight.toObject()
            : existingInFlight;

        // Verify parameter matching
        const isMatch =
          snapObj.amount === amount &&
          snapObj.direction === direction &&
          snapObj.type === type;

        if (isMatch) {
          // Exactly matching in-flight operation: return it for ledger persistence & settlement
          return {
            wallet,
            snapshot: snapObj,
            alreadyInFlight: true,
          };
        }

        const conflictError = new Error(
          `Idempotency key collision: in-flight operation "${opId}" already exists with conflicting parameters`
        );
        conflictError.statusCode = 409;
        throw conflictError;
      }

      // Preflight: balance validation
      if (direction === 'DEBIT') {
        if (wallet.balance < amount) {
          const error = new Error(
            `Insufficient balance. Required: ${amount}, Available: ${wallet.balance}`
          );
          error.statusCode = 400;
          throw error;
        }
      } else {
        // Credit safe integer overflow check
        if (wallet.balance + amount > Number.MAX_SAFE_INTEGER) {
          const error = new Error('Credit exceeds maximum safe balance integer limit.');
          error.statusCode = 400;
          throw error;
        }
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = direction === 'CREDIT' ? balanceBefore + amount : balanceBefore - amount;
      const currentSequence = wallet.sequence ?? 0;
      const newSequence = currentSequence + 1;

      // Compute cryptographic HMAC-SHA-256 fingerprint for this operation
      const fingerprint = generateFingerprint({
        version: FINGERPRINT_VERSION,
        userId: wallet.userId,
        walletId: wallet._id,
        opId,
        amount,
        direction,
        type,
        referenceId,
        idempotencyKey,
        sequence: newSequence,
        balanceBefore,
        balanceAfter,
      });

      // 2. Build atomic conditional update filter
      const filter = {
        _id: wallet._id,
        userId: wallet.userId,
        balance: balanceBefore, // Strict optimistic concurrency guard on exact balance
        $and: [
          // Sequence guard: matches exact current sequence or both null/absent for legacy
          wallet.sequence !== undefined && wallet.sequence !== null
            ? { sequence: wallet.sequence }
            : { $or: [{ sequence: { $exists: false } }, { sequence: null }] },
          // Unsettled capacity guard:
          {
            $or: [
              { unsettledOperations: { $exists: false } },
              { unsettledOperations: null },
              {
                $expr: {
                  $lt: [
                    { $size: { $ifNull: ['$unsettledOperations', []] } },
                    MAX_UNSETTLED_OPERATIONS,
                  ],
                },
              },
            ],
          },
          // Duplicate opId guard inside unsettledOperations:
          { 'unsettledOperations.opId': { $ne: opId } },
        ],
      };

      // 3. Build atomic aggregation update pipeline
      const pipeline = [
        {
          $set: {
            sequence: { $add: [{ $ifNull: ['$sequence', 0] }, 1] },
            balance:
              direction === 'CREDIT'
                ? { $add: ['$balance', amount] }
                : { $subtract: ['$balance', amount] },
            baselineBalance: { $ifNull: ['$baselineBalance', '$balance'] },
            baselineSequence: { $ifNull: ['$baselineSequence', 0] },
            baselineEstablishedAt: { $ifNull: ['$baselineEstablishedAt', '$$NOW'] },
            nextRecoveryAttemptAt: null,
            lastRecoveryError: null,
            unsettledOperations: {
              $concatArrays: [
                { $ifNull: ['$unsettledOperations', []] },
                [
                  {
                    opId: { $literal: opId },
                    sequence: { $add: [{ $ifNull: ['$sequence', 0] }, 1] },
                    amount: { $literal: amount },
                    direction: { $literal: direction },
                    type: { $literal: type },
                    referenceId: { $literal: referenceId },
                    idempotencyKey: { $literal: idempotencyKey },
                    balanceBefore: '$balance',
                    balanceAfter:
                      direction === 'CREDIT'
                        ? { $add: ['$balance', amount] }
                        : { $subtract: ['$balance', amount] },
                    fingerprint: { $literal: fingerprint },
                    fingerprintVersion: { $literal: FINGERPRINT_VERSION },
                    createdAt: '$$NOW',
                  },
                ],
              ],
            },
          },
        },
      ];

      // Execute atomic findOneAndUpdate on raw collection
      const updatedDoc = await Wallet.collection.findOneAndUpdate(
        filter,
        pipeline,
        {
          returnDocument: 'after',
          ...(session ? { session } : {}),
        }
      );

      if (updatedDoc) {
        // Find the newly appended snapshot
        const snapshot = updatedDoc.unsettledOperations.find((op) => op.opId === opId);
        return {
          wallet: updatedDoc,
          snapshot,
          alreadyInFlight: false,
        };
      }

      // Concurrency conflict occurred: retry loop continues
    }

    const conflictErr = new Error(
      `Wallet mutation concurrency conflict for user ${userId} after ${maxAttempts} attempts.`
    );
    conflictErr.statusCode = 409;
    throw conflictErr;
  },

  /**
   * Persists the financial ledger record in WalletTransaction.
   * On duplicate key error, validates existing record for exact financial identity match.
   */
  async _persistLedgerRecord(wallet, snapshot, options = {}) {
    const { session = null, description, metadata } = options;

    try {
      const created = await WalletTransaction.create(
        session
          ? [
              {
                userId: wallet.userId,
                walletId: wallet._id,
                opId: snapshot.opId,
                sequence: snapshot.sequence,
                fingerprint: snapshot.fingerprint,
                fingerprintVersion: snapshot.fingerprintVersion,
                direction: snapshot.direction,
                type: snapshot.type,
                amount: snapshot.amount,
                balanceBefore: snapshot.balanceBefore,
                balanceAfter: snapshot.balanceAfter,
                referenceId: snapshot.referenceId,
                idempotencyKey: snapshot.idempotencyKey,
                description:
                  description ||
                  (snapshot.direction === 'CREDIT' ? 'Coin credit' : 'Coin debit'),
                metadata: metadata || {},
              },
            ]
          : {
              userId: wallet.userId,
              walletId: wallet._id,
              opId: snapshot.opId,
              sequence: snapshot.sequence,
              fingerprint: snapshot.fingerprint,
              fingerprintVersion: snapshot.fingerprintVersion,
              direction: snapshot.direction,
              type: snapshot.type,
              amount: snapshot.amount,
              balanceBefore: snapshot.balanceBefore,
              balanceAfter: snapshot.balanceAfter,
              referenceId: snapshot.referenceId,
              idempotencyKey: snapshot.idempotencyKey,
              description:
                description ||
                (snapshot.direction === 'CREDIT' ? 'Coin credit' : 'Coin debit'),
              metadata: metadata || {},
            },
        session ? { session } : undefined
      );

      const transaction = Array.isArray(created) ? created[0] : created;
      return { transaction, isDuplicate: false };
    } catch (err) {
      if (err.code === 11000 || isAmbiguousWriteError(err)) {
        try {
          // Query existing transaction by user and (opId OR idempotencyKey)
          const orConditions = [{ opId: snapshot.opId }];
          if (snapshot.idempotencyKey) {
            orConditions.push({ idempotencyKey: snapshot.idempotencyKey });
          }

          const existingTx = await WalletTransaction.findOne(
            { userId: wallet.userId, $or: orConditions },
            null,
            session ? { session } : {}
          );

          if (existingTx) {
            // Validate complete financial identity
            const isSameAmount = existingTx.amount === snapshot.amount;
            const isSameDirection = existingTx.direction === snapshot.direction;
            const isSameType = existingTx.type === snapshot.type;

            if (isSameAmount && isSameDirection && isSameType) {
              return { transaction: existingTx, isDuplicate: err.code === 11000 };
            }

            const conflictError = new Error(
              `Idempotency key collision: key "${snapshot.idempotencyKey || snapshot.opId}" already used with different transaction parameters`
            );
            conflictError.statusCode = 409;
            throw conflictError;
          }
        } catch (verifyErr) {
          if (verifyErr.statusCode === 409) throw verifyErr;
          // Verification query itself failed or threw an error (e.g. server selection error)
          const ambiguousErr = new Error(
            `Ambiguous write outcome: ledger write failed with ${err.name || err.message}, and persistence verification failed with ${verifyErr.message}. Compensation was aborted to protect financial consistency.`
          );
          ambiguousErr.statusCode = 500;
          ambiguousErr.isAmbiguous = true;
          ambiguousErr.persistenceUncertain = true;
          ambiguousErr.originalError = err;
          ambiguousErr.verificationError = verifyErr;
          ambiguousErr.discrepancy = {
            userId: wallet.userId,
            walletId: wallet._id,
            opId: snapshot.opId,
            amount: snapshot.amount,
            direction: snapshot.direction,
            sequence: snapshot.sequence,
          };
          throw ambiguousErr;
        }

        // If it was an ambiguous error and verification did NOT find the transaction:
        if (isAmbiguousWriteError(err)) {
          const uncertainErr = new Error(
            `Ambiguous write outcome: ledger write failed with ${err.name || err.message}. Compensation was aborted to protect financial consistency.`
          );
          uncertainErr.statusCode = 500;
          uncertainErr.isAmbiguous = true;
          uncertainErr.persistenceUncertain = true;
          uncertainErr.originalError = err;
          uncertainErr.discrepancy = {
            userId: wallet.userId,
            walletId: wallet._id,
            opId: snapshot.opId,
            amount: snapshot.amount,
            direction: snapshot.direction,
            sequence: snapshot.sequence,
          };
          throw uncertainErr;
        }
      }

      // Unhandled or non-duplicate ledger failure: snapshot remains in unsettledOperations for recovery
      const ledgerErr = new Error(`Ledger recording failed: ${err.message}`);
      ledgerErr.statusCode = err.code === 11000 ? 409 : 500;
      ledgerErr.code = err.code;
      ledgerErr.snapshot = snapshot;
      throw ledgerErr;
    }
  },

  /**
   * Settles an unsettled operation from the wallet document.
   * 
   * Atomically pulls the snapshot guarded by:
   *   - Exact opId, sequence, and fingerprint match
   *   - Exactly-one snapshot guard via $size of matching elements
   *   - Fails closed if duplicate snapshots exist
   */
  async _settleUnsettledOperation(wallet, snapshot, session = null) {
    const walletId = wallet._id || wallet;
    const userId = wallet.userId;
    if (!snapshot || !snapshot.opId || !snapshot.fingerprint) {
      return false;
    }

    const snapObj =
      snapshot && typeof snapshot.toObject === 'function' ? snapshot.toObject() : snapshot;

    // 1. Verify cryptographic HMAC fingerprint before settlement
    const isValid = verifyFingerprint(
      { ...snapObj, walletId, userId },
      snapObj.fingerprint
    );
    if (!isValid) {
      console.error(
        `CRITICAL: Settlement aborted for opId ${snapObj.opId}. Snapshot fingerprint verification failed.`
      );
      return false;
    }

    // 2. Atomic settlement with exactly-one matching element guard
    const filter = {
      _id: walletId,
      unsettledOperations: {
        $elemMatch: {
          opId: snapObj.opId,
          sequence: snapObj.sequence,
          fingerprint: snapObj.fingerprint,
        },
      },
      $expr: {
        $eq: [
          {
            $size: {
              $filter: {
                input: '$unsettledOperations',
                as: 'op',
                cond: { $eq: ['$$op.opId', snapObj.opId] },
              },
            },
          },
          1,
        ],
      },
    };

    const update = {
      $pull: {
        unsettledOperations: {
          opId: snapObj.opId,
          sequence: snapObj.sequence,
          fingerprint: snapObj.fingerprint,
        },
      },
    };

    const res = await Wallet.collection.updateOne(filter, update, session ? { session } : {});
    return res.modifiedCount === 1;
  },

  /**
   * Synchronizes User.coins cached representation using sequence-guarded monotonic update.
   */
  async _syncUserCoins(userId, balanceAfter, sequence, session = null) {
    const syncFilter = {
      _id: userId,
      $or: [
        { coinsWalletSequence: { $lt: sequence } },
        { coinsWalletSequence: { $exists: false } },
        { coinsWalletSequence: null },
        {
          $and: [
            { coinsWalletSequence: sequence },
            { coins: { $ne: balanceAfter } },
          ],
        },
      ],
    };

    const syncUpdate = {
      $set: {
        coins: balanceAfter,
        coinsWalletSequence: sequence,
      },
    };

    try {
      const res = await User.collection.updateOne(
        syncFilter,
        syncUpdate,
        session ? { session } : {}
      );
      return { synced: res.modifiedCount === 1, matched: res.matchedCount === 1 };
    } catch (syncErr) {
      console.error(`User.coins synchronization warning for user ${userId}:`, syncErr.message);
      return { synced: false, error: syncErr.message };
    }
  },

  /**
   * Credits coins to a user's wallet with database-enforced idempotency and atomic snapshotting.
   */
  async credit(userId, amount, options = {}) {
    const normalized = normalizeOperationInput(userId, amount, 'CREDIT', options);
    const { session = null } = options;

    // Fast-path: Check if this idempotencyKey / opId is already recorded in the ledger
    const existingTx = await WalletTransaction.findOne(
      {
        userId: normalized.userId,
        $or: [
          { opId: normalized.opId },
          ...(normalized.idempotencyKey ? [{ idempotencyKey: normalized.idempotencyKey }] : []),
        ],
      },
      null,
      session ? { session } : {}
    );

    if (existingTx) {
      const isSameAmount = existingTx.amount === normalized.amount;
      const isSameDirection = existingTx.direction === 'CREDIT';
      const isSameType = existingTx.type === normalized.type;

      if (isSameAmount && isSameDirection && isSameType) {
        const wallet = await Wallet.findById(existingTx.walletId, null, session ? { session } : {});
        // If an unsettled snapshot remained in the wallet, settle it idempotently
        if (wallet && Array.isArray(wallet.unsettledOperations)) {
          const snap = wallet.unsettledOperations.find((op) => op.opId === normalized.opId);
          if (snap) {
            await this._settleUnsettledOperation(wallet, snap, session);
          }
        }
        return {
          isDuplicate: true,
          transaction: existingTx,
          balanceBefore: existingTx.balanceBefore,
          balanceAfter: existingTx.balanceAfter,
          wallet,
        };
      }

      const error = new Error(
        `Idempotency key collision: key "${normalized.idempotencyKey || normalized.opId}" already used with different transaction parameters`
      );
      error.statusCode = 409;
      throw error;
    }

    // 1. Atomic wallet mutation (balance change + sequence advancement + snapshot append)
    const mutationResult = await this._mutateWalletAtomic({
      userId: normalized.userId,
      amount: normalized.amount,
      direction: 'CREDIT',
      type: normalized.type,
      referenceId: normalized.referenceId,
      idempotencyKey: normalized.idempotencyKey,
      opId: normalized.opId,
      description: normalized.description,
      metadata: normalized.metadata,
      session,
    });

    if (mutationResult.alreadyPersisted) {
      const finalWallet = await Wallet.findById(mutationResult.wallet._id, null, session ? { session } : {});
      return {
        isDuplicate: true,
        transaction: mutationResult.transaction,
        balanceBefore: mutationResult.transaction.balanceBefore,
        balanceAfter: mutationResult.transaction.balanceAfter,
        wallet: finalWallet || mutationResult.wallet,
      };
    }

    const { wallet: mutatedWallet, snapshot } = mutationResult;

    // 2. Ledger persistence
    const ledgerResult = await this._persistLedgerRecord(mutatedWallet, snapshot, {
      session,
      description: normalized.description,
      metadata: normalized.metadata,
    });

    const { transaction, isDuplicate } = ledgerResult;

    // 3. Exact snapshot settlement
    await this._settleUnsettledOperation(mutatedWallet, snapshot, session);

    // 4. Monotonic User.coins synchronization
    await this._syncUserCoins(normalized.userId, snapshot.balanceAfter, snapshot.sequence, session);

    // Fetch updated wallet representation for return contract
    const finalWallet = await Wallet.findById(mutatedWallet._id, null, session ? { session } : {});

    return {
      isDuplicate,
      transaction,
      balanceBefore: snapshot.balanceBefore,
      balanceAfter: snapshot.balanceAfter,
      wallet: finalWallet || mutatedWallet,
    };
  },

  /**
   * Debits coins from a user's wallet with atomic balance check, idempotency, and snapshotting.
   */
  async debit(userId, amount, options = {}) {
    const normalized = normalizeOperationInput(userId, amount, 'DEBIT', options);
    const { session = null } = options;

    // Fast-path: Check if this idempotencyKey / opId is already recorded in the ledger
    const existingTx = await WalletTransaction.findOne(
      {
        userId: normalized.userId,
        $or: [
          { opId: normalized.opId },
          ...(normalized.idempotencyKey ? [{ idempotencyKey: normalized.idempotencyKey }] : []),
        ],
      },
      null,
      session ? { session } : {}
    );

    if (existingTx) {
      const isSameAmount = existingTx.amount === normalized.amount;
      const isSameDirection = existingTx.direction === 'DEBIT';
      const isSameType = existingTx.type === normalized.type;

      if (isSameAmount && isSameDirection && isSameType) {
        const wallet = await Wallet.findById(existingTx.walletId, null, session ? { session } : {});
        // If an unsettled snapshot remained in the wallet, settle it idempotently
        if (wallet && Array.isArray(wallet.unsettledOperations)) {
          const snap = wallet.unsettledOperations.find((op) => op.opId === normalized.opId);
          if (snap) {
            await this._settleUnsettledOperation(wallet, snap, session);
          }
        }
        return {
          isDuplicate: true,
          transaction: existingTx,
          balanceBefore: existingTx.balanceBefore,
          balanceAfter: existingTx.balanceAfter,
          wallet,
        };
      }

      const error = new Error(
        `Idempotency key collision: key "${normalized.idempotencyKey || normalized.opId}" already used with different transaction parameters`
      );
      error.statusCode = 409;
      throw error;
    }

    // 1. Atomic wallet mutation (balance change + sequence advancement + snapshot append)
    const mutationResult = await this._mutateWalletAtomic({
      userId: normalized.userId,
      amount: normalized.amount,
      direction: 'DEBIT',
      type: normalized.type,
      referenceId: normalized.referenceId,
      idempotencyKey: normalized.idempotencyKey,
      opId: normalized.opId,
      description: normalized.description,
      metadata: normalized.metadata,
      session,
    });

    if (mutationResult.alreadyPersisted) {
      const finalWallet = await Wallet.findById(mutationResult.wallet._id, null, session ? { session } : {});
      return {
        isDuplicate: true,
        transaction: mutationResult.transaction,
        balanceBefore: mutationResult.transaction.balanceBefore,
        balanceAfter: mutationResult.transaction.balanceAfter,
        wallet: finalWallet || mutationResult.wallet,
      };
    }

    const { wallet: mutatedWallet, snapshot } = mutationResult;

    // 2. Ledger persistence
    const ledgerResult = await this._persistLedgerRecord(mutatedWallet, snapshot, {
      session,
      description: normalized.description,
      metadata: normalized.metadata,
    });

    const { transaction, isDuplicate } = ledgerResult;

    // 3. Exact snapshot settlement
    await this._settleUnsettledOperation(mutatedWallet, snapshot, session);

    // 4. Monotonic User.coins synchronization
    await this._syncUserCoins(normalized.userId, snapshot.balanceAfter, snapshot.sequence, session);

    // Fetch updated wallet representation for return contract
    const finalWallet = await Wallet.findById(mutatedWallet._id, null, session ? { session } : {});

    return {
      isDuplicate,
      transaction,
      balanceBefore: snapshot.balanceBefore,
      balanceAfter: snapshot.balanceAfter,
      wallet: finalWallet || mutatedWallet,
    };
  },

  /**
   * Returns authoritative wallet summary for a user.
   */
  async getWalletSummary(userId) {
    const wallet = await this.getOrCreateWallet(userId);
    // Active read-time healing: ensure User.coins cache is synchronized with authoritative balance
    await this._syncUserCoins(wallet.userId, wallet.balance, wallet.sequence ?? 0);

    return {
      walletId: wallet._id,
      userId: wallet.userId,
      balance: wallet.balance,
      currency: wallet.currency,
      isActive: wallet.isActive,
      sequence: wallet.sequence,
      unsettledCount: wallet.unsettledOperations?.length || 0,
      updatedAt: wallet.updatedAt,
    };
  },

  /**
   * Returns paginated transaction history for a user.
   */
  async getTransactionHistory(userId, options = {}) {
    await this.getOrCreateWallet(userId);

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = { userId: new mongoose.Types.ObjectId(userId) };
    if (options.type && typeof options.type === 'string' && options.type.trim() !== '' && options.type.trim().toUpperCase() !== 'ALL') {
      query.type = options.type.trim().toUpperCase();
    }
    if (options.direction && typeof options.direction === 'string' && options.direction.trim() !== '' && options.direction.trim().toUpperCase() !== 'ALL') {
      query.direction = options.direction.trim().toUpperCase();
    }

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(query),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },
};

export default walletService;
