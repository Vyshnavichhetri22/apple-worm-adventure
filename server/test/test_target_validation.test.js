/**
 * server/test/test_target_validation.test.js
 * 
 * Isolated Safety & Target Validation Suite for Test Database Isolation:
 *   - Verifies fail-closed behavior of validateTestTarget and assertValidTestTarget.
 *   - 100% in-memory execution; ZERO database connections, ZERO network traffic.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTestTarget,
  assertValidTestTarget,
  TEST_TARGET_ERROR_CODES,
} from '../src/utils/validateTestTarget.js';

describe('Test Database Isolation & Target Validation Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // Part 1: Missing & Malformed Test URI Handling
  // =========================================================================
  describe('Part 1: Missing & Malformed Test URI Handling', () => {
    it('1.1 Fails closed when TEST_MONGODB_URI is undefined or omitted', () => {
      delete process.env.TEST_MONGODB_URI;
      const res = validateTestTarget();
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.MISSING_TEST_MONGODB_URI);
      assert.match(res.error, /TEST_MONGODB_URI is required/);
    });

    it('1.2 Fails closed when TEST_MONGODB_URI is empty or whitespace only', () => {
      const res1 = validateTestTarget('');
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.code, TEST_TARGET_ERROR_CODES.MISSING_TEST_MONGODB_URI);

      const res2 = validateTestTarget('   ');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.code, TEST_TARGET_ERROR_CODES.MISSING_TEST_MONGODB_URI);
    });

    it('1.3 Fails closed on malformed URI protocol', () => {
      const res = validateTestTarget('http://127.0.0.1:27017/apple_worm_test');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.MALFORMED_TEST_MONGODB_URI);
    });

    it('1.4 Fails closed when database name is omitted in URI', () => {
      const res = validateTestTarget('mongodb://127.0.0.1:27017/');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.MISSING_TEST_DB_NAME);
    });
  });

  // =========================================================================
  // Part 2: Production Target Categorical Rejection
  // =========================================================================
  describe('Part 2: Production Target Categorical Rejection', () => {
    it('2.1 Categorically rejects production database names', () => {
      const prodDbNames = [
        'apple_worm_adventure',
        'apple_worm_prod',
        'apple_worm_adventure_prod',
        'apple_worm_adventure_production',
        'production',
        'prod',
      ];

      for (const dbName of prodDbNames) {
        const uri = `mongodb://127.0.0.1:27017/${dbName}`;
        const res = validateTestTarget(uri);
        assert.strictEqual(res.valid, false, `Database "${dbName}" must be rejected`);
        assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.PRODUCTION_TARGET_REJECTED);
        assert.match(res.error, /Production database target .* is strictly forbidden/);
      }
    });
  });

  // =========================================================================
  // Part 3: Staging Target Categorical Rejection
  // =========================================================================
  describe('Part 3: Staging Target Categorical Rejection', () => {
    it('3.1 Categorically rejects staging database names', () => {
      const stagingDbNames = [
        'apple_worm_staging',
        'staging',
        'apple_worm_stage',
        'my_staging_db',
      ];

      for (const dbName of stagingDbNames) {
        const uri = `mongodb://127.0.0.1:27017/${dbName}`;
        const res = validateTestTarget(uri);
        assert.strictEqual(res.valid, false, `Database "${dbName}" must be rejected`);
        assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.STAGING_TARGET_REJECTED);
        assert.match(res.error, /Staging database target .* is strictly forbidden/);
      }
    });
  });

  // =========================================================================
  // Part 4: Unapproved Database Name Rejection
  // =========================================================================
  describe('Part 4: Unapproved Database Name Rejection', () => {
    it('4.1 Rejects database names that do not contain "test"', () => {
      const unapprovedNames = ['customer_records', 'dev_data', 'default_db', 'users_store'];

      for (const dbName of unapprovedNames) {
        const uri = `mongodb://127.0.0.1:27017/${dbName}`;
        const res = validateTestTarget(uri);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.UNAPPROVED_TEST_DB_NAME);
        assert.match(res.error, /not an approved test database name/);
      }
    });
  });

  // =========================================================================
  // Part 5: Host Allowlist (Local Loopback Only)
  // =========================================================================
  describe('Part 5: Host Allowlist (Local Loopback Only)', () => {
    it('5.1 Categorically rejects remote hosts and external clusters', () => {
      const remoteUris = [
        'mongodb://cluster0.staging.mongodb.net:27017/apple_worm_test',
        'mongodb://atlas-prod.mongodb.net:27017/apple_worm_test',
        'mongodb://192.168.1.100:27017/apple_worm_test',
        'mongodb://database.internal.corp:27017/apple_worm_test',
      ];

      for (const uri of remoteUris) {
        const res = validateTestTarget(uri);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.code, TEST_TARGET_ERROR_CODES.UNAPPROVED_TEST_HOST);
        assert.match(res.error, /not an approved local test host/);
      }
    });

    it('5.2 Accepts approved local loopback hosts (127.0.0.1, localhost, [::1])', () => {
      const validUris = [
        'mongodb://127.0.0.1:27017/apple_worm_test',
        'mongodb://localhost:27017/apple_worm_adventure_test',
        'mongodb://[::1]:27017/apple_worm_isolated_controls_test',
      ];

      for (const uri of validUris) {
        const res = validateTestTarget(uri);
        assert.strictEqual(res.valid, true, `URI "${uri}" should be accepted`);
        assert.strictEqual(res.code, 'TEST_TARGET_VALIDATED');
        assert.ok(res.target.dbName.includes('test'));
      }
    });
  });

  // =========================================================================
  // Part 6: Credential Redaction & Safety Guarantees
  // =========================================================================
  describe('Part 6: Credential Redaction & Safety Guarantees', () => {
    it('6.1 Strips sensitive user/password credentials from target metadata', () => {
      const raw = 'mongodb://app_test_user:superSecretPassword123%21@127.0.0.1:27017/apple_worm_test';
      const res = validateTestTarget(raw);

      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.target.redactedUri, 'mongodb://***:***@127.0.0.1:27017/apple_worm_test');
      assert.strictEqual(res.target.redactedUri.includes('superSecretPassword123'), false);
      assert.strictEqual(res.target.redactedUri.includes('app_test_user'), false);
    });
  });

  // =========================================================================
  // Part 7: Fail-Before-Connection Behavior
  // =========================================================================
  describe('Part 7: Fail-Before-Connection Behavior', () => {
    it('7.1 assertValidTestTarget throws immediately on unapproved targets', () => {
      assert.throws(
        () => assertValidTestTarget('mongodb://atlas.mongodb.net:27017/apple_worm_test'),
        (err) => {
          assert.match(err.message, /\[TEST_TARGET_VALIDATION_FAILED\] UNAPPROVED_TEST_HOST/);
          return true;
        }
      );

      assert.throws(
        () => assertValidTestTarget('mongodb://127.0.0.1:27017/apple_worm_staging'),
        (err) => {
          assert.match(err.message, /\[TEST_TARGET_VALIDATION_FAILED\] STAGING_TARGET_REJECTED/);
          return true;
        }
      );

      assert.throws(
        () => assertValidTestTarget(undefined),
        (err) => {
          assert.match(err.message, /\[TEST_TARGET_VALIDATION_FAILED\] MISSING_TEST_MONGODB_URI/);
          return true;
        }
      );
    });

    it('7.2 assertValidTestTarget returns validated target on valid local test URI', () => {
      const target = assertValidTestTarget('mongodb://127.0.0.1:27017/apple_worm_test');
      assert.strictEqual(target.dbName, 'apple_worm_test');
      assert.strictEqual(target.redactedUri, 'mongodb://127.0.0.1:27017/apple_worm_test');
    });
  });

  // =========================================================================
  // Part 8: Cleanup Safety Invariant Simulation
  // =========================================================================
  describe('Part 8: Cleanup Safety Invariant Simulation', () => {
    it('8.1 Guard function rejects cleanup if active connection is not a verified test DB', () => {
      function safeCleanupGuard(activeDbName) {
        const validation = validateTestTarget(`mongodb://127.0.0.1:27017/${activeDbName}`);
        if (!validation.valid) {
          throw new Error(`Safety guard aborted cleanup: database "${activeDbName}" is not an approved test database.`);
        }
        return true;
      }

      assert.strictEqual(safeCleanupGuard('apple_worm_test'), true);
      assert.strictEqual(safeCleanupGuard('apple_worm_adventure_test'), true);

      assert.throws(
        () => safeCleanupGuard('apple_worm_adventure'),
        /Safety guard aborted cleanup/
      );
      assert.throws(
        () => safeCleanupGuard('apple_worm_staging'),
        /Safety guard aborted cleanup/
      );
    });
  });
});
