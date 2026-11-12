/**
 * @file verify-seeded-levels.js
 * @description Comprehensive verification script testing that all 50 seeded levels exist in MongoDB Atlas,
 * are active, span all 5 difficulty bands, and pass both schema and playability validations.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from './src/config/database.js';
import Level from './src/models/Level.js';
import { validateLevelPlayability } from './src/services/levelValidationService.js';

let passed = 0;
let failed = 0;

function report(testNum, description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${testNum}. ${description}`);
    if (details) console.log(`       └─ Info: ${details}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testNum}. ${description}`);
    console.error(`       └─ Reason: ${details || 'Condition evaluated to false'}`);
    failed++;
  }
}

async function verifySeededLevels() {
  console.log('=== Verifying Seeded Levels in MongoDB Atlas ===\n');

  try {
    if (typeof connectDB === 'function') {
      await connectDB();
    } else if (connectDB && typeof connectDB.connectDB === 'function') {
      await connectDB.connectDB();
    }

    // 1. Check total count (must be at least 50 levels)
    const allLevels = await Level.find().sort({ levelNumber: 1 }).lean();
    report(
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
    report(
      2,
      'All level numbers are strictly unique',
      duplicatesFound === 0,
      duplicatesFound === 0 ? 'No duplicates detected' : `${duplicatesFound} duplicates found`
    );

    // 3. Check publication status (all seeded levels must be active)
    const inactiveLevels = allLevels.filter((lvl) => !lvl.isActive && lvl.levelNumber <= 50);
    report(
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
    report(
      4,
      'All 5 difficulty bands are represented in levels 1-50',
      allBandsRepresented,
      `Band counts -> ${bandBreakdown}`
    );

    // 5. Check schema and playability validation on all seeded levels (1-50)
    let validationFailures = 0;
    const failureMessages = [];

    for (const lvl of allLevels.filter((l) => l.levelNumber <= 50)) {
      // Schema validation
      try {
        const doc = new Level(lvl);
        await doc.validate();
      } catch (err) {
        validationFailures++;
        failureMessages.push(`Level ${lvl.levelNumber} schema error: ${err.message}`);
        continue;
      }

      // Semantic playability validation
      const playability = validateLevelPlayability(lvl);
      if (!playability.isValid || playability.details.isInconclusive === true) {
        validationFailures++;
        failureMessages.push(
          `Level ${lvl.levelNumber} playability error: ${playability.errors.join(' | ') || 'Inconclusive'}`
        );
      }
    }

    report(
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

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error during level verification:', err.message);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    }
  }
}

verifySeededLevels();