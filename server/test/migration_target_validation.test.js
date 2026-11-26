/**
 * server/test/migration_target_validation.test.js
 * 
 * Isolated Unit and Safety Suite for Migration Target Validation & CLI Runners.
 * 
 * Safety invariants:
 *   - 100% in-memory isolated execution.
 *   - ZERO database connections, ZERO network calls.
 *   - Uses mocks and test doubles to verify dry-run, --apply, and target safety gates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMongoUri,
  redactMongoUri,
  validateMigrationTarget,
} from '../src/utils/validateMigrationTarget.js';

import {
  parseMigrationCliArgs,
  CLI_ARG_ERROR_CODES,
} from '../src/utils/parseMigrationCliArgs.js';

import {
  migrateWalletIdempotencyIndex,
  isValidCompoundIdempotencyIndex,
  isObsoleteGlobalIdempotencyIndex,
  hasIdempotencyKeyField,
} from '../src/utils/migrateWalletIdempotencyIndex.js';

import { runIdempotencyIndexMigrationRunner } from '../scripts/migrate-wallet-idempotency-index.js';
import { runOpIdIndexMigrationRunner } from '../scripts/migrate-wallet-opid-index.js';
import { runWalletBaselineMigrationRunner } from '../scripts/initialize-wallet-baseline.js';

// =============================================================================
// TEST SUITE 1: Target URI Parsing & Redaction
// =============================================================================
describe('Target URI Parsing & Redaction', () => {
  it('1.1. Parses standard single-host MongoDB URI', () => {
    const res = parseMongoUri('mongodb://localhost:27017/apple_worm_staging');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.protocol, 'mongodb');
    assert.deepStrictEqual(res.hosts, ['localhost:27017']);
    assert.deepStrictEqual(res.hostnames, ['localhost']);
    assert.strictEqual(res.dbName, 'apple_worm_staging');
    assert.strictEqual(res.hasAuth, false);
    assert.strictEqual(res.redactedUri, 'mongodb://localhost:27017/apple_worm_staging');
  });

  it('1.2. Redacts credentials completely from URI', () => {
    const mockUser = 'app_user';
    const mockSecret = 'super_secret_p%40ss';
    const mockHost = 'staging-cluster.internal:27017';
    const raw = `mongodb://${mockUser}:${mockSecret}@${mockHost}/apple_worm_staging?authSource=admin`;
    const res = parseMongoUri(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.hasAuth, true);
    assert.strictEqual(res.dbName, 'apple_worm_staging');
    assert.strictEqual(res.hosts[0], mockHost);
    assert.strictEqual(res.hostnames[0], 'staging-cluster.internal');
    assert.strictEqual(res.redactedUri, `mongodb://***:***@${mockHost}/apple_worm_staging`);

    // Assert that credentials do not appear in any returned field
    assert.ok(!JSON.stringify(res).includes('super_secret'));
    assert.ok(!JSON.stringify(res).includes(mockUser));

    // Test redactMongoUri helper
    const redacted = redactMongoUri(raw);
    assert.strictEqual(redacted, `mongodb://***:***@${mockHost}/apple_worm_staging`);
  });

  it('1.3. Parses mongodb+srv:// cluster URIs with special characters in password', () => {
    const mockUser = 'stagingAdmin';
    const mockPass = 'P@ss!w0rd#2026';
    const mockHost = 'cluster0.staging.example.com';
    const raw = `mongodb+srv://${mockUser}:${mockPass}@${mockHost}/apple_worm_staging?retryWrites=true`;
    const res = parseMongoUri(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.protocol, 'mongodb+srv');
    assert.strictEqual(res.hasAuth, true);
    assert.strictEqual(res.dbName, 'apple_worm_staging');
    assert.deepStrictEqual(res.hosts, [mockHost]);
    assert.strictEqual(res.redactedUri, `mongodb+srv://***:***@${mockHost}/apple_worm_staging`);
    assert.ok(!JSON.stringify(res).includes(mockPass));
  });

  it('1.4. Parses replica set multi-host URIs', () => {
    const raw = 'mongodb://node1:27017,node2:27017,node3:27017/apple_worm_staging?replicaSet=rs0';
    const res = parseMongoUri(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.protocol, 'mongodb');
    assert.strictEqual(res.hosts.length, 3);
    assert.deepStrictEqual(res.hostnames, ['node1', 'node2', 'node3']);
    assert.strictEqual(res.dbName, 'apple_worm_staging');
  });

  it('1.5. Parses IPv6 addresses safely', () => {
    const raw = 'mongodb://[::1]:27017/apple_worm_staging';
    const res = parseMongoUri(raw);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.hostnames, ['::1']);
    assert.strictEqual(res.dbName, 'apple_worm_staging');
  });

  it('1.6. Rejects malformed connection strings', () => {
    const invalidList = [
      '',
      null,
      undefined,
      12345,
      'http://localhost:27017/apple_worm_staging',
      'postgres://localhost:5432/apple_worm_staging',
      'mongodb://',
      'not a uri',
    ];

    for (const val of invalidList) {
      const res = parseMongoUri(val);
      assert.strictEqual(res.valid, false);
      assert.ok(typeof res.error === 'string');
    }
  });
});

// =============================================================================
// TEST SUITE 2: Target Validation Logic (validateMigrationTarget)
// =============================================================================
describe('Target Validation Safety Gates', () => {
  const validStagingUri = 'mongodb://127.0.0.1:27017/apple_worm_staging';
  const standardConfig = {
    expectedDbName: 'apple_worm_staging',
    allowedHosts: 'cluster0.staging.mongodb.net,127.0.0.1,localhost',
  };

  it('2.1. Valid explicitly approved staging URI passes validation', () => {
    const res = validateMigrationTarget(validStagingUri, standardConfig);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.code, 'TARGET_VALIDATED');
    assert.strictEqual(res.target.dbName, 'apple_worm_staging');
    assert.strictEqual(res.target.redactedUri, 'mongodb://127.0.0.1:27017/apple_worm_staging');
  });

  it('2.2. Rejects incorrect database name (DB_NAME_MISMATCH)', () => {
    const wrongDbUri = 'mongodb://cluster0.staging.mongodb.net:27017/apple_worm_other';
    const res = validateMigrationTarget(wrongDbUri, standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'DB_NAME_MISMATCH');
    assert.match(res.error, /does not match configured expected database/);
  });

  it('2.3. Prohibits loose substring matching on database name', () => {
    // Merely containing "staging" as substring is strictly rejected
    const substringDbUri = 'mongodb://cluster0.staging.mongodb.net:27017/apple_worm_staging_shadow';
    const res = validateMigrationTarget(substringDbUri, standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'DB_NAME_MISMATCH');
  });

  it('2.4. Rejects incorrect hostname (HOST_NOT_ALLOWED)', () => {
    const wrongHostUri = 'mongodb://rogue-host.internal:27017/apple_worm_staging';
    const res = validateMigrationTarget(wrongHostUri, standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'HOST_NOT_ALLOWED');
    assert.match(res.error, /is not in the approved MIGRATION_ALLOWED_HOSTS/);
  });

  it('2.5. Rejects replica set if ANY host is unauthorized', () => {
    // node1 and node2 approved, but evil-node is not
    const multiUri = 'mongodb://cluster0.staging.mongodb.net:27017,unauthorized-node.net:27017/apple_worm_staging';
    const res = validateMigrationTarget(multiUri, standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'HOST_NOT_ALLOWED');
    assert.match(res.error, /unauthorized-node\.net/);
  });

  it('2.6. Fails closed when expected database configuration is missing', () => {
    const res = validateMigrationTarget(validStagingUri, {
      expectedDbName: '',
      allowedHosts: 'cluster0.staging.mongodb.net',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'MISSING_EXPECTED_DB_CONFIG');
  });

  it('2.7. Fails closed when allowed hosts configuration is missing', () => {
    const res = validateMigrationTarget(validStagingUri, {
      expectedDbName: 'apple_worm_staging',
      allowedHosts: '',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'MISSING_ALLOWED_HOSTS_CONFIG');
  });

  it('2.8. Fails closed when MONGODB_URI is empty or missing', () => {
    const res = validateMigrationTarget('', standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'MISSING_MONGODB_URI');
  });

  it('2.9. Fails closed when target URI has no database name', () => {
    const noDbUri = 'mongodb://cluster0.staging.mongodb.net:27017/';
    const res = validateMigrationTarget(noDbUri, standardConfig);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'MISSING_TARGET_DB_NAME');
  });

  it('2.10. Strictly rejects production database names by default', () => {
    const prodNames = [
      'apple_worm_adventure',
      'production',
      'prod',
      'apple_worm_prod',
      'apple_worm_adventure_prod',
      'apple_worm_adventure_production',
    ];

    for (const prodDb of prodNames) {
      const prodUri = `mongodb://cluster0.staging.mongodb.net:27017/${prodDb}`;
      const res = validateMigrationTarget(prodUri, {
        expectedDbName: prodDb,
        allowedHosts: 'cluster0.staging.mongodb.net',
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, 'PRODUCTION_TARGET_REJECTED');
      assert.match(res.error, /classified as production/);
    }
  });

  it('2.11. Strictly rejects production hostnames by default', () => {
    const prodHostUri = 'mongodb://cluster-prod-0.mongodb.net:27017/some_other_db';
    const res = validateMigrationTarget(prodHostUri, {
      expectedDbName: 'some_other_db',
      allowedHosts: 'cluster-prod-0.mongodb.net',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, 'PRODUCTION_TARGET_REJECTED');
  });

  it('2.12. Secrets and credentials never leak into error messages', () => {
    const mockUser = 'admin';
    const secretPass = 'SuperConfidentialPassword987!';
    const userPassUri = `mongodb://${mockUser}:${secretPass}@rogue-cluster.org:27017/wrong_db`;
    const res = validateMigrationTarget(userPassUri, standardConfig);

    assert.strictEqual(res.valid, false);
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes(secretPass), 'Credential must never appear in validation result');
    assert.ok(!serialized.includes(`${mockUser}:`), 'Username must never appear in validation result');
  });
});

// =============================================================================
// TEST SUITE 3: Idempotency Index Utility (migrateWalletIdempotencyIndex) Dry-Run & Duplicates
// =============================================================================
describe('Idempotency Index Utility (dryRun & duplicates)', () => {
  // Helper to create an in-memory mock DB and collection
  function createMockDb(initialIndexes = [], duplicateRecords = []) {
    let indexes = [...initialIndexes];
    let createdIndexes = [];
    let droppedIndexes = [];

    const collection = {
      indexes: async () => [...indexes],
      createIndex: async (key, opts) => {
        createdIndexes.push({ key, opts });
        indexes.push({ key, name: opts.name, unique: opts.unique, partialFilterExpression: opts.partialFilterExpression });
        return opts.name;
      },
      dropIndex: async (name) => {
        droppedIndexes.push(name);
        indexes = indexes.filter((i) => i.name !== name);
        return { ok: 1 };
      },
      aggregate: (pipeline) => ({
        toArray: async () => duplicateRecords,
      }),
    };

    const db = {
      collection: (name) => collection,
    };

    return { db, collection, getCreated: () => createdIndexes, getDropped: () => droppedIndexes };
  }

  it('3.1. Dry-run mode reports planned action without mutating indexes', async () => {
    // Scenario: Obsolete global index exists, compound does not exist
    const initialIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'idempotencyKey_1', key: { idempotencyKey: 1 }, unique: true, sparse: true },
    ];

    const { db, getCreated, getDropped } = createMockDb(initialIndexes);

    const report = await migrateWalletIdempotencyIndex(db, { dryRun: true, quiet: true });

    assert.strictEqual(report.dryRun, true);
    assert.strictEqual(report.migrated, false);
    assert.strictEqual(report.alreadyExists, false);
    assert.strictEqual(report.obsoleteGlobalExists, true);
    assert.strictEqual(report.plannedAction, 'CREATE_COMPOUND_AND_DROP_GLOBAL');

    // In dry-run mode, NO indexes were created or dropped!
    assert.strictEqual(getCreated().length, 0, 'No createIndex call permitted in dry-run mode');
    assert.strictEqual(getDropped().length, 0, 'No dropIndex call permitted in dry-run mode');
  });

  it('3.2. Dry-run reports NO_CHANGE if compound index already exists and global is gone', async () => {
    const initialIndexes = [
      { name: '_id_', key: { _id: 1 } },
      {
        name: 'userId_1_idempotencyKey_1',
        key: { userId: 1, idempotencyKey: 1 },
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
    ];

    const { db, getCreated, getDropped } = createMockDb(initialIndexes);

    const report = await migrateWalletIdempotencyIndex(db, { dryRun: true, quiet: true });

    assert.strictEqual(report.dryRun, true);
    assert.strictEqual(report.alreadyExists, true);
    assert.strictEqual(report.obsoleteGlobalExists, false);
    assert.strictEqual(report.plannedAction, 'NO_CHANGE');
    assert.strictEqual(getCreated().length, 0);
    assert.strictEqual(getDropped().length, 0);
  });

  it('3.3. Duplicate historical records cause safe abort before index creation', async () => {
    const initialIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'idempotencyKey_1', key: { idempotencyKey: 1 }, unique: true, sparse: true },
    ];

    const duplicates = [
      { _id: { userId: 'user-1', idempotencyKey: 'dup-key-1' }, count: 2, docIds: ['id1', 'id2'] },
    ];

    const { db, getCreated } = createMockDb(initialIndexes, duplicates);

    await assert.rejects(
      async () => {
        await migrateWalletIdempotencyIndex(db, { dryRun: false, quiet: true });
      },
      /Migration aborted: Found 1 duplicate \(userId, idempotencyKey\) historical record set/
    );

    // Verify index creation was never attempted
    assert.strictEqual(getCreated().length, 0, 'Must abort before calling createIndex');
  });

  it('3.4. Duplicate historical records also abort during dry-run preflight', async () => {
    const initialIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'idempotencyKey_1', key: { idempotencyKey: 1 }, unique: true, sparse: true },
    ];

    const duplicates = [
      { _id: { userId: 'user-1', idempotencyKey: 'dup-key-1' }, count: 2, docIds: ['id1', 'id2'] },
    ];

    const { db, getCreated } = createMockDb(initialIndexes, duplicates);

    await assert.rejects(
      async () => {
        await migrateWalletIdempotencyIndex(db, { dryRun: true, quiet: true });
      },
      /Migration aborted: Found 1 duplicate \(userId, idempotencyKey\) historical record set/
    );

    assert.strictEqual(getCreated().length, 0);
  });

  it('3.5. Live execution creates compound index and drops obsolete global index', async () => {
    const initialIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'idempotencyKey_1', key: { idempotencyKey: 1 }, unique: true, sparse: true },
    ];

    const { db, getCreated, getDropped } = createMockDb(initialIndexes);

    const report = await migrateWalletIdempotencyIndex(db, { dryRun: false, quiet: true });

    assert.strictEqual(report.dryRun, false);
    assert.strictEqual(report.migrated, true);
    assert.strictEqual(report.newIndexCreated, true);
    assert.strictEqual(report.oldIndexDropped, true);

    assert.strictEqual(getCreated().length, 1);
    assert.strictEqual(getDropped().length, 1);
    assert.strictEqual(getDropped()[0], 'idempotencyKey_1');
  });
});

// =============================================================================
// TEST SUITE 4: CLI Runners Safety, Dry-Run Defaults & Target Validation Isolation
// =============================================================================
describe('CLI Runners Safety Gates (Mocked & Isolated)', () => {
  const originalEnv = { ...process.env };

  function setupMockRunnerContext(overrides = {}) {
    let connectCalled = false;
    let disconnectCalled = false;
    let migrateOptionsPassed = null;

    const mockDb = {
      databaseName: 'apple_worm_staging',
      collection: () => ({
        indexes: async () => [{ name: '_id_', key: { _id: 1 } }],
      }),
    };

    const mockConnection = {
      readyState: 0,
      name: 'apple_worm_staging',
      db: mockDb,
    };

    const deps = {
      validateTarget: overrides.validateTarget,
      connect: async () => {
        connectCalled = true;
        mockConnection.readyState = 1;
      },
      disconnect: async () => {
        disconnectCalled = true;
        mockConnection.readyState = 0;
      },
      getConnection: () => mockConnection,
      migrateFn: async (db, opts) => {
        migrateOptionsPassed = opts;
        return {
          dryRun: opts.dryRun,
          migrated: !opts.dryRun,
          alreadyExists: false,
          plannedAction: opts.dryRun ? 'DRY_RUN_PLAN' : 'LIVE_APPLY',
        };
      },
    };

    return {
      deps,
      wasConnected: () => connectCalled,
      wasDisconnected: () => disconnectCalled,
      getMigrateOptions: () => migrateOptionsPassed,
    };
  }

  it('4.1. Idempotency CLI runner defaults to dry-run when --apply is omitted', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
    process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
    process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';

    const ctx = setupMockRunnerContext();
    const res = await runIdempotencyIndexMigrationRunner([], ctx.deps);

    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx.wasConnected(), true);
    assert.strictEqual(ctx.wasDisconnected(), true);
    assert.strictEqual(ctx.getMigrateOptions().dryRun, true, 'Default must be dry-run: true');
  });

  it('4.2. Idempotency CLI runner executes live mode when --apply is supplied', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
    process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
    process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';

    const ctx = setupMockRunnerContext();
    const res = await runIdempotencyIndexMigrationRunner(['--apply'], ctx.deps);

    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx.wasConnected(), true);
    assert.strictEqual(ctx.wasDisconnected(), true);
    assert.strictEqual(ctx.getMigrateOptions().dryRun, false, 'With --apply, dryRun must be false');
  });

  it('4.3. CLI runners reject invalid target before any database connection is attempted', async () => {
    // Configure invalid target: database name mismatch
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
    process.env.MIGRATION_EXPECTED_DB_NAME = 'different_db';
    process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';

    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn([], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'DB_NAME_MISMATCH');
      assert.strictEqual(
        ctx.wasConnected(),
        false,
        `${runner.name} runner must NOT attempt database connection on validation failure`
      );
    }
  });

  it('4.4. CLI runners reject missing target configuration before connection', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
    delete process.env.MIGRATION_EXPECTED_DB_NAME;
    delete process.env.MIGRATION_ALLOWED_HOSTS;

    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn([], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'MISSING_EXPECTED_DB_CONFIG');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must fail closed before connecting`);
    }
  });

  it('4.5. CLI runners reject production target by default without connection', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_adventure';
    process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_adventure';
    process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';

    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn([], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'PRODUCTION_TARGET_REJECTED');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must reject production target before connection`);
    }
  });

  it('4.6. Disconnects cleanly in finally block even if migration throws error', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
    process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
    process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';

    const ctx = setupMockRunnerContext();
    // Inject migration function that throws
    ctx.deps.migrateFn = async () => {
      throw new Error('Simulated unexpected migration error');
    };

    const res = await runIdempotencyIndexMigrationRunner([], ctx.deps);

    assert.strictEqual(res.success, false);
    assert.match(res.error, /Simulated unexpected migration error/);
    assert.strictEqual(ctx.wasConnected(), true);
    assert.strictEqual(ctx.wasDisconnected(), true, 'Must disconnect database on failure in finally block');
  });

  it('4.7. --env-file with empty or missing path fails closed before connection across all runners', async () => {
    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn(['--env-file='], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'EMPTY_ENV_FILE_PATH');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must not connect if --env-file param is empty`);
    }
  });

  it('4.8. --env-file pointing to non-existent file fails closed across all runners', async () => {
    const nonExistentPath = 'non_existent_env_file.staging';
    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      ctx.deps.fileExists = () => false; // Mock file does not exist

      const res = await runner.fn([`--env-file=${nonExistentPath}`], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'ENV_FILE_NOT_FOUND');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must not connect on missing env file`);
    }
  });

  it('4.9. --env-file successfully loads staging variables and executes preflight', async () => {
    const ctx = setupMockRunnerContext();
    ctx.deps.fileExists = () => true;
    ctx.deps.loadEnv = () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
      process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
      process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
    };

    const res = await runIdempotencyIndexMigrationRunner(['--env-file=.env.staging'], ctx.deps);

    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx.wasConnected(), true);
    assert.strictEqual(ctx.wasDisconnected(), true);
    assert.strictEqual(ctx.getMigrateOptions().dryRun, true);
  });

  it('4.10. --env-file loading production target without confirmation fails closed', async () => {
    const ctx = setupMockRunnerContext();
    ctx.deps.fileExists = () => true;
    ctx.deps.loadEnv = () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_adventure';
      process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_adventure';
      process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
    };

    const res = await runIdempotencyIndexMigrationRunner(['--env-file=.env.prod_accidental'], ctx.deps);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'PRODUCTION_TARGET_REJECTED');
    assert.strictEqual(ctx.wasConnected(), false, 'Must not connect to production from loaded env file');
  });

  it('4.11. CLI runners reject unsupported space-separated --env-file syntax without connection', async () => {
    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn(['--env-file', '.env.staging'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'UNSUPPORTED_ENV_FILE_SYNTAX');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must fail closed before connecting`);
    }
  });

  it('4.12. CLI runners reject duplicate or conflicting --env-file flags without connection', async () => {
    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      // Test duplicate --env-file
      const ctx1 = setupMockRunnerContext();
      const res1 = await runner.fn(['--env-file=.env.staging', '--env-file=.env.local'], ctx1.deps);
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.reason, 'DUPLICATE_ENV_FILE_ARG');
      assert.strictEqual(ctx1.wasConnected(), false, `${runner.name} must fail closed on duplicate env-file`);

      // Test conflicting --env-file and --env alias
      const ctx2 = setupMockRunnerContext();
      const res2 = await runner.fn(['--env-file=.env.staging', '--env=.env.local'], ctx2.deps);
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.reason, 'DUPLICATE_ENV_FILE_ARG');
      assert.strictEqual(ctx2.wasConnected(), false, `${runner.name} must fail closed on conflicting env-file and env`);
    }
  });

  it('4.13. CLI runners reject unknown CLI arguments without connection', async () => {
    const runners = [
      { name: 'idempotency', fn: runIdempotencyIndexMigrationRunner },
      { name: 'opId', fn: runOpIdIndexMigrationRunner },
      { name: 'baseline', fn: runWalletBaselineMigrationRunner },
    ];

    for (const runner of runners) {
      const ctx = setupMockRunnerContext();
      const res = await runner.fn(['--unknown-flag', '--drop-database'], ctx.deps);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'UNKNOWN_ARGUMENT');
      assert.strictEqual(ctx.wasConnected(), false, `${runner.name} must fail closed on unknown arguments`);
    }
  });

  it('4.14. CLI runners accept valid --env=<path> alias and execute preflight', async () => {
    const ctx = setupMockRunnerContext();
    ctx.deps.fileExists = () => true;
    ctx.deps.loadEnv = () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_staging';
      process.env.MIGRATION_EXPECTED_DB_NAME = 'apple_worm_staging';
      process.env.MIGRATION_ALLOWED_HOSTS = '127.0.0.1';
    };

    const res = await runIdempotencyIndexMigrationRunner(['--env=.env.staging'], ctx.deps);

    assert.strictEqual(res.success, true);
    assert.strictEqual(ctx.wasConnected(), true);
    assert.strictEqual(ctx.wasDisconnected(), true);
    assert.strictEqual(ctx.getMigrateOptions().dryRun, true);
  });

  // Restore env after tests
  process.env = originalEnv;
});

// =============================================================================
// TEST SUITE 5: CLI Argument Hardening & Parser Verification
// =============================================================================
describe('CLI Argument Hardening & Parser Verification', () => {
  it('5.1. Default empty arguments parses to dry-run with no env file', () => {
    const res = parseMigrationCliArgs([]);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, false);
    assert.strictEqual(res.isProductionConfirm, false);
    assert.strictEqual(res.envFilePath, null);
  });

  it('5.2. Correctly parses --apply flag', () => {
    const res = parseMigrationCliArgs(['--apply']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, true);
    assert.strictEqual(res.isProductionConfirm, false);
    assert.strictEqual(res.envFilePath, null);
  });

  it('5.3. Correctly parses --confirm-production flag', () => {
    const res = parseMigrationCliArgs(['--confirm-production']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, false);
    assert.strictEqual(res.isProductionConfirm, true);
    assert.strictEqual(res.envFilePath, null);
  });

  it('5.4. Correctly parses --env-file=<path>', () => {
    const res = parseMigrationCliArgs(['--env-file=.env.staging']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, false);
    assert.strictEqual(res.isProductionConfirm, false);
    assert.strictEqual(res.envFilePath, '.env.staging');
  });

  it('5.5. Correctly parses alias --env=<path>', () => {
    const res = parseMigrationCliArgs(['--env=.env.staging']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, false);
    assert.strictEqual(res.isProductionConfirm, false);
    assert.strictEqual(res.envFilePath, '.env.staging');
  });

  it('5.6. Correctly parses combined valid flags in any order', () => {
    const res = parseMigrationCliArgs([
      '--apply',
      '--confirm-production',
      '--env-file=.env.staging',
    ]);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.isApply, true);
    assert.strictEqual(res.isProductionConfirm, true);
    assert.strictEqual(res.envFilePath, '.env.staging');
  });

  it('5.7. Rejects space-separated --env-file syntax', () => {
    const res = parseMigrationCliArgs(['--env-file', '.env.staging']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);
    assert.match(res.error, /space-separated arguments are not permitted/i);
  });

  it('5.8. Rejects space-separated --env alias syntax', () => {
    const res = parseMigrationCliArgs(['--env', '.env.staging']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);
    assert.match(res.error, /space-separated arguments are not permitted/i);
  });

  it('5.9. Rejects bare --env-file or --env flags', () => {
    const res1 = parseMigrationCliArgs(['--env-file']);
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);

    const res2 = parseMigrationCliArgs(['--env']);
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);
  });

  it('5.10. Rejects malformed env flag prefix (e.g. colon or dot syntax)', () => {
    const res1 = parseMigrationCliArgs(['--env-file:staging']);
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);

    const res2 = parseMigrationCliArgs(['--env.staging']);
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.code, CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX);
  });

  it('5.11. Rejects empty path --env-file= and alias --env=', () => {
    const res1 = parseMigrationCliArgs(['--env-file=']);
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.code, CLI_ARG_ERROR_CODES.EMPTY_ENV_FILE_PATH);
    assert.match(res1.error, /cannot be empty/i);

    const res2 = parseMigrationCliArgs(['--env=']);
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.code, CLI_ARG_ERROR_CODES.EMPTY_ENV_FILE_PATH);
    assert.match(res2.error, /cannot be empty/i);
  });

  it('5.12. Rejects whitespace-only path in env file flags', () => {
    const res = parseMigrationCliArgs(['--env-file=   ']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.EMPTY_ENV_FILE_PATH);
  });

  it('5.13. Rejects duplicate --env-file flags', () => {
    const res = parseMigrationCliArgs(['--env-file=.env.staging', '--env-file=.env.production']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.DUPLICATE_ENV_FILE_ARG);
    assert.match(res.error, /Multiple environment file flags provided/i);
  });

  it('5.14. Rejects conflicting --env-file and --env flags', () => {
    const res = parseMigrationCliArgs(['--env-file=.env.staging', '--env=.env.production']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.DUPLICATE_ENV_FILE_ARG);
    assert.match(res.error, /Conflicting or duplicate flags are not permitted/i);
  });

  it('5.15. Rejects duplicate --env flags', () => {
    const res = parseMigrationCliArgs(['--env=.env.staging', '--env=.env.local']);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.DUPLICATE_ENV_FILE_ARG);
  });

  it('5.16. Rejects unknown CLI arguments and flags', () => {
    const testCases = [
      ['--force'],
      ['--drop'],
      ['--unknown'],
      ['-v'],
      ['-f'],
      ['staging'],
      ['production'],
    ];

    for (const testCase of testCases) {
      const res = parseMigrationCliArgs(testCase);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, CLI_ARG_ERROR_CODES.UNKNOWN_ARGUMENT);
      assert.match(res.error, /Unknown argument/i);
      assert.strictEqual(res.invalidArg, testCase[0]);
    }
  });
});
