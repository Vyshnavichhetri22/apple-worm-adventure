/**
 * @file seed-levels.js
 * @description Idempotent database seeding script for 50 distinct Apple Worm Adventure levels.
 * Validates each level against Mongoose schema rules and semantic playability BFS before inserting.
 */

import dns from 'node:dns';
// Resolve MongoDB Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from './src/config/database.js';
import Level from './src/models/Level.js';
import { validateLevelPlayability } from './src/services/levelValidationService.js';

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
// IDEMPOTENT SEEDING RUNNER
// ============================================================================
async function seedLevels() {
  console.log('=== Starting Apple Worm Adventure Level Seeding ===\n');

  let insertedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    // 1. Connect to MongoDB Atlas using the project's standard connectDB function
    if (typeof connectDB === 'function') {
      await connectDB();
    } else if (connectDB && typeof connectDB.connectDB === 'function') {
      await connectDB.connectDB();
    }

    console.log(`Auditing and validating ${levelsData.length} level definitions...\n`);

    for (const levelDef of levelsData) {
      const { levelNumber } = levelDef;

      // Idempotency: skip existing level documents without overwriting
      const existing = await Level.findOne({ levelNumber }).lean();
      if (existing) {
        console.log(`[SKIPPED] Level ${levelNumber} already exists in database.`);
        skippedCount++;
        continue;
      }

      // Step A: Mongoose Schema Validation
      const candidateDoc = new Level({ ...levelDef, isActive: true });
      try {
        await candidateDoc.validate();
      } catch (schemaErr) {
        const errorMsgs = Object.values(schemaErr.errors || {})
          .map((e) => e.message)
          .join(' | ');
        console.error(`[FAIL] Level ${levelNumber} failed schema validation: ${errorMsgs}`);
        failedCount++;
        continue;
      }

      // Step B: Semantic & Reachability Playability Validation
      const playability = validateLevelPlayability(candidateDoc.toObject());
      if (!playability.isValid || playability.details.isInconclusive === true) {
        const errDetails = playability.errors.join(' | ') || 'Inconclusive search';
        console.error(`[FAIL] Level ${levelNumber} failed playability verification: ${errDetails}`);
        failedCount++;
        continue;
      }

      // Step C: Insertion
      await candidateDoc.save();
      console.log(
        `[INSERTED] Level ${levelNumber} (${levelDef.difficulty}) verified and saved (states explored: ${playability.details.statesExplored}).`
      );
      insertedCount++;
    }

    console.log('\n=============================================================');
    console.log('Level Seeding Summary:');
    console.log(`  Total Processed: ${levelsData.length}`);
    console.log(`  Inserted:        ${insertedCount}`);
    console.log(`  Skipped:         ${skippedCount}`);
    console.log(`  Failed:          ${failedCount}`);
    console.log('=============================================================\n');

    if (failedCount > 0) {
      console.error(`Seeding aborted with ${failedCount} failures.`);
      process.exit(1);
    } else {
      console.log('All eligible levels processed successfully.');
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during level seeding:', err.message);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    }
  }
}

seedLevels();