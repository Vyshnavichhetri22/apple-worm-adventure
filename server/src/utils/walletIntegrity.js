/**
 * server/src/utils/walletIntegrity.js
 * 
 * Cryptographic and canonical integrity utilities for wallet operations:
 *   - Canonical operation input normalization
 *   - Deterministic canonical opId derivation
 *   - Deterministic canonical payload serialization
 *   - Keyed HMAC-SHA-256 fingerprinting with versioning and key rotation
 *   - Constant-time timing-safe fingerprint verification
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { TRANSACTION_TYPES, TRANSACTION_DIRECTIONS } from '../models/WalletTransaction.js';

export const FINGERPRINT_VERSION = 1;
export const MAX_UNSETTLED_OPERATIONS = 100;
export const DEFAULT_KEY_VERSION = 'v1';

/**
 * Retrieves the integrity secret for HMAC computation and verification.
 * 
 * Rules:
 *   - In production (NODE_ENV === 'production'):
 *     WALLET_INTEGRITY_SECRET is strictly mandatory and must be at least 32 characters long.
 *   - In non-production (development, test):
 *     If WALLET_INTEGRITY_SECRET is not configured, falls back to a safe static dev secret.
 *   - Machine-derived secrets are strictly forbidden for persistent authentication tags.
 *   - Supports key rotation via WALLET_INTEGRITY_SECRET_PREVIOUS when keyVersion is rotated.
 */
export function getIntegritySecret(keyVersion = DEFAULT_KEY_VERSION) {
  const isProd = process.env.NODE_ENV === 'production';
  const primarySecret = process.env.WALLET_INTEGRITY_SECRET;
  const previousSecret = process.env.WALLET_INTEGRITY_SECRET_PREVIOUS;

  if (keyVersion === 'v1_prev' && previousSecret) {
    return previousSecret;
  }

  if (isProd) {
    if (!primarySecret || typeof primarySecret !== 'string' || primarySecret.length < 32) {
      throw new Error(
        'CRITICAL CONFIGURATION ERROR: WALLET_INTEGRITY_SECRET must be configured and at least 32 characters long in production.'
      );
    }
    return primarySecret;
  }

  // Non-production fallback
  if (primarySecret && typeof primarySecret === 'string' && primarySecret.length >= 16) {
    return primarySecret;
  }

  return 'apple_worm_dev_wallet_integrity_secret_32_characters_minimum';
}

/**
 * Normalizes and validates incoming operation inputs before execution.
 * Returns a clean, normalized parameter object or throws 400.
 */
export function normalizeOperationInput(userId, amount, direction, options = {}) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid userId format');
    error.statusCode = 400;
    throw error;
  }
  const normalizedUserId = new mongoose.Types.ObjectId(userId);

  // 2. Validate amount: strictly positive safe integer
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amount)
  ) {
    const error = new Error(
      `${direction === 'CREDIT' ? 'Credit' : 'Debit'} amount must be a positive safe integer (received: ${amount})`
    );
    error.statusCode = 400;
    throw error;
  }

  // 3. Validate direction
  if (!TRANSACTION_DIRECTIONS.includes(direction)) {
    const error = new Error(`Invalid transaction direction: ${direction}`);
    error.statusCode = 400;
    throw error;
  }

  // 4. Validate type
  const type = options.type || (direction === 'CREDIT' ? 'BONUS' : 'HINT_PURCHASE');
  if (!TRANSACTION_TYPES.includes(type)) {
    const error = new Error(`Invalid transaction type: ${type}`);
    error.statusCode = 400;
    throw error;
  }

  // 5. Normalize strings: trim and map empty/whitespace-only to null
  const normalizeString = (str) => {
    if (str === null || str === undefined) return null;
    if (typeof str !== 'string') return String(str).trim() || null;
    const trimmed = str.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const referenceId = normalizeString(options.referenceId);
  const idempotencyKey = normalizeString(options.idempotencyKey);
  const rawOpId = normalizeString(options.opId);

  // 6. Derive stable canonical opId across retries
  const opId = deriveCanonicalOpId(normalizedUserId, idempotencyKey, rawOpId);

  // 7. Normalize description (max 200 chars)
  let description =
    normalizeString(options.description) ||
    (direction === 'CREDIT' ? 'Coin credit' : 'Coin debit');
  if (description.length > 200) {
    description = description.slice(0, 200);
  }

  // 8. Normalize metadata
  const metadata =
    options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata)
      ? options.metadata
      : {};

  return {
    userId: normalizedUserId,
    amount,
    direction,
    type,
    referenceId,
    idempotencyKey,
    opId,
    description,
    metadata,
  };
}

