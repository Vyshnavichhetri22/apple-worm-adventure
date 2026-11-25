/**
 * server/test/seed_target_validation.test.js
 * 
 * Isolated Unit and Safety Suite for Seed Scripts Target Validation & CLI Hardening:
 *   - server/seed-levels.js
 *   - server/verify-seeded-levels.js
 * 
 * Safety invariants:
 *   - 100% in-memory isolated execution.
 *   - ZERO database connections, ZERO network calls.
 *   - Uses mocks and test doubles to verify dry-run, --apply, and target safety gates.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { runSeedLevelsRunner } from '../seed-levels.js';
import { runVerifySeededLevelsRunner } from '../verify-seeded-levels.js';

describe('Seed Scripts Target Safety & CLI Hardening Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to clean test environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function setupMockSeedContext(options = {}) {
    let connectCalled = false;
    let disconnectCalled = false;
    let savedDocs = [];
    const mockExistingLevels = options.existingLevels || [];

    const mockConnection = {
      readyState: 0,
      name: 'apple_worm_staging',
      db: {
        databaseName: 'apple_worm_staging',
      },
    };

    // Mock Level model
    class MockLevelModel {
      constructor(data) {
        Object.assign(this, data);
      }

      async validate() {
        if (options.failValidation) {
          throw new Error('Simulated schema validation error');
        }
        return true;
      }

      async save() {
        if (options.failSave) {
          throw new Error('Simulated document save error');
        }
        savedDocs.push({ ...this });
        return this;
      }

      static find(query = {}, projection = {}) {
        return {
          sort: () => ({
            lean: async () => mockExistingLevels,
          }),
          lean: async () => mockExistingLevels,
        };
      }

      static async findOne(query = {}) {
        return {
          lean: async () => {
            return mockExistingLevels.find((lvl) => lvl.levelNumber === query.levelNumber) || null;
          },
        };
      }
    }

    const deps = {
      fileExists: options.fileExists !== undefined ? options.fileExists : () => true,
      loadEnv: options.loadEnv || (() => {}),
      connect: async () => {
        connectCalled = true;
        mockConnection.readyState = 1;
      },
      disconnect: async () => {
        disconnectCalled = true;
        mockConnection.readyState = 0;
      },
      getConnection: () => mockConnection,
      LevelModel: MockLevelModel,
      validatePlayability: options.validatePlayability || (() => ({ isValid: true, details: { statesExplored: 10 } })),
      levelsData: options.levelsData || [
        { levelNumber: 1, difficulty: 'tutorial', grid: { rows: 6, cols: 6 }, wormStart: { x: 2, y: 1 }, portal: { x: 4, y: 4 }, moveLimit: 20 },
        { levelNumber: 2, difficulty: 'tutorial', grid: { rows: 6, cols: 6 }, wormStart: { x: 2, y: 1 }, portal: { x: 4, y: 4 }, moveLimit: 20 },
      ],
    };

    return {
      deps,
      wasConnected: () => connectCalled,
      wasDisconnected: () => disconnectCalled,
      getSavedDocs: () => savedDocs,
    };
  }

  // ===========================================================================
  // TEST SUITE 1: Environment Loading & CLI Safety
  // ===========================================================================
  describe('Part 1: Environment Loading & CLI Safety', () => {
    it('1.1. Rejects execution without explicit environment-file argument before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext();
        const res = await runner.fn([], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'MISSING_ENV_FILE_PARAM');
        assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must fail closed before connecting when env file omitted`);
      }
    });

    it('1.2. Rejects empty environment-file path before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext();
        const res = await runner.fn(['--env-file='], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'EMPTY_ENV_FILE_PATH');
        assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must not connect if path is empty`);
      }
    });

    it('1.3. Rejects missing environment file before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({ fileExists: () => false });
        const res = await runner.fn(['--env-file=non_existent_env.staging'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'ENV_FILE_NOT_FOUND');
        assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must not connect on missing env file`);
      }
    });

    it('1.4. Rejects space-separated syntax before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext();
        const res = await runner.fn(['--env-file', '.env.staging'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'UNSUPPORTED_ENV_FILE_SYNTAX');
        assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must reject space-separated syntax before connecting`);
      }
    });

    it('1.5. Rejects duplicate and conflicting env-file arguments before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx1 = setupMockSeedContext();
        const res1 = await runner.fn(['--env-file=.env.staging', '--env-file=.env.local'], ctx1.deps);
        assert.strictEqual(res1.success, false);
        assert.strictEqual(res1.reason, 'DUPLICATE_ENV_FILE_ARG');
        assert.strictEqual(ctx1.wasConnected(), false);

        const ctx2 = setupMockSeedContext();
        const res2 = await runner.fn(['--env-file=.env.staging', '--env=.env.local'], ctx2.deps);
        assert.strictEqual(res2.success, false);
        assert.strictEqual(res2.reason, 'DUPLICATE_ENV_FILE_ARG');
        assert.strictEqual(ctx2.wasConnected(), false);
      }
    });

    it('1.6. Rejects unknown CLI arguments before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext();
        const res = await runner.fn(['--env-file=.env.staging', '--drop-all'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'UNKNOWN_ARGUMENT');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });

    it('1.7. Accepts alias --env=<path> and loads environment with override', async () => {
      let loadedPath = null;
      const ctx = setupMockSeedContext({
        loadEnv: (p) => {
          loadedPath = p;
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dryRun, true);
      assert.ok(loadedPath.endsWith('.env.staging'));
      assert.strictEqual(ctx.wasConnected(), true);
      assert.strictEqual(ctx.wasDisconnected(), true);
    });
  });

  // ===========================================================================
  // TEST SUITE 2: Target Identity & Production Protection Gates
  // ===========================================================================
  describe('Part 2: Target Identity & Production Protection Gates', () => {
    it('2.1. Rejects missing MONGODB_URI before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({
          loadEnv: () => {
            delete process.env.MONGODB_URI;
          },
        });

        const res = await runner.fn(['--env-file=.env.staging'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'MISSING_MONGODB_URI');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });

    it('2.2. Rejects incorrect database name (DB_NAME_MISMATCH) before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({
          loadEnv: () => {
            process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wrong_db_name';
            process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
            process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
          },
        });

        const res = await runner.fn(['--env-file=.env.staging'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'DB_NAME_MISMATCH');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });

    it('2.3. Rejects production database target by default before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({
          loadEnv: () => {
            process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_adventure';
            process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_adventure';
            process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
          },
        });

        const res = await runner.fn(['--env-file=.env.prod'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'PRODUCTION_TARGET_REJECTED');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });

    it('2.4. Rejects unapproved host (HOST_NOT_ALLOWED) before connection', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({
          loadEnv: () => {
            process.env.MONGODB_URI = 'mongodb://malicious-cluster.attacker.com:27017/apple_worm_staging';
            process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
            process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1,staging-cluster.mongodb.net';
          },
        });

        const res = await runner.fn(['--env-file=.env.staging'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'HOST_NOT_ALLOWED');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });

    it('2.5. Requires target database to be apple_worm_staging for staging workflow', async () => {
      const runners = [
        { name: 'seed-levels', fn: runSeedLevelsRunner },
        { name: 'verify-seeded-levels', fn: runVerifySeededLevelsRunner },
      ];

      for (const runner of runners) {
        const ctx = setupMockSeedContext({
          loadEnv: () => {
            process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/some_other_dev_db';
            process.env.MIGRATION_EXPECTED_DB_NAME = 'some_other_dev_db';
            process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
          },
        });

        const res = await runner.fn(['--env-file=.env.dev'], ctx.deps);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.reason, 'INVALID_STAGING_TARGET');
        assert.strictEqual(ctx.wasConnected(), false);
      }
    });
  });

  // ===========================================================================
  // TEST SUITE 3: Seed Dry-Run Safety Gates
  // ===========================================================================
  describe('Part 3: Seed Dry-Run Safety Gates', () => {
    it('3.1. Defaults to dry-run when --apply is omitted (zero documents saved)', async () => {
      const ctx = setupMockSeedContext({
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dryRun, true);
      assert.strictEqual(ctx.wasConnected(), true);
      assert.strictEqual(ctx.wasDisconnected(), true);
      // Ensure zero documents were saved to database!
      assert.strictEqual(ctx.getSavedDocs().length, 0, 'Dry-run must perform zero document writes');
      assert.strictEqual(res.report.inserted, 2); // 2 would insert
      assert.strictEqual(res.report.skipped, 0);
    });

    it('3.2. Dry-run correctly identifies existing levels and skips them', async () => {
      const ctx = setupMockSeedContext({
        existingLevels: [{ levelNumber: 1, difficulty: 'tutorial' }],
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dryRun, true);
      assert.strictEqual(ctx.getSavedDocs().length, 0);
      assert.strictEqual(res.report.inserted, 1); // Only level 2 would insert
      assert.strictEqual(res.report.skipped, 1); // Level 1 skipped
    });

    it('3.3. Dry-run reports validation failures without writing', async () => {
      const ctx = setupMockSeedContext({
        failValidation: true,
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.dryRun, true);
      assert.strictEqual(res.reason, 'SEED_VALIDATION_FAILURE');
      assert.strictEqual(ctx.getSavedDocs().length, 0);
      assert.strictEqual(res.report.failed, 2);
    });
  });

  // ===========================================================================
  // TEST SUITE 4: Seed Live Apply Execution
  // ===========================================================================
  describe('Part 4: Seed Live Apply Execution', () => {
    it('4.1. Live seeding with --apply inserts missing levels', async () => {
      const ctx = setupMockSeedContext({
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging', '--apply'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dryRun, false);
      assert.strictEqual(ctx.getSavedDocs().length, 2);
      assert.strictEqual(res.report.inserted, 2);
      assert.strictEqual(res.report.skipped, 0);
    });

    it('4.2. Live seeding with --apply preserves existing levels (idempotent)', async () => {
      const ctx = setupMockSeedContext({
        existingLevels: [{ levelNumber: 1, difficulty: 'tutorial' }],
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging', '--apply'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dryRun, false);
      // Level 1 was pre-existing, so only Level 2 is saved:
      assert.strictEqual(ctx.getSavedDocs().length, 1);
      assert.strictEqual(ctx.getSavedDocs()[0].levelNumber, 2);
      assert.strictEqual(res.report.inserted, 1);
      assert.strictEqual(res.report.skipped, 1);
    });

    it('4.3. Live execution in production requires --confirm-production', async () => {
      const ctx = setupMockSeedContext({
        loadEnv: () => {
          process.env.NODE_ENV = 'production';
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging', '--apply'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'MISSING_PRODUCTION_CONFIRMATION');
      assert.strictEqual(ctx.wasConnected(), false);
    });

    it('4.4. Partial failure during live seeding reports error and failure count', async () => {
      const ctx = setupMockSeedContext({
        failSave: true,
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runSeedLevelsRunner(['--env-file=.env.staging', '--apply'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.match(res.error, /Simulated document save error/);
    });
  });

  // ===========================================================================
  // TEST SUITE 5: Seed Verification Script Tests
  // ===========================================================================
  describe('Part 5: Seed Verification Script Tests', () => {
    it('5.1. Verification script performs strictly read-only inspection (zero writes)', async () => {
      // 50 valid mock levels across 5 difficulty bands
      const bands = ['tutorial', 'easy', 'medium', 'hard', 'expert'];
      const mock50Levels = [];
      for (let i = 1; i <= 50; i++) {
        mock50Levels.push({
          levelNumber: i,
          difficulty: bands[i % 5],
          isActive: true,
          grid: { rows: 6, cols: 6 },
          wormStart: { x: 2, y: 1 },
          portal: { x: 4, y: 4 },
          moveLimit: 20,
        });
      }

      const ctx = setupMockSeedContext({
        existingLevels: mock50Levels,
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runVerifySeededLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.verified, true);
      assert.strictEqual(res.totalLevels, 50);
      assert.strictEqual(res.failed, 0);
      assert.strictEqual(ctx.wasConnected(), true);
      assert.strictEqual(ctx.wasDisconnected(), true);
      assert.strictEqual(ctx.getSavedDocs().length, 0, 'Verifier must perform zero writes');
    });

    it('5.2. Verification script fails if fewer than 50 levels exist', async () => {
      const mockFewerLevels = [
        { levelNumber: 1, difficulty: 'tutorial', isActive: true },
        { levelNumber: 2, difficulty: 'easy', isActive: true },
      ];

      const ctx = setupMockSeedContext({
        existingLevels: mockFewerLevels,
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      const res = await runVerifySeededLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.verified, false);
      assert.strictEqual(res.totalLevels, 2);
      assert.ok(res.failed > 0);
      assert.strictEqual(ctx.getSavedDocs().length, 0);
    });

    it('5.3. Verification script disconnects cleanly on unexpected query errors', async () => {
      const ctx = setupMockSeedContext({
        loadEnv: () => {
          process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
          process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
          process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
        },
      });

      // Inject error on find
      ctx.deps.LevelModel.find = () => {
        throw new Error('Simulated database query network error');
      };

      const res = await runVerifySeededLevelsRunner(['--env-file=.env.staging'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.match(res.error, /Simulated database query network error/);
      assert.strictEqual(ctx.wasConnected(), true);
      assert.strictEqual(ctx.wasDisconnected(), true);
    });
  });
});
