/**
 * server/src/utils/validateTestTarget.js
 * 
 * Fail-closed database target validation for integration and test suites.
 * Ensures tests can ONLY connect to local standalone test databases and
 * categorically rejects production, staging, and remote clusters.
 * 
 * Safety invariants:
 *   - Strictly fails closed if TEST_MONGODB_URI is missing or empty.
 *   - Never falls back to MONGODB_URI.
 *   - Strictly rejects any production or staging database name or host.
 *   - Requires target hosts to be local loopback only (localhost, 127.0.0.1, ::1).
 *   - Requires target database name to end with '_test' or contain 'test' without prod/staging substrings.
 *   - Strips credentials from all returned target metadata and error messages.
 *   - Pure in-memory execution with zero network and zero database access.
 */

import { parseMongoUri, redactMongoUri } from './validateMigrationTarget.js';

export const TEST_TARGET_ERROR_CODES = {
  MISSING_TEST_MONGODB_URI: 'MISSING_TEST_MONGODB_URI',
  MALFORMED_TEST_MONGODB_URI: 'MALFORMED_TEST_MONGODB_URI',
  MISSING_TEST_DB_NAME: 'MISSING_TEST_DB_NAME',
  PRODUCTION_TARGET_REJECTED: 'PRODUCTION_TARGET_REJECTED',
  STAGING_TARGET_REJECTED: 'STAGING_TARGET_REJECTED',
  UNAPPROVED_TEST_DB_NAME: 'UNAPPROVED_TEST_DB_NAME',
  UNAPPROVED_TEST_HOST: 'UNAPPROVED_TEST_HOST',
};

const APPROVED_LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function validateTestTarget(...args) {
  const mongoUri = args.length > 0 ? args[0] : process.env.TEST_MONGODB_URI;
  // Gate 1: Fail closed if test URI is missing or empty
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim().length === 0) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.MISSING_TEST_MONGODB_URI,
      error: 'TEST_MONGODB_URI is required and cannot be empty. Tests must not connect without explicit test target configuration.',
    };
  }

  // Gate 2: Parse URI safely
  const parsed = parseMongoUri(mongoUri);
  if (!parsed.valid) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.MALFORMED_TEST_MONGODB_URI,
      error: `Malformed test MongoDB URI: ${parsed.error}`,
    };
  }

  // Gate 3: Check database name presence
  if (!parsed.dbName || parsed.dbName.trim().length === 0) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.MISSING_TEST_DB_NAME,
      error: 'Test MongoDB URI must specify an explicit database name (e.g. mongodb://127.0.0.1:27017/apple_worm_test).',
    };
  }

  const actualDbName = parsed.dbName.trim().toLowerCase();

  // Gate 4: Production Target Rejection
  if (
    actualDbName === 'apple_worm_adventure' ||
    actualDbName === 'apple_worm_prod' ||
    actualDbName === 'apple_worm_adventure_prod' ||
    actualDbName === 'apple_worm_adventure_production' ||
    actualDbName === 'production' ||
    actualDbName === 'prod' ||
    actualDbName.includes('prod') ||
    actualDbName.includes('production')
  ) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.PRODUCTION_TARGET_REJECTED,
      error: `Production database target "${parsed.dbName}" is strictly forbidden in test suites.`,
    };
  }

  // Gate 5: Staging Target Rejection
  if (
    actualDbName === 'apple_worm_staging' ||
    actualDbName === 'staging' ||
    actualDbName.includes('staging') ||
    actualDbName.includes('stage')
  ) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.STAGING_TARGET_REJECTED,
      error: `Staging database target "${parsed.dbName}" is strictly forbidden in test suites.`,
    };
  }

  // Gate 6: Approved Test Database Name Verification
  const isApprovedTestDb =
    actualDbName.endsWith('_test') ||
    actualDbName.startsWith('test_') ||
    actualDbName.includes('test');

  if (!isApprovedTestDb) {
    return {
      valid: false,
      code: TEST_TARGET_ERROR_CODES.UNAPPROVED_TEST_DB_NAME,
      error: `Target database name "${parsed.dbName}" is not an approved test database name. Test database names must contain "test".`,
    };
  }

  // Gate 7: Host Allowlist Verification (Local Loopback Only)
  for (let i = 0; i < parsed.hostnames.length; i++) {
    const hostname = parsed.hostnames[i].toLowerCase();
    if (!APPROVED_LOCAL_HOSTNAMES.has(hostname)) {
      return {
        valid: false,
        code: TEST_TARGET_ERROR_CODES.UNAPPROVED_TEST_HOST,
        error: `Host "${parsed.hosts[i]}" in test MongoDB URI is not an approved local test host (allowed: localhost, 127.0.0.1, ::1). Target rejected.`,
      };
    }
  }

  // All gates passed
  return {
    valid: true,
    code: 'TEST_TARGET_VALIDATED',
    target: {
      protocol: parsed.protocol,
      hosts: parsed.hosts,
      hostnames: parsed.hostnames,
      dbName: parsed.dbName.trim(),
      redactedUri: parsed.redactedUri,
    },
  };
}

export function assertValidTestTarget(...args) {
  const mongoUri = args.length > 0 ? args[0] : process.env.TEST_MONGODB_URI;
  const result = validateTestTarget(mongoUri);
  if (!result.valid) {
    throw new Error(`[TEST_TARGET_VALIDATION_FAILED] ${result.code}: ${result.error}`);
  }
  return result.target;
}

export default validateTestTarget;
