/**
 * server/test/standalone_scripts_target_isolation.test.js
 * 
 * Safety & Isolation Suite for Standalone API Integration Test Scripts:
 *   - Verifies all 7 standalone scripts enforce pre-connection test target validation.
 *   - Confirms production, Atlas, staging, and non-test targets are strictly rejected.
 *   - Confirms database connection is NEVER attempted if target validation fails.
 *   - Confirms approved local test database targets succeed.
 *   - 100% in-memory execution; ZERO network traffic, ZERO live database access.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateTestTarget,
  assertValidTestTarget,
  TEST_TARGET_ERROR_CODES,
} from '../src/utils/validateTestTarget.js';

import { runEconomyTests } from '../test-wallet-api.js';
import { runAllTests } from '../test-game-session-api.js';
import { runInventoryTestSuite } from '../test-inventory-api.js';
import { runLevelApiTests } from '../test-level-api.js';
import { runRewardedAdTests } from '../test-rewarded-ads-api.js';
import { runPasswordTests } from '../test-user-password.js';
import { runPurchaseApiTests } from '../test-wallet-purchase-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const STANDALONE_SCRIPTS = [
  { name: 'test-wallet-api.js', runner: runEconomyTests },
  { name: 'test-game-session-api.js', runner: runAllTests },
  { name: 'test-inventory-api.js', runner: runInventoryTestSuite },
  { name: 'test-level-api.js', runner: runLevelApiTests },
  { name: 'test-rewarded-ads-api.js', runner: runRewardedAdTests },
  { name: 'test-user-password.js', runner: runPasswordTests },
  { name: 'test-wallet-purchase-api.js', runner: runPurchaseApiTests },
];

describe('Standalone Scripts Database Target Safety Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TEST_MONGODB_URI;
    delete process.env.MONGODB_TEST_URI;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exitCode = 0;
  });

  // =========================================================================
  // Section 1: Source Code Static Invariant Verification
  // =========================================================================
  describe('Section 1: Static Source Code Invariant Verification', () => {
    for (const script of STANDALONE_SCRIPTS) {
      it(`1.1 ${script.name} does not reference production MONGODB_URI`, () => {
        const filePath = path.join(serverRoot, script.name);
        const content = fs.readFileSync(filePath, 'utf8');

        // Must NOT read process.env.MONGODB_URI
        assert.strictEqual(
          /process\.env\.MONGODB_URI\b/.test(content),
          false,
          `${script.name} must not access process.env.MONGODB_URI`
        );

        // Must import assertValidTestTarget
        assert.ok(
          content.includes('assertValidTestTarget'),
          `${script.name} must import assertValidTestTarget`
        );
      });
    }
  });

  // =========================================================================
  // Section 2: Fail-Closed When TEST_MONGODB_URI is Missing
  // =========================================================================
  describe('Section 2: Pre-Connection Rejection of Missing Test Targets', () => {
    for (const script of STANDALONE_SCRIPTS) {
      it(`2.1 ${script.name} fails closed before connect when TEST_MONGODB_URI is omitted`, async () => {
        let connectCalled = false;
        const mockConnect = async () => {
          connectCalled = true;
        };

        await assert.rejects(
          async () => {
            await script.runner({
              connect: mockConnect,
              mongoUri: undefined,
            });
          },
          (err) => {
            assert.match(err.message, /\[TEST_TARGET_VALIDATION_FAILED\] MISSING_TEST_MONGODB_URI/);
            return true;
          }
        );

        assert.strictEqual(
          connectCalled,
          false,
          `connect() must NEVER be called when target validation fails in ${script.name}`
        );
      });
    }
  });

  // =========================================================================
  // Section 3: Pre-Connection Rejection of Atlas & Remote Hosts
  // =========================================================================
  describe('Section 3: Pre-Connection Rejection of Remote/Atlas Targets', () => {
    const forbiddenRemoteUris = [
      'mongodb://cluster0.test.mongodb.net:27017/apple_worm_test',
      'mongodb+srv://atlas-tester.mongodb.net/apple_worm_adventure_test',
      'mongodb://192.168.1.50:27017/apple_worm_test',
    ];

    for (const script of STANDALONE_SCRIPTS) {
      for (const remoteUri of forbiddenRemoteUris) {
        it(`3.1 ${script.name} rejects remote target "${remoteUri.split('@').pop()}" before connection`, async () => {
          let connectCalled = false;
          const mockConnect = async () => {
            connectCalled = true;
          };

          await assert.rejects(
            async () => {
              await script.runner({
                connect: mockConnect,
                mongoUri: remoteUri,
              });
            },
            (err) => {
              assert.match(err.message, /\[TEST_TARGET_VALIDATION_FAILED\] UNAPPROVED_TEST_HOST/);
              return true;
            }
          );

          assert.strictEqual(
            connectCalled,
            false,
            `connect() must NEVER be called for remote hosts in ${script.name}`
          );
        });
      }
    }
  });

  // =========================================================================
  // Section 4: Pre-Connection Rejection of Production & Staging DB Names
  // =========================================================================
  describe('Section 4: Pre-Connection Rejection of Production & Staging Databases', () => {
    const forbiddenDbUris = [
      { uri: 'mongodb://127.0.0.1:27017/apple_worm_adventure', code: 'PRODUCTION_TARGET_REJECTED' },
      { uri: 'mongodb://127.0.0.1:27017/apple_worm_prod', code: 'PRODUCTION_TARGET_REJECTED' },
      { uri: 'mongodb://127.0.0.1:27017/production', code: 'PRODUCTION_TARGET_REJECTED' },
      { uri: 'mongodb://127.0.0.1:27017/apple_worm_staging', code: 'STAGING_TARGET_REJECTED' },
      { uri: 'mongodb://127.0.0.1:27017/staging', code: 'STAGING_TARGET_REJECTED' },
      { uri: 'mongodb://127.0.0.1:27017/unapproved_db_name', code: 'UNAPPROVED_TEST_DB_NAME' },
    ];

    for (const script of STANDALONE_SCRIPTS) {
      for (const item of forbiddenDbUris) {
        it(`4.1 ${script.name} rejects "${item.uri.split('/').pop()}" (${item.code}) before connection`, async () => {
          let connectCalled = false;
          const mockConnect = async () => {
            connectCalled = true;
          };

          await assert.rejects(
            async () => {
              await script.runner({
                connect: mockConnect,
                mongoUri: item.uri,
              });
            },
            (err) => {
              assert.match(err.message, new RegExp(item.code));
              return true;
            }
          );

          assert.strictEqual(
            connectCalled,
            false,
            `connect() must NEVER be called when database name is forbidden in ${script.name}`
          );
        });
      }
    }
  });

  // =========================================================================
  // Section 5: Acceptance of Approved Local Test Targets
  // =========================================================================
  describe('Section 5: Acceptance of Approved Local Test Targets', () => {
    const approvedTestUris = [
      'mongodb://127.0.0.1:27017/apple_worm_adventure_test',
      'mongodb://localhost:27017/apple_worm_test',
      'mongodb://[::1]:27017/isolated_suite_test',
    ];

    for (const script of STANDALONE_SCRIPTS) {
      for (const approvedUri of approvedTestUris) {
        it(`5.1 ${script.name} validates and accepts approved test target "${approvedUri}"`, async () => {
          let connectCalled = false;
          const mockConnect = async () => {
            connectCalled = true;
          };

          const res = await script.runner({
            connect: mockConnect,
            mongoUri: approvedUri,
            validateOnly: true,
          });

          assert.strictEqual(res.validated, true, `${script.name} must return validated: true`);
          assert.strictEqual(res.targetUri, approvedUri, `${script.name} must return matching target URI`);
          assert.strictEqual(connectCalled, false, `connect() must not be called when validateOnly is true`);
        });
      }
    }
  });
});