/**
 * Derives a deterministic, canonical operation ID (opId).
 * 
 * Rules:
 *   - If opId is explicitly supplied, validate and return it.
 *   - If idempotencyKey is supplied without opId, deterministically derive stable opId
 *     from userId and idempotencyKey: `op_idem_${sha256(userId:idempotencyKey).slice(0, 32)}`.
 *     This ensures identical retries generate the exact same opId!
 *   - If neither is provided, generate a unique random opId: `op_rnd_${randomUUID()}`.
 */
export function deriveCanonicalOpId(userId, idempotencyKey, explicitOpId = null) {
  if (explicitOpId && typeof explicitOpId === 'string' && explicitOpId.trim().length > 0) {
    return explicitOpId.trim();
  }

  if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
    const key = `${userId.toString()}:${idempotencyKey.trim()}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    return `op_idem_${hash}`;
  }

  return `op_rnd_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Builds the canonical deterministic payload array for HMAC fingerprinting.
 * Order and types are strictly fixed:
 * [version, userId, walletId, opId, amount, direction, type, referenceId, idempotencyKey, sequence, balanceBefore, balanceAfter]
 */
export function buildCanonicalFingerprintPayload(data) {
  const {
    version = FINGERPRINT_VERSION,
    userId,
    walletId,
    opId,
    amount,
    direction,
    type,
    referenceId = null,
    idempotencyKey = null,
    sequence,
    balanceBefore,
    balanceAfter,
  } = data;

  return [
    Number(version),
    userId?.toString?.() || String(userId),
    walletId?.toString?.() || String(walletId),
    String(opId),
    Number(amount),
    String(direction),
    String(type),
    referenceId !== null && referenceId !== undefined ? String(referenceId) : null,
    idempotencyKey !== null && idempotencyKey !== undefined ? String(idempotencyKey) : null,
    Number(sequence),
    Number(balanceBefore),
    Number(balanceAfter),
  ];
}

/**
 * Computes an HMAC-SHA-256 fingerprint for a canonical operation payload.
 * Returns formatted fingerprint: `v1:<hex>`
 */
export function generateFingerprint(data, secretOverride = null) {
  const secret = secretOverride || getIntegritySecret('v1');
  const payloadArray = buildCanonicalFingerprintPayload(data);
  const serialized = JSON.stringify(payloadArray);

  const hmac = crypto.createHmac('sha256', secret).update(serialized).digest('hex');
  return `v1:${hmac}`;
}

/**
 * Verifies an HMAC-SHA-256 fingerprint against an operation payload.
 * Uses constant-time comparison (crypto.timingSafeEqual).
 * Supports active secret and previous secret (for rotation).
 */
export function verifyFingerprint(data, fingerprint, secretOverride = null) {
  if (!fingerprint || typeof fingerprint !== 'string' || !fingerprint.startsWith('v1:')) {
    return false;
  }

  const expectedHex = fingerprint.slice(3);
  if (expectedHex.length !== 64) {
    return false;
  }

  const payloadArray = buildCanonicalFingerprintPayload(data);
  const serialized = JSON.stringify(payloadArray);

  // 1. Verify with primary secret
  const primarySecret = secretOverride || getIntegritySecret('v1');
  const primaryComputedHex = crypto
    .createHmac('sha256', primarySecret)
    .update(serialized)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const primaryBuf = Buffer.from(primaryComputedHex, 'hex');

  if (expectedBuf.length === primaryBuf.length && crypto.timingSafeEqual(expectedBuf, primaryBuf)) {
    return true;
  }

  // 2. Verify with previous secret if rotation is active
  if (!secretOverride && process.env.WALLET_INTEGRITY_SECRET_PREVIOUS) {
    try {
      const prevSecret = getIntegritySecret('v1_prev');
      const prevComputedHex = crypto
        .createHmac('sha256', prevSecret)
        .update(serialized)
        .digest('hex');
      const prevBuf = Buffer.from(prevComputedHex, 'hex');
      if (expectedBuf.length === prevBuf.length && crypto.timingSafeEqual(expectedBuf, prevBuf)) {
        return true;
      }
    } catch {
      // Ignore previous secret error and return false
    }
  }

  return false;
}
