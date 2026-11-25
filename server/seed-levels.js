/**
 * @file seed-levels.js
 * @description Idempotent database seeding script for 50 distinct Apple Worm Adventure levels.
 * Validates each level against Mongoose schema rules and semantic playability BFS before inserting.
 */

import dns from 'node:dns';
// Resolve MongoDB Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Level from './src/models/Level.js';
import { validateLevelPlayability } from './src/services/levelValidationService.js';
import { parseMigrationCliArgs as defaultParseArgs } from './src/utils/parseMigrationCliArgs.js';
import { validateMigrationTarget as defaultValidateTarget } from './src/utils/validateMigrationTarget.js';

// Explicitly disable Mongoose auto-indexing for the seed workflow to prevent implicit index creation
mongoose.set('autoIndex', false);

// ============================================================================
// 50 DISTINCT LEVEL DEFINITIONS
// ============================================================================
export const levelsData = [
  // -------------------------------------------------------------------------
  // 1. TUTORIAL BAND (Levels 1 - 10)
  // Mechanics: Basic movement, introduction to apples, simple obstacles, reach portal.
  // -------------------------------------------------------------------------
  {
    levelNumber: 1,
    difficulty: 'tutorial',
    grid: { rows: 6, cols: 6 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 3, y: 1, type: 'normal' }],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 4, y: 4 },
    moveLimit: 20,
    starThresholds: { threeStars: 8, twoStars: 12, oneStar: 16 },
    objective: 'reach_portal',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 2,
    difficulty: 'tutorial',
    grid: { rows: 6, cols: 6 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 3, y: 2, type: 'normal' }],
    stones: [],
    keys: [],
    obstacles: [{ x: 1, y: 3, type: 'wall' }],
    portal: { x: 4, y: 4 },
    moveLimit: 20,
    starThresholds: { threeStars: 8, twoStars: 12, oneStar: 16 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 3,
    difficulty: 'tutorial',
    grid: { rows: 6, cols: 6 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 2, y: 3, type: 'normal' }],
    stones: [],
    keys: [],
    obstacles: [{ x: 3, y: 1, type: 'wall' }],
    portal: { x: 4, y: 4 },
    moveLimit: 22,
    starThresholds: { threeStars: 10, twoStars: 14, oneStar: 18 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 4,
    difficulty: 'tutorial',
    grid: { rows: 7, cols: 7 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 4, y: 3, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 5, y: 5 },
    moveLimit: 24,
    starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 5,
    difficulty: 'tutorial',
    grid: { rows: 7, cols: 7 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 4, y: 4, type: 'golden' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 5, y: 5 },
    moveLimit: 24,
    starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
    objective: 'collect_apple_count',
    targetValue: 1,
    isActive: true,
  },
  {
    levelNumber: 6,
    difficulty: 'tutorial',
    grid: { rows: 7, cols: 7 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 3, y: 3, type: 'golden' }],
    stones: [],
    keys: [],
    obstacles: [
      { x: 2, y: 2, type: 'wall' },
      { x: 4, y: 2, type: 'wall' },
    ],
    portal: { x: 5, y: 5 },
    moveLimit: 25,
    starThresholds: { threeStars: 11, twoStars: 16, oneStar: 21 },
    objective: 'reach_portal',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 7,
    difficulty: 'tutorial',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 1, type: 'normal' },
      { x: 4, y: 2, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 26,
    starThresholds: { threeStars: 12, twoStars: 17, oneStar: 22 },
    objective: 'reach_length',
    targetValue: 3,
    isActive: true,
  },
  {
    levelNumber: 8,
    difficulty: 'tutorial',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 3, y: 2, type: 'normal' }],
    stones: [],
    keys: [],
    obstacles: [{ x: 4, y: 4, type: 'pit' }],
    portal: { x: 6, y: 6 },
    moveLimit: 26,
    starThresholds: { threeStars: 12, twoStars: 17, oneStar: 22 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 9,
    difficulty: 'tutorial',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 2, y: 4, type: 'normal' },
      { x: 4, y: 2, type: 'golden' },
    ],
    stones: [],
    keys: [],
    obstacles: [{ x: 3, y: 3, type: 'spike' }],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 13, twoStars: 18, oneStar: 24 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 10,
    difficulty: 'tutorial',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 5, y: 2, type: 'golden' },
      { x: 4, y: 5, type: 'time' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 4, y: 1, type: 'wall' },
      { x: 4, y: 3, type: 'wall' },
    ],
    portal: { x: 6, y: 6 },
    moveLimit: 30,
    starThresholds: { threeStars: 15, twoStars: 20, oneStar: 26 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },

  // -------------------------------------------------------------------------
  // 2. EASY BAND (Levels 11 - 20)
  // Mechanics: Pushable stones, multiple apple types, length objectives, chambers.
  // -------------------------------------------------------------------------
  {
    levelNumber: 11,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 3, y: 3, type: 'normal' }],
    stones: [{ x: 4, y: 2 }],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 13, twoStars: 18, oneStar: 24 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 12,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 2, y: 3, type: 'normal' },
      { x: 5, y: 3, type: 'golden' },
    ],
    stones: [{ x: 3, y: 4 }],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 14, twoStars: 19, oneStar: 25 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 13,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 4, y: 3, type: 'golden' },
      { x: 5, y: 4, type: 'time' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 14, twoStars: 19, oneStar: 25 },
    objective: 'collect_apple_count',
    targetValue: 2,
    isActive: true,
  },
  {
    levelNumber: 14,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 1, type: 'normal' },
      { x: 4, y: 2, type: 'normal' },
      { x: 5, y: 3, type: 'golden' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 30,
    starThresholds: { threeStars: 15, twoStars: 20, oneStar: 26 },
    objective: 'reach_length',
    targetValue: 4,
    isActive: true,
  },
  {
    levelNumber: 15,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 2, y: 4, type: 'normal' },
      { x: 5, y: 2, type: 'normal' },
    ],
    stones: [{ x: 3, y: 2 }, { x: 4, y: 4 }],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 30,
    starThresholds: { threeStars: 15, twoStars: 21, oneStar: 27 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 16,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'golden' },
      { x: 4, y: 2, type: 'golden' },
      { x: 5, y: 2, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [{ x: 4, y: 4, type: 'pit' }],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 14, twoStars: 19, oneStar: 25 },
    objective: 'collect_apple_count',
    targetValue: 2,
    isActive: true,
  },
  {
    levelNumber: 17,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 2, y: 4, type: 'normal' },
      { x: 6, y: 2, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 4, y: 1, type: 'wall' },
      { x: 4, y: 3, type: 'wall' },
      { x: 4, y: 4, type: 'wall' },
      { x: 4, y: 5, type: 'wall' },
    ],
    portal: { x: 6, y: 6 },
    moveLimit: 32,
    starThresholds: { threeStars: 16, twoStars: 22, oneStar: 28 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 18,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 5, y: 2, type: 'normal' },
      { x: 2, y: 5, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 3, y: 2, type: 'wall' },
      { x: 4, y: 4, type: 'wall' },
    ],
    portal: { x: 6, y: 6 },
    moveLimit: 30,
    starThresholds: { threeStars: 15, twoStars: 20, oneStar: 26 },
    objective: 'reach_portal',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 19,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 5, y: 2, type: 'golden' },
    ],
    stones: [],
    keys: [],
    obstacles: [{ x: 3, y: 4, type: 'spike' }],
    portal: { x: 6, y: 6 },
    moveLimit: 28,
    starThresholds: { threeStars: 14, twoStars: 19, oneStar: 25 },
    objective: 'reach_length',
    targetValue: 3,
    isActive: true,
  },
  {
    levelNumber: 20,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 5, y: 3, type: 'time' },
      { x: 3, y: 5, type: 'mystery' },
    ],
    stones: [{ x: 4, y: 3 }],
    keys: [],
    obstacles: [{ x: 5, y: 1, type: 'wall' }],
    portal: { x: 6, y: 6 },
    moveLimit: 32,
    starThresholds: { threeStars: 16, twoStars: 22, oneStar: 28 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },

  // -------------------------------------------------------------------------
  // 3. MEDIUM BAND (Levels 21 - 30)
  // Mechanics: Keys & locked gates, multi-room mazes, collect_keys objective.
  // -------------------------------------------------------------------------
  {
    levelNumber: 21,
    difficulty: 'medium',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [{ x: 2, y: 3, keyId: 'k1' }],
    obstacles: [
      { x: 4, y: 0, type: 'wall' },
      { x: 4, y: 2, type: 'wall' },
      { x: 4, y: 3, type: 'wall' },
      { x: 4, y: 4, type: 'wall' },
      { x: 4, y: 5, type: 'wall' },
      { x: 4, y: 6, type: 'wall' },
      { x: 4, y: 7, type: 'wall' },
      { x: 4, y: 1, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 6, y: 1 },
    moveLimit: 30,
    starThresholds: { threeStars: 12, twoStars: 18, oneStar: 25 },
    objective: 'collect_keys',
    targetValue: 1,
    isActive: true,
  },
  {
    levelNumber: 22,
    difficulty: 'medium',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 6, y: 3, type: 'golden' }],
    stones: [],
    keys: [{ x: 2, y: 3, keyId: 'k1' }],
    obstacles: [
      { x: 4, y: 1, type: 'wall' },
      { x: 4, y: 3, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 6, y: 6 },
    moveLimit: 32,
    starThresholds: { threeStars: 15, twoStars: 21, oneStar: 27 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 23,
    difficulty: 'medium',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [
      { x: 2, y: 3, keyId: 'k1' },
      { x: 2, y: 5, keyId: 'k2' },
    ],
    obstacles: [],
    portal: { x: 6, y: 6 },
    moveLimit: 32,
    starThresholds: { threeStars: 16, twoStars: 22, oneStar: 28 },
    objective: 'collect_keys',
    targetValue: 2,
    isActive: true,
  },
  {
    levelNumber: 24,
    difficulty: 'medium',
    grid: { rows: 9, cols: 9 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [
      { x: 2, y: 3, keyId: 'k1' },
      { x: 5, y: 3, keyId: 'k2' },
    ],
    obstacles: [
      { x: 4, y: 1, type: 'gate', keyId: 'k1' },
      { x: 7, y: 1, type: 'gate', keyId: 'k2' },
    ],
    portal: { x: 7, y: 7 },
    moveLimit: 34,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'collect_keys',
    targetValue: 2,
    isActive: true,
  },
  {
    levelNumber: 25,
    difficulty: 'medium',
    grid: { rows: 9, cols: 9 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [
      { x: 2, y: 3, keyId: 'k1' },
      { x: 4, y: 5, keyId: 'k2' },
      { x: 6, y: 3, keyId: 'k3' },
    ],
    obstacles: [],
    portal: { x: 7, y: 7 },
    moveLimit: 35,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'collect_keys',
    targetValue: 3,
    isActive: true,
  },
  {
    levelNumber: 26,
    difficulty: 'medium',
    grid: { rows: 9, cols: 9 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 4, type: 'normal' },
      { x: 6, y: 2, type: 'golden' },
    ],
    stones: [{ x: 4, y: 3 }],
    keys: [{ x: 2, y: 3, keyId: 'k1' }],
    obstacles: [{ x: 5, y: 2, type: 'gate', keyId: 'k1' }],
    portal: { x: 7, y: 7 },
    moveLimit: 35,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 27,
    difficulty: 'medium',
    grid: { rows: 9, cols: 9 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [{ x: 2, y: 6, keyId: 'k1' }],
    obstacles: [
      { x: 4, y: 2, type: 'wall' },
      { x: 4, y: 4, type: 'wall' },
      { x: 6, y: 3, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 7, y: 7 },
    moveLimit: 36,
    starThresholds: { threeStars: 19, twoStars: 25, oneStar: 31 },
    objective: 'reach_portal',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 28,
    difficulty: 'medium',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 4, y: 3, type: 'normal' },
      { x: 5, y: 4, type: 'golden' },
      { x: 6, y: 5, type: 'mega' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 8, y: 8 },
    moveLimit: 36,
    starThresholds: { threeStars: 19, twoStars: 25, oneStar: 31 },
    objective: 'reach_length',
    targetValue: 5,
    isActive: true,
  },
  {
    levelNumber: 29,
    difficulty: 'medium',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 6, y: 2, type: 'golden' },
      { x: 7, y: 5, type: 'time' },
    ],
    stones: [],
    keys: [{ x: 2, y: 4, keyId: 'k1' }],
    obstacles: [{ x: 5, y: 2, type: 'gate', keyId: 'k1' }],
    portal: { x: 8, y: 8 },
    moveLimit: 38,
    starThresholds: { threeStars: 20, twoStars: 26, oneStar: 32 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 30,
    difficulty: 'medium',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 5, y: 5, type: 'normal' }],
    stones: [{ x: 4, y: 4 }],
    keys: [
      { x: 2, y: 3, keyId: 'k1' },
      { x: 2, y: 6, keyId: 'k2' },
    ],
    obstacles: [{ x: 6, y: 2, type: 'gate', keyId: 'k1' }],
    portal: { x: 8, y: 8 },
    moveLimit: 38,
    starThresholds: { threeStars: 20, twoStars: 26, oneStar: 32 },
    objective: 'collect_keys',
    targetValue: 2,
    isActive: true,
  },

  // -------------------------------------------------------------------------
  // 4. HARD BAND (Levels 31 - 40)
  // Mechanics: Moving blocks, limited moves, perfect route, timing hazards.
  // -------------------------------------------------------------------------
  {
    levelNumber: 31,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 4, y: 1, type: 'normal' }],
    stones: [],
    keys: [],
    obstacles: [
      // Patrols horizontally across (6,2) and (7,2)
      { x: 5, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 8, y: 8 },
    moveLimit: 36,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'reach_portal',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 32,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 2, y: 4, type: 'golden' }],
    stones: [],
    keys: [],
    obstacles: [
      // Patrols vertically down (4,4) and (4,5)
      { x: 4, y: 3, type: 'moving_block', axis: 'vertical', range: 2 },
    ],
    portal: { x: 8, y: 8 },
    moveLimit: 36,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 33,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 5, y: 4, type: 'golden' },
      { x: 7, y: 6, type: 'time' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 8, y: 8 },
    moveLimit: 30,
    starThresholds: { threeStars: 15, twoStars: 22, oneStar: 28 },
    objective: 'limited_moves',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 34,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 1 }, // Shortest distance is 4
    moveLimit: 20,
    starThresholds: { threeStars: 6, twoStars: 10, oneStar: 15 },
    objective: 'perfect_route',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 35,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 2, y: 4, type: 'normal' },
      { x: 5, y: 4, type: 'golden' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 3, y: 6, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 8, y: 8 },
    moveLimit: 36,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 36,
    difficulty: 'hard',
    grid: { rows: 10, cols: 10 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [{ x: 2, y: 5, keyId: 'k1' }],
    obstacles: [
      { x: 6, y: 2, type: 'moving_block', axis: 'vertical', range: 2 },
      { x: 5, y: 5, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 8, y: 8 },
    moveLimit: 36,
    starThresholds: { threeStars: 18, twoStars: 24, oneStar: 30 },
    objective: 'collect_keys',
    targetValue: 1,
    isActive: true,
  },
  {
    levelNumber: 37,
    difficulty: 'hard',
    grid: { rows: 11, cols: 11 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 6, y: 4, type: 'golden' },
      { x: 8, y: 7, type: 'time' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 4, y: 2, type: 'moving_block', axis: 'vertical', range: 2 },
    ],
    portal: { x: 9, y: 9 },
    moveLimit: 35,
    starThresholds: { threeStars: 18, twoStars: 25, oneStar: 32 },
    objective: 'limited_moves',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 38,
    difficulty: 'hard',
    grid: { rows: 11, cols: 11 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 4, y: 2, type: 'normal' },
      { x: 7, y: 6, type: 'golden' },
      { x: 5, y: 8, type: 'mystery' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 2, y: 4, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 7, y: 4, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 9, y: 9 },
    moveLimit: 38,
    starThresholds: { threeStars: 20, twoStars: 26, oneStar: 32 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 39,
    difficulty: 'hard',
    grid: { rows: 11, cols: 11 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 1 }, // Shortest distance is 4
    moveLimit: 25,
    starThresholds: { threeStars: 8, twoStars: 14, oneStar: 20 },
    objective: 'perfect_route',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 40,
    difficulty: 'hard',
    grid: { rows: 11, cols: 11 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [{ x: 5, y: 3, type: 'normal' }],
    stones: [],
    keys: [{ x: 2, y: 5, keyId: 'k1' }],
    obstacles: [
      { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 7, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 5, y: 5, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 9, y: 9 },
    moveLimit: 38,
    starThresholds: { threeStars: 20, twoStars: 26, oneStar: 32 },
    objective: 'collect_keys',
    targetValue: 1,
    isActive: true,
  },

  // -------------------------------------------------------------------------
  // 5. EXPERT BAND (Levels 41 - 50)
  // Mechanics: Large grids, multiple moving blocks, keys/gates combinations, stones.
  // -------------------------------------------------------------------------
  {
    levelNumber: 41,
    difficulty: 'expert',
    grid: { rows: 12, cols: 12 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [{ x: 2, y: 5, keyId: 'k1' }],
    obstacles: [
      { x: 4, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 4, y: 7, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 6, y: 5, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 10, y: 10 },
    moveLimit: 40,
    starThresholds: { threeStars: 22, twoStars: 28, oneStar: 35 },
    objective: 'collect_keys',
    targetValue: 1,
    isActive: true,
  },
  {
    levelNumber: 42,
    difficulty: 'expert',
    grid: { rows: 12, cols: 12 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 5, type: 'normal' },
      { x: 6, y: 5, type: 'golden' },
      { x: 8, y: 5, type: 'time' },
      { x: 9, y: 8, type: 'mega' },
    ],
    stones: [{ x: 4, y: 2 }, { x: 7, y: 2 }],
    keys: [],
    obstacles: [
      { x: 3, y: 4, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 7, y: 4, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 10, y: 10 },
    moveLimit: 42,
    starThresholds: { threeStars: 24, twoStars: 30, oneStar: 36 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 43,
    difficulty: 'expert',
    grid: { rows: 12, cols: 12 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 2, type: 'normal' },
      { x: 5, y: 3, type: 'golden' },
      { x: 7, y: 4, type: 'time' },
      { x: 8, y: 6, type: 'mystery' },
      { x: 9, y: 8, type: 'mega' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 10, y: 10 },
    moveLimit: 44,
    starThresholds: { threeStars: 25, twoStars: 32, oneStar: 38 },
    objective: 'reach_length',
    targetValue: 6,
    isActive: true,
  },
  {
    levelNumber: 44,
    difficulty: 'expert',
    grid: { rows: 12, cols: 12 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [
      { x: 2, y: 3, keyId: 'k1' },
      { x: 2, y: 6, keyId: 'k2' },
      { x: 2, y: 9, keyId: 'k3' },
    ],
    obstacles: [],
    portal: { x: 10, y: 10 },
    moveLimit: 42,
    starThresholds: { threeStars: 24, twoStars: 30, oneStar: 36 },
    objective: 'collect_keys',
    targetValue: 3,
    isActive: true,
  },
  {
    levelNumber: 45,
    difficulty: 'expert',
    grid: { rows: 13, cols: 13 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 4, type: 'normal' },
      { x: 6, y: 6, type: 'golden' },
      { x: 9, y: 8, type: 'time' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 4, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 8, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 11, y: 11 },
    moveLimit: 40,
    starThresholds: { threeStars: 20, twoStars: 28, oneStar: 36 },
    objective: 'limited_moves',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 46,
    difficulty: 'expert',
    grid: { rows: 13, cols: 13 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 1 }, // Shortest distance is 4
    moveLimit: 28,
    starThresholds: { threeStars: 8, twoStars: 15, oneStar: 22 },
    objective: 'perfect_route',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 47,
    difficulty: 'expert',
    grid: { rows: 13, cols: 13 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 5, y: 5, type: 'golden' },
      { x: 8, y: 7, type: 'mega' },
    ],
    stones: [{ x: 4, y: 3 }, { x: 7, y: 3 }],
    keys: [
      { x: 2, y: 4, keyId: 'k1' },
      { x: 2, y: 7, keyId: 'k2' },
    ],
    obstacles: [
      { x: 4, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 8, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 6, y: 4, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 11, y: 11 },
    moveLimit: 44,
    starThresholds: { threeStars: 25, twoStars: 32, oneStar: 38 },
    objective: 'collect_keys',
    targetValue: 2,
    isActive: true,
  },
  {
    levelNumber: 48,
    difficulty: 'expert',
    grid: { rows: 14, cols: 14 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 4, type: 'normal' },
      { x: 6, y: 6, type: 'golden' },
      { x: 9, y: 8, type: 'time' },
      { x: 11, y: 10, type: 'mystery' },
    ],
    stones: [{ x: 4, y: 2 }, { x: 8, y: 2 }],
    keys: [],
    obstacles: [
      { x: 4, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 8, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 5, y: 5, type: 'spike' },
    ],
    portal: { x: 12, y: 12 },
    moveLimit: 46,
    starThresholds: { threeStars: 26, twoStars: 33, oneStar: 40 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
  {
    levelNumber: 49,
    difficulty: 'expert',
    grid: { rows: 14, cols: 14 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 3, type: 'normal' },
      { x: 6, y: 5, type: 'golden' },
      { x: 9, y: 7, type: 'time' },
      { x: 11, y: 9, type: 'mega' },
    ],
    stones: [],
    keys: [],
    obstacles: [
      { x: 4, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 8, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
    portal: { x: 12, y: 12 },
    moveLimit: 46,
    starThresholds: { threeStars: 26, twoStars: 33, oneStar: 40 },
    objective: 'reach_length',
    targetValue: 5,
    isActive: true,
  },
  {
    levelNumber: 50,
    difficulty: 'expert',
    grid: { rows: 14, cols: 14 },
    wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 4, type: 'normal' },
      { x: 6, y: 6, type: 'golden' },
      { x: 9, y: 8, type: 'mystery' },
      { x: 11, y: 10, type: 'mega' },
    ],
    stones: [{ x: 4, y: 2 }, { x: 8, y: 2 }],
    keys: [{ x: 2, y: 5, keyId: 'k1' }],
    obstacles: [
      { x: 4, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 8, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
      { x: 6, y: 5, type: 'gate', keyId: 'k1' },
    ],
    portal: { x: 12, y: 12 },
    moveLimit: 48,
    starThresholds: { threeStars: 28, twoStars: 35, oneStar: 42 },
    objective: 'eat_all_apples',
    targetValue: null,
    isActive: true,
  },
];

// ============================================================================
// HARDENED IDEMPOTENT SEEDING RUNNER
// ============================================================================
export async function runSeedLevelsRunner(args = process.argv.slice(2), deps = {}) {
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

  const { isApply, isProductionConfirm } = parsed;
  const isProd = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI;

  // Gate 3: Check URI presence
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim().length === 0) {
    console.error('❌ Refusing to run: MONGODB_URI environment variable is not defined.');
    return { success: false, reason: 'MISSING_MONGODB_URI', error: 'MONGODB_URI is not defined.' };
  }

  // Gate 4: Production safety confirmation
  if (isApply && isProd && !isProductionConfirm) {
    console.error(
      '❌ SAFETY REFUSAL: Running live seed execution in production requires both "--apply" and "--confirm-production" flags.'
    );
    return { success: false, reason: 'MISSING_PRODUCTION_CONFIRMATION', error: 'Production confirmation required.' };
  }

  // Gate 5: Pre-Connection Target Validation
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

  // Gate 5B: Enforce staging target identity (must be apple_worm_staging unless explicitly confirming production)
  if (!isProductionConfirm && validation.target.dbName !== 'apple_worm_staging') {
    const err = `Target database "${validation.target.dbName}" is not the expected staging database "apple_worm_staging".`;
    console.error(`❌ SAFETY REFUSAL: ${err}`);
    return {
      success: false,
      reason: 'INVALID_STAGING_TARGET',
      error: err,
    };
  }

  const mode = isApply ? 'LIVE EXECUTION' : 'DRY-RUN (READ-ONLY)';
  console.log('=============================================================');
  console.log('🌱 APPLE WORM ADVENTURE LEVEL SEED RUNNER');
  console.log('=============================================================');
  console.log(`Execution Mode : [ ${mode} ]`);
  console.log(`Target Database: ${validation.target.redactedUri}`);
  console.log(`Environment    : ${process.env.NODE_ENV || 'staging'}`);
  console.log('-------------------------------------------------------------');

  // Disable Mongoose automatic indexing before connection
  mongoose.set('autoIndex', false);

  const connectFn = deps.connect || (async (uri, opts) => mongoose.connect(uri, opts));
  const disconnectFn = deps.disconnect || (async () => mongoose.disconnect());
  const getConnection = deps.getConnection || (() => mongoose.connection);
  const LevelModel = deps.LevelModel || Level;
  const validatePlayabilityFn = deps.validatePlayability || validateLevelPlayability;
  const seedData = deps.levelsData || levelsData;

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

    // Fetch existing levels to enforce idempotency and avoid overwrites
    const existingDocs = await LevelModel.find({}, { levelNumber: 1 }).lean();
    const existingNumbers = new Set(existingDocs.map((doc) => doc.levelNumber));

    let insertedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const failures = [];

    console.log(`Auditing and validating ${seedData.length} level definitions...\n`);

    for (const levelDef of seedData) {
      const { levelNumber } = levelDef;

      if (existingNumbers.has(levelNumber)) {
        console.log(`[SKIPPED] Level ${levelNumber} already exists in database.`);
        skippedCount++;
        continue;
      }

      // Step A: Schema validation
      const candidateDoc = new LevelModel({ ...levelDef, isActive: true });
      try {
        await candidateDoc.validate();
      } catch (schemaErr) {
        const errorMsgs = Object.values(schemaErr.errors || {})
          .map((e) => e.message)
          .join(' | ');
        console.error(`[FAIL] Level ${levelNumber} failed schema validation: ${errorMsgs}`);
        failedCount++;
        failures.push({ levelNumber, reason: errorMsgs });
        continue;
      }

      // Step B: Semantic & Reachability Playability Validation
      const rawLevelObj = candidateDoc.toObject ? candidateDoc.toObject() : candidateDoc;
      const playability = validatePlayabilityFn(rawLevelObj);
      if (!playability.isValid || playability.details?.isInconclusive === true) {
        const errDetails = playability.errors?.join(' | ') || 'Inconclusive search';
        console.error(`[FAIL] Level ${levelNumber} failed playability verification: ${errDetails}`);
        failedCount++;
        failures.push({ levelNumber, reason: errDetails });
        continue;
      }

      // Step C: Apply Gate
      if (isApply) {
        await candidateDoc.save();
        console.log(
          `[INSERTED] Level ${levelNumber} (${levelDef.difficulty}) verified and saved (states explored: ${playability.details?.statesExplored ?? 'N/A'}).`
        );
        insertedCount++;
      } else {
        // In Dry-run mode, we record it as planned insertion without saving
        console.log(
          `[PLAN_INSERT] Level ${levelNumber} (${levelDef.difficulty}) verified (dry-run: no write).`
        );
        insertedCount++;
      }
    }

    console.log('\n=============================================================');
    console.log('Level Seeding Summary:');
    console.log(`  - Mode:           ${mode}`);
    console.log(`  - Total Levels:   ${seedData.length}`);
    console.log(`  - ${isApply ? 'Inserted' : 'Would Insert'}:  ${insertedCount}`);
    console.log(`  - ${isApply ? 'Skipped' : 'Would Skip'}:   ${skippedCount}`);
    console.log(`  - Invalid/Failed: ${failedCount}`);
    console.log('=============================================================\n');

    if (!isApply) {
      console.log('ℹ️  Dry-run completed successfully. Zero database writes or index modifications occurred.');
      console.log('   To apply seed records to staging, execute with: --apply\n');
    } else {
      console.log('✅ Live seeding completed successfully.\n');
    }

    if (failedCount > 0) {
      console.error(`❌ Seeding completed with ${failedCount} failures.`);
      return {
        success: false,
        dryRun: !isApply,
        reason: 'SEED_VALIDATION_FAILURE',
        error: `${failedCount} levels failed validation or persistence.`,
        report: {
          total: seedData.length,
          inserted: insertedCount,
          skipped: skippedCount,
          failed: failedCount,
          failures,
        },
      };
    }

    return {
      success: true,
      dryRun: !isApply,
      report: {
        total: seedData.length,
        inserted: insertedCount,
        skipped: skippedCount,
        failed: 0,
      },
    };
  } catch (err) {
    console.error('Fatal error during level seeding:', err.message);
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

export { runSeedLevelsRunner as seedLevels };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('seed-levels.js') || process.argv[1].endsWith('seed-levels'));

if (isMain) {
  runSeedLevelsRunner()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal runner error:', err.message);
      process.exit(1);
    });
}