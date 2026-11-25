/**
 * @file verify-seeded-levels.js
 * @description Comprehensive verification script testing that all 50 seeded levels exist in MongoDB Atlas,
 * are active, span all 5 difficulty bands, and pass both schema and playability validations.
 * 
 * Safety invariants:
 *   - Strictly READ-ONLY: performs zero insertions, updates, deletions, or index creations.
 *   - Requires explicit --env-file=<path> or --env=<path> argument.
 *   - Validates target database before connecting via fail-closed validateMigrationTarget.
 *   - Explicitly disables Mongoose automatic index creation.
 *   - Cleanly disconnects MongoDB on completion, error, or cancellation.
 *   - Guarded against execution on import.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Level from './src/models/Level.js';
import { validateLevelPlayability } from './src/services/levelValidationService.js';
import { parseMigrationCliArgs as defaultParseArgs } from './src/utils/parseMigrationCliArgs.js';
import { validateMigrationTarget as defaultValidateTarget } from './src/utils/validateMigrationTarget.js';

// Explicitly disable Mongoose auto-indexing for verification workflow
mongoose.set('autoIndex', false);

export async function runVerifySeededLevelsRunner(args = process.argv.slice(2), deps = {}) {
  // Gate 0: Parse CLI arguments
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

  // Gate 1: Require explicit environment-file selection (no default fallback!)
  if (!parsed.envFilePath) {
    const errMsg = 'Refusing to run: An explicit environment file is required. Specify --env-file=<path> or --env=<path>.';
    console.error(`❌ ${errMsg}`);
    return {
      success: false,
      reason: 'MISSING_ENV_FILE_PARAM',
      error: errMsg,
    };
  }

  // Gate 2: Verify environment file exists and load with override: true
  const resolvedPath = path.resolve(process.cwd(), parsed.envFilePath);
  const fileExistsFn = deps.fileExists || fs.existsSync;
  if (!fileExistsFn(resolvedPath)) {
    console.error(`❌ Refusing to run: Specified environment file does not exist: "${resolvedPath}"`);
    return {
      success: false,
      reason: 'ENV_FILE_NOT_FOUND',
      error: `File not found: ${resolvedPath}`,
    };
  }
  const loadEnvFn = deps.loadEnv || ((p) => dotenv.config({ path: p, override: true }));
  loadEnvFn(resolvedPath);
  console.log(`Loaded environment configuration from: "${parsed.envFilePath}"`);

  const { isProductionConfirm } = parsed;
  const mongoUri = process.env.MONGODB_URI;

  // Gate 3: Check URI presence
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim().length === 0) {
    console.error('❌ Refusing to run: MONGODB_URI environment variable is not defined.');
    return { success: false, reason: 'MISSING_MONGODB_URI', error: 'MONGODB_URI is not defined.' };
  }

  // Gate 4: Pre-Connection Target Validation
  const validateTarget = deps.validateTarget || defaultValidateTarget;
  const validation = validateTarget(mongoUri, {
    expectedDbName: process.env.MIGRATION_EXPECTED_DB_NAME,
    allowedHosts: process.env.MIGRATION_ALLOWED_HOSTS,
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

  // Gate 4B: Enforce staging target identity (must be apple_worm_staging unless explicitly confirming production)
  if (!isProductionConfirm && validation.target.dbName !== 'apple_worm_staging') {
    const err = `Target database "${validation.target.dbName}" is not the expected staging database "apple_worm_staging".`;
    console.error(`❌ SAFETY REFUSAL: ${err}`);
    return {
      success: false,
      reason: 'INVALID_STAGING_TARGET',
      error: err,
    };
  }

  console.log('=============================================================');
  console.log('🔍 APPLE WORM ADVENTURE SEEDED LEVELS VERIFIER (READ-ONLY)');
  console.log('=============================================================');
  console.log(`Target Database: ${validation.target.redactedUri}`);
  console.log(`Environment    : ${process.env.NODE_ENV || 'staging'}`);
  console.log('-------------------------------------------------------------');

  mongoose.set('autoIndex', false);

  const connectFn = deps.connect || (async (uri, opts) => mongoose.connect(uri, opts));
  const disconnectFn = deps.disconnect || (async () => mongoose.disconnect());
  const getConnection = deps.getConnection || (() => mongoose.connection);
  const LevelModel = deps.LevelModel || Level;
  const validatePlayabilityFn = deps.validatePlayability || validateLevelPlayability;

  let passed = 0;
  let failed = 0;
  const checkReports = [];

  function recordCheck(testNum, description, condition, details = '') {
    if (condition) {
      console.log(`[PASS] ${testNum}. ${description}`);
      if (details) console.log(`       └─ Info: ${details}`);
      passed++;
      checkReports.push({ testNum, description, passed: true, details });
    } else {
      console.error(`[FAIL] ${testNum}. ${description}`);
      console.error(`       └─ Reason: ${details || 'Condition failed'}`);
      failed++;
      checkReports.push({ testNum, description, passed: false, details });
    }
  }

  let didConnect = false;
  try {
    const conn = getConnection();
    if (conn.readyState === 0) {
      console.log('Connecting to database...');
      await connectFn(mongoUri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
      didConnect = true;
    }
    const activeConn = getConnection();
    console.log(`Connected to database: "${activeConn.name || activeConn.db?.databaseName || validation.target.dbName}"`);

    // 1. Check total count (must be at least 50 levels)
    const allLevels = await LevelModel.find().sort({ levelNumber: 1 }).lean();
    recordCheck(
      1,
      'Database contains at least 50 game levels',
      allLevels.length >= 50,
      `Found ${allLevels.length} total levels in database`
    );

    // 2. Check level number uniqueness
    const levelNumberSet = new Set();
    let duplicatesFound = 0;
    for (const lvl of allLevels) {
      if (levelNumberSet.has(lvl.levelNumber)) {
        duplicatesFound++;
      }
      levelNumberSet.add(lvl.levelNumber);
    }
    recordCheck(
      2,
      'All level numbers are strictly unique',
      duplicatesFound === 0,
      duplicatesFound === 0 ? 'No duplicates detected' : `${duplicatesFound} duplicates found`
    );

    // 3. Check publication status (all seeded levels must be active)
    const inactiveLevels = allLevels.filter((lvl) => !lvl.isActive && lvl.levelNumber <= 50);
    recordCheck(
      3,
      'All seeded levels (1-50) have isActive: true',
      inactiveLevels.length === 0,
      inactiveLevels.length === 0 ? 'All levels active' : `${inactiveLevels.length} inactive levels found`
    );

    // 4. Check difficulty representation across all 5 bands
    const EXPECTED_BANDS = ['tutorial', 'easy', 'medium', 'hard', 'expert'];
    const difficultyCounts = {};
    for (const band of EXPECTED_BANDS) {
      difficultyCounts[band] = 0;
    }

    for (const lvl of allLevels.filter((l) => l.levelNumber <= 50)) {
      if (difficultyCounts[lvl.difficulty] !== undefined) {
        difficultyCounts[lvl.difficulty]++;
      }
    }

    const allBandsRepresented = EXPECTED_BANDS.every((band) => difficultyCounts[band] >= 5);
    const bandBreakdown = Object.entries(difficultyCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    recordCheck(
      4,
      'All 5 difficulty bands are represented in levels 1-50',
      allBandsRepresented,
      `Band counts -> ${bandBreakdown}`
    );

    // 5. Check schema and playability validation on all seeded levels (1-50)
    let validationFailures = 0;
    const failureMessages = [];

    for (const lvl of allLevels.filter((l) => l.levelNumber <= 50)) {
      try {
        const doc = new LevelModel(lvl);
        await doc.validate();
      } catch (err) {
        validationFailures++;
        failureMessages.push(`Level ${lvl.levelNumber} schema error: ${err.message}`);
        continue;
      }

      const playability = validatePlayabilityFn(lvl);
      if (!playability.isValid || playability.details?.isInconclusive === true) {
        validationFailures++;
        failureMessages.push(
          `Level ${lvl.levelNumber} playability error: ${playability.errors?.join(' | ') || 'Inconclusive'}`
        );
      }
    }

    recordCheck(
      5,
      'All seeded levels (1-50) pass schema and playability validation',
      validationFailures === 0,
      validationFailures === 0
        ? '50/50 levels successfully validated'
        : `Failures (${validationFailures}):\n       • ${failureMessages.slice(0, 5).join('\n       • ')}`
    );

    console.log('\n=============================================================');
    console.log(
      `Seeded Levels Verification: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`
    );
    console.log('=============================================================\n');

    const isVerified = failed === 0;
    return {
      success: isVerified,
      verified: isVerified,
      totalLevels: allLevels.length,
      passed,
      failed,
      checks: checkReports,
    };
  } catch (err) {
    console.error('Fatal error during level verification:', err.message);
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

export { runVerifySeededLevelsRunner as verifySeededLevels };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-seeded-levels.js') ||
    process.argv[1].endsWith('verify-seeded-levels'));

if (isMain) {
  runVerifySeededLevelsRunner()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal verification error:', err.message);
      process.exit(1);
    });
}
