#!/usr/bin/env node
/**
 * server/scripts/migrate-wallet-idempotency-index.js
 * 
 * Standalone migration runner for transitioning WalletTransaction idempotency
 * index from global uniqueness to user-scoped compound uniqueness.
 * 
 * Safety gates:
 *   - Default mode is strictly DRY-RUN (read-only inspection, zero mutations).
 *   - Live index mutation requires explicit operator confirmation via `--apply` flag.
 *   - Target database is validated before connection via fail-closed validateMigrationTarget.
 *   - In production (NODE_ENV=production), live execution additionally requires `--confirm-production`.
 *   - Database URI credentials are fully redacted when displaying connection info.
 *   - Cleanly disconnects MongoDB on completion, error, or cancellation.
 *   - Guarded against execution on import.
 * 
 * Usage:
 *   node scripts/migrate-wallet-idempotency-index.js               # Dry-run inspection
 *   node scripts/migrate-wallet-idempotency-index.js --apply      # Live migration
 */

import dns from 'node:dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { migrateWalletIdempotencyIndex as defaultMigrateFn } from '../src/utils/migrateWalletIdempotencyIndex.js';
import { validateMigrationTarget as defaultValidateTarget } from '../src/utils/validateMigrationTarget.js';
import { parseMigrationCliArgs as defaultParseArgs } from '../src/utils/parseMigrationCliArgs.js';

export async function runIdempotencyIndexMigrationRunner(args = process.argv.slice(2), deps = {}) {
  // Validate CLI arguments
  const parseArgs = deps.parseArgs || defaultParseArgs;
  const parsed = parseArgs(args);
  if (!parsed.valid) {
    console.error(`❌ Refusing to run: ${parsed.error}`);
    return {
      success: false,
      reason: parsed.code,
      error: parsed.error,
    };
  }

  const { isApply, isProductionConfirm, envFilePath } = parsed;

  // Handle explicit --env-file override if passed
  if (envFilePath) {
    const resolvedPath = path.resolve(process.cwd(), envFilePath);
    const fileExistsFn = deps.fileExists || fs.existsSync;
    if (!fileExistsFn(resolvedPath)) {
      console.error(`❌ Refusing to run: Specified environment file does not exist: "${resolvedPath}"`);
      return { success: false, reason: 'ENV_FILE_NOT_FOUND', error: `File not found: ${resolvedPath}` };
    }
    const loadEnvFn = deps.loadEnv || ((p) => dotenv.config({ path: p, override: true }));
    loadEnvFn(resolvedPath);
    console.log(`Loaded environment configuration from: "${envFilePath}"`);
  }

  const isProd = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI;

  const validateTarget = deps.validateTarget || defaultValidateTarget;
  const migrateFn = deps.migrateFn || defaultMigrateFn;
  const connectFn = deps.connect || (async (uri, opts) => mongoose.connect(uri, opts));
  const disconnectFn = deps.disconnect || (async () => mongoose.disconnect());
  const getConnection = deps.getConnection || (() => mongoose.connection);

  console.log('=============================================================');
  console.log('🔄 WALLET TRANSACTION IDEMPOTENCY INDEX MIGRATION RUNNER');
  console.log('=============================================================');

  // Gate 1: Check database URI presence
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim().length === 0) {
    console.error('❌ Refusing to run: MONGODB_URI environment variable is not defined.');
    return { success: false, reason: 'MISSING_MONGODB_URI' };
  }

  // Gate 2: Production safety confirmation
  if (isApply && isProd && !isProductionConfirm) {
    console.error(
      '❌ SAFETY REFUSAL: Running live index migration in production requires both "--apply" and "--confirm-production" flags.'
    );
    return { success: false, reason: 'MISSING_PRODUCTION_CONFIRMATION' };
  }

  // Gate 3: Fail-closed Target Database Identity Validation (PRE-CONNECTION)
  const validation = validateTarget(mongoUri, {
    allowProduction: isProductionConfirm,
    isProductionConfirm,
  });

  if (!validation.valid) {
    console.error(`❌ TARGET VALIDATION FAILED: ${validation.error}`);
    return {
      success: false,
      reason: validation.code,
      error: validation.error,
    };
  }

  const mode = isApply ? 'LIVE EXECUTION' : 'DRY-RUN (READ-ONLY)';
  console.log(`Execution Mode : [ ${mode} ]`);
  console.log(`Target Database: ${validation.target.redactedUri}`);
  console.log(`Environment    : ${process.env.NODE_ENV || 'development'}`);
  console.log('-------------------------------------------------------------');

  let didConnect = false;
  try {
    const conn = getConnection();
    if (conn.readyState === 0) {
      console.log('Connecting to database...');
      await connectFn(mongoUri, { serverSelectionTimeoutMS: 10000 });
      didConnect = true;
    }
    const activeConn = getConnection();
    console.log(`Connected to database: "${activeConn.name || activeConn.db?.databaseName || validation.target.dbName}"`);

    // Execute migration in dry-run or live mode
    const report = await migrateFn(activeConn.db, {
      dryRun: !isApply,
      quiet: false,
    });

    console.log('\nMigration Summary Report:');
    console.log(`  - Dry Run               : ${report.dryRun}`);
    console.log(`  - Target Collection     : ${report.targetCollection || 'wallettransactions'}`);
    console.log(`  - Valid Compound Exists : ${report.alreadyExists}`);
    console.log(`  - Obsolete Global Exists: ${report.obsoleteGlobalExists !== undefined ? report.obsoleteGlobalExists : report.oldIndexDropped}`);
    console.log(`  - Planned / Final Action: ${report.plannedAction || (report.migrated ? 'INDEX_MIGRATED' : 'NO_CHANGE')}`);
    if (report.finalIndexNames && report.finalIndexNames.length > 0) {
      console.log(`  - Active Indexes        : [${report.finalIndexNames.join(', ')}]`);
    }

    if (!isApply) {
      console.log('\nℹ️  Dry-run completed successfully. No changes were made to the database.');
      console.log('   To apply changes, execute with: node scripts/migrate-wallet-idempotency-index.js --apply\n');
    } else {
      console.log('\n✅ Live migration completed successfully.\n');
    }

    return { success: true, report };
  } catch (err) {
    console.error('\n❌ Migration failed or aborted:', err.message);
    return { success: false, error: err.message };
  } finally {
    if (didConnect) {
      const conn = getConnection();
      if (conn && conn.readyState !== 0) {
        await disconnectFn();
        console.log('Database connection closed.');
      }
    }
  }
}

// Guard against execution on import
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate-wallet-idempotency-index.js') ||
    process.argv[1].endsWith('migrate-wallet-idempotency-index'));

if (isMain) {
  runIdempotencyIndexMigrationRunner()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal runner error:', err.message);
      process.exit(1);
    });
}
