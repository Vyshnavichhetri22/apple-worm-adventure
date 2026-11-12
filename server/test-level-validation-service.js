/**
 * @file test-level-validation-service.js
 * @description Comprehensive unit and integration test suite for levelValidationService.js.
 * Validates bounded BFS, BigInt bitmasks, inconclusive budget handling, worm configurations,
 * objective targets, and diagnostic warnings.
 */

import dns from 'node:dns';
// Ensure DNS resolution consistency with project standards
dns.setServers(['8.8.8.8', '1.1.1.1']);

import { validateLevelPlayability } from './src/services/levelValidationService.js';

let passed = 0;
let failed = 0;

function report(testNum, description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${testNum}. ${description}`);
    if (details) console.log(`       └─ Info: ${details}`);
    passed++;
  } else {
    console.log(`[FAIL] ${testNum}. ${description}`);
    console.log(`       └─ Reason: ${details || 'Condition evaluated to false'}`);
    failed++;
  }
}

console.log('=== Running Level Validation Service Semantic & Reachability Tests ===\n');

// ---------------------------------------------------------------------------
// Helper: Generates a baseline valid 8x8 level
// ---------------------------------------------------------------------------
function createBaseLevel(overrides = {}) {
  return {
    levelNumber: 1,
    difficulty: 'easy',
    grid: { rows: 8, cols: 8 },
    wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
    apples: [
      { x: 3, y: 1, type: 'normal' },
    ],
    stones: [],
    keys: [],
    obstacles: [],
    portal: { x: 6, y: 1 },
    moveLimit: 25,
    starThresholds: [10, 15, 20],
    objective: 'reach_portal',
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEST 1: Baseline valid level passes validation
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel();
  const res = validateLevelPlayability(level);
  report(
    1,
    'Complete valid level passes playability validation',
    res.isValid === true && res.details.canReachPortal === true && res.details.portalDistance === 5,
    `Portal distance: ${res.details.portalDistance}, states explored: ${res.details.statesExplored}`
  );
}

// ---------------------------------------------------------------------------
// TEST 2: Portal walled off and completely unreachable
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    portal: { x: 7, y: 7 },
    obstacles: [
      { x: 6, y: 7, type: 'wall' },
      { x: 6, y: 6, type: 'wall' },
      { x: 7, y: 6, type: 'wall' },
    ],
  });
  const res = validateLevelPlayability(level);
  const hasError = res.errors.some((e) => e.includes('Portal at (7, 7) cannot be reached'));
  report(
    2,
    'Unreachable portal enclosed by static walls fails validation',
    res.isValid === false && res.details.canReachPortal === false && hasError,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 3: Invalid options.maxStates (0, negative, decimal, NaN, Infinity)
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel();
  const badBudgets = [0, -10, 5.5, NaN, Infinity, '1000'];
  let allRejected = true;

  for (const b of badBudgets) {
    const res = validateLevelPlayability(level, { maxStates: b });
    if (res.isValid !== false || !res.errors.some((e) => e.includes('Invalid options.maxStates'))) {
      allRejected = false;
      break;
    }
  }

  report(
    3,
    'Invalid options.maxStates (0, negative, decimal, NaN, Infinity) are rejected with clear error',
    allRejected,
    'Strict type and range validation enforced on options.maxStates'
  );
}

// ---------------------------------------------------------------------------
// TEST 4: Invalid grid dimensions (out of bounds, non-integer, NaN)
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    grid: { rows: 2, cols: 35 }, // rows < 4, cols > 30
  });
  const res = validateLevelPlayability(level);
  const rowsErr = res.errors.some((e) => e.includes('Grid rows must be a finite integer between 4 and 30'));
  const colsErr = res.errors.some((e) => e.includes('Grid cols must be a finite integer between 4 and 30'));
  report(
    4,
    'Invalid grid dimensions (rows < 4, cols > 30) are rejected before BFS',
    res.isValid === false && rowsErr && colsErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 5: Invalid worm direction is rejected
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    wormStart: { x: 2, y: 2, direction: 'DIAGONAL', initialLength: 2 },
  });
  const res = validateLevelPlayability(level);
  const dirErr = res.errors.some((e) => e.includes('Invalid worm direction "DIAGONAL"'));
  report(
    5,
    'Invalid worm direction "DIAGONAL" is rejected',
    res.isValid === false && dirErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 6: Invalid worm initialLength (< 2, decimal, negative)
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 1 },
  });
  const res = validateLevelPlayability(level);
  const lenErr = res.errors.some((e) => e.includes('wormStart.initialLength must be a finite integer >= 2'));
  report(
    6,
    'wormStart.initialLength < 2 is rejected',
    res.isValid === false && lenErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 7: Worm initial trailing body starts out of bounds
// ---------------------------------------------------------------------------
{
  // Head at (0, 0), moving RIGHT. Tail extends to (x - 1, 0) = (-1, 0) -> Out of bounds!
  const level = createBaseLevel({
    wormStart: { x: 0, y: 0, direction: 'RIGHT', initialLength: 2 },
  });
  const res = validateLevelPlayability(level);
  const oobErr = res.errors.some((e) => e.includes('extends outside grid boundaries'));
  report(
    7,
    'Initial worm tail segment extending outside grid boundaries is rejected',
    res.isValid === false && oobErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 8: Worm initial body blocks navigation (cannot pass through own tail)
// ---------------------------------------------------------------------------
{
  // Corridor at y=1 with walls above and below.
  // Worm starts at (3, 1) facing LEFT with length 3:
  // Segment 0: (3, 1) [head]
  // Segment 1: (4, 1) [tail]
  // Segment 2: (5, 1) [tail]
  // Portal is at (6, 1). Tail at (4, 1) and (5, 1) blocks access.
  const level = createBaseLevel({
    grid: { rows: 5, cols: 8 },
    wormStart: { x: 3, y: 1, direction: 'LEFT', initialLength: 3 },
    portal: { x: 6, y: 1 },
    obstacles: [
      { x: 0, y: 0, type: 'wall' }, { x: 1, y: 0, type: 'wall' }, { x: 2, y: 0, type: 'wall' },
      { x: 3, y: 0, type: 'wall' }, { x: 4, y: 0, type: 'wall' }, { x: 5, y: 0, type: 'wall' },
      { x: 6, y: 0, type: 'wall' }, { x: 7, y: 0, type: 'wall' },
      { x: 0, y: 2, type: 'wall' }, { x: 1, y: 2, type: 'wall' }, { x: 2, y: 2, type: 'wall' },
      { x: 3, y: 2, type: 'wall' }, { x: 4, y: 2, type: 'wall' }, { x: 5, y: 2, type: 'wall' },
      { x: 6, y: 2, type: 'wall' }, { x: 7, y: 2, type: 'wall' },
      { x: 0, y: 1, type: 'wall' }, // Block left exit
    ],
  });
  const res = validateLevelPlayability(level);
  report(
    8,
    'Initial worm trailing body acts as impassable obstacle in static reachability',
    res.isValid === false && res.details.canReachPortal === false,
    'Portal correctly flagged unreachable because starting tail blocks corridor'
  );
}

// ---------------------------------------------------------------------------
// TEST 9: Arbitrary key support with 10 distinct keys (BigInt bitmask scaling)
// ---------------------------------------------------------------------------
{
  // 10 distinct, valid, non-overlapping coordinates avoiding worm body, apple, and portal
  const keys = [
    { keyId: 'key_0', x: 1, y: 3 },
    { keyId: 'key_1', x: 2, y: 3 },
    { keyId: 'key_2', x: 3, y: 3 },
    { keyId: 'key_3', x: 4, y: 3 },
    { keyId: 'key_4', x: 5, y: 3 },
    { keyId: 'key_5', x: 1, y: 4 },
    { keyId: 'key_6', x: 2, y: 4 },
    { keyId: 'key_7', x: 3, y: 4 },
    { keyId: 'key_8', x: 4, y: 4 },
    { keyId: 'key_9', x: 5, y: 4 },
  ];
  const level = createBaseLevel({
    keys,
    objective: 'collect_keys',
    targetValue: 10,
  });
  // Explicitly supply a sufficient budget to prevent accidental exhaustion on 10-key search space
  const res = validateLevelPlayability(level, { maxStates: 100000 });
  report(
    9,
    'Level with 10 distinct keys is correctly modeled with BigInt bitmasks and verified',
    res.isValid === true && res.details.reachableKeys.length === 10,
    `Collected ${res.details.reachableKeys.length} distinct keys without mask overflow`
  );
}

// ---------------------------------------------------------------------------
// TEST 10: Gate unlocked by key allows worm to reach portal
// ---------------------------------------------------------------------------
{
  // Full wall barrier spanning column x = 4, with gate at (4, 1)
  const barrier = [];
  for (let y = 0; y < 8; y++) {
    if (y === 1) {
      barrier.push({ x: 4, y: 1, type: 'gate', keyId: 'gate_key_1' });
    } else {
      barrier.push({ x: 4, y, type: 'wall' });
    }
  }

  const level = createBaseLevel({
    keys: [{ keyId: 'gate_key_1', x: 2, y: 1 }],
    obstacles: barrier,
    portal: { x: 6, y: 1 },
  });
  const res = validateLevelPlayability(level);
  report(
    10,
    'Gate unlocked by reachable key allows path progression to portal',
    res.isValid === true && res.details.canReachPortal === true && res.details.portalDistance !== null,
    `Shortest path traversing key -> gate -> portal: ${res.details.portalDistance} steps`
  );
}

// ---------------------------------------------------------------------------
// TEST 11: Gate whose key is unreachable prevents passing through
// ---------------------------------------------------------------------------
{
  // Barrier spanning column x = 4 with gate at (4, 1)
  const barrier = [];
  for (let y = 0; y < 8; y++) {
    if (y === 1) {
      barrier.push({ x: 4, y: 1, type: 'gate', keyId: 'unreachable_key' });
    } else {
      barrier.push({ x: 4, y, type: 'wall' });
    }
  }

  // Key is placed behind the gate it unlocks (deadlock)
  const level = createBaseLevel({
    keys: [{ keyId: 'unreachable_key', x: 6, y: 1 }],
    obstacles: barrier,
    portal: { x: 7, y: 1 },
  });
  const res = validateLevelPlayability(level);
  report(
    11,
    'Deadlocked gate with unreachable key blocks portal reachability',
    res.isValid === false && res.details.canReachPortal === false,
    'Portal correctly flagged unreachable because key is behind gate'
  );
}

// ---------------------------------------------------------------------------
// TEST 12: Gate without keyId is treated as impassable with advisory warning
// ---------------------------------------------------------------------------
{
  const barrier = [];
  for (let y = 0; y < 8; y++) {
    if (y === 1) {
      barrier.push({ x: 4, y: 1, type: 'gate' }); // No keyId
    } else {
      barrier.push({ x: 4, y, type: 'wall' });
    }
  }

  const level = createBaseLevel({
    obstacles: barrier,
    portal: { x: 6, y: 1 },
  });
  const res = validateLevelPlayability(level);
  const hasWarning = res.warnings.some((w) => w.includes('with no keyId; treated as permanently impassable'));
  report(
    12,
    'Unlinked gate without keyId is treated as impassable and issues warning',
    res.isValid === false && res.details.canReachPortal === false && hasWarning,
    res.warnings.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 13: Move limit lower than shortest BFS path to portal is rejected
// ---------------------------------------------------------------------------
{
  // Portal is at (6, 1), worm at (1, 1). Distance is 5.
  // Set moveLimit to 3.
  const level = createBaseLevel({
    moveLimit: 3,
  });
  const res = validateLevelPlayability(level);
  const moveErr = res.errors.some((e) => e.includes('strictly less than shortest path to portal'));
  report(
    13,
    'Move limit lower than minimum portal distance fails validation',
    res.isValid === false && moveErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 14: Objective "eat_all_apples" fails when an apple is unreachable
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    objective: 'eat_all_apples',
    apples: [
      { x: 3, y: 1, type: 'normal' },
      { x: 7, y: 7, type: 'golden' }, // Blocked apple
    ],
    obstacles: [
      { x: 6, y: 7, type: 'wall' },
      { x: 7, y: 6, type: 'wall' },
    ],
  });
  const res = validateLevelPlayability(level);
  const objErr = res.errors.some((e) => e.includes('Objective "eat_all_apples" failed'));
  report(
    14,
    'Objective "eat_all_apples" fails when any apple is walled off',
    res.isValid === false && objErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 15: Objective "reach_length" fails when potential worm length cannot satisfy targetValue
// ---------------------------------------------------------------------------
{
  // Start length 2, requires length 5, but only 1 apple available
  const level = createBaseLevel({
    objective: 'reach_length',
    targetValue: 5,
    apples: [{ x: 3, y: 1, type: 'normal' }],
  });
  const res = validateLevelPlayability(level);
  const lenErr = res.errors.some((e) => e.includes('Objective "reach_length" requires length 5'));
  report(
    15,
    'Objective "reach_length" fails when potential worm length cannot satisfy targetValue',
    res.isValid === false && lenErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 16: Budget exhausted BEFORE finding portal -> canReachPortal is null
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    portal: { x: 7, y: 7 },
  });
  // Search from (1, 1) to (7, 7) takes >= 12 steps. Constrain budget to 3 states.
  const res = validateLevelPlayability(level, { maxStates: 3 });
  const hasDefinitiveUnreachableError = res.errors.some((e) =>
    e.includes('cannot be reached from starting state')
  );
  const hasInconclusiveWarning = res.warnings.some((w) =>
    w.includes('exhausted before exploration finished')
  );

  report(
    16,
    'Inconclusive search asserts canReachPortal is null and avoids definitive unreachable error',
    res.isValid === false &&
      res.details.isInconclusive === true &&
      res.details.canReachPortal === null &&
      !hasDefinitiveUnreachableError &&
      hasInconclusiveWarning,
    `canReachPortal: ${res.details.canReachPortal}, isInconclusive: ${res.details.isInconclusive}, definitiveErrorAvoided: ${!hasDefinitiveUnreachableError}`
  );
}

// ---------------------------------------------------------------------------
// TEST 17: Objective "collect_apple_count" validates targetValue bounds
// ---------------------------------------------------------------------------
{
  // Level has 1 apple, but targetValue is 3
  const level = createBaseLevel({
    objective: 'collect_apple_count',
    targetValue: 3,
    apples: [{ x: 3, y: 1, type: 'normal' }],
  });
  const res = validateLevelPlayability(level);
  const countErr = res.errors.some((e) => e.includes('exceeds total apples in level'));
  report(
    17,
    'Objective "collect_apple_count" rejects targetValue exceeding total apples in level',
    res.isValid === false && countErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 18: Objective "collect_keys" validates targetValue bounds
// ---------------------------------------------------------------------------
{
  // Level has 1 key, but targetValue is 4
  const level = createBaseLevel({
    objective: 'collect_keys',
    targetValue: 4,
    keys: [{ keyId: 'k1', x: 2, y: 1 }],
  });
  const res = validateLevelPlayability(level);
  const keyErr = res.errors.some((e) => e.includes('exceeds total keys in level'));
  report(
    18,
    'Objective "collect_keys" rejects targetValue exceeding total keys in level',
    res.isValid === false && keyErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 19: Advisory warnings emitted for multiple apples, stones, and moving blocks
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    apples: [
      { x: 2, y: 1, type: 'normal' },
      { x: 3, y: 1, type: 'golden' },
    ],
    stones: [{ x: 5, y: 1 }],
    obstacles: [
      { x: 4, y: 3, type: 'moving_block', axis: 'horizontal', range: 2 },
    ],
  });
  const res = validateLevelPlayability(level);
  const hasAppleWarn = res.warnings.some((w) => w.includes('Static BFS verifies individual apple reachability'));
  const hasStoneWarn = res.warnings.some((w) => w.includes('pushable stone(s); dynamic displacement'));
  const hasMovingWarn = res.warnings.some((w) => w.includes('moving block(s); patrol timing'));

  report(
    19,
    'Advisory warnings correctly emitted for continuous route, stones, and moving blocks',
    hasAppleWarn && hasStoneWarn && hasMovingWarn,
    `Warnings generated (${res.warnings.length}):\n       • ${res.warnings.join('\n       • ')}`
  );
}

// ---------------------------------------------------------------------------
// TEST 20: Objective "perfect_route" verifies 3-star threshold
// ---------------------------------------------------------------------------
{
  // Worm at (1, 1), portal at (6, 1) -> distance 5.
  // 3-star threshold set to 4 moves -> impossible.
  const level = createBaseLevel({
    objective: 'perfect_route',
    starThresholds: [4, 8, 12],
  });
  const res = validateLevelPlayability(level);
  const routeErr = res.errors.some((e) =>
    e.includes('Objective "perfect_route": shortest route to portal (5) exceeds 3-star threshold')
  );
  report(
    20,
    'Objective "perfect_route" fails when 3-star threshold is less than portal distance',
    res.isValid === false && routeErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// TEST 21: Portal FOUND before budget is exhausted -> canReachPortal is true
// ---------------------------------------------------------------------------
{
  // Portal is immediately adjacent at (2, 1) (distance 1).
  // Constrain budget to 2 states: portal is discovered at state 1, but budget exhausts at state 2.
  const level = createBaseLevel({
    portal: { x: 2, y: 1 },
  });
  const res = validateLevelPlayability(level, { maxStates: 2 });
  const hasInconclusiveWarning = res.warnings.some((w) =>
    w.includes('exhausted before exploration finished')
  );

  report(
    21,
    'Portal found before budget exhaustion asserts canReachPortal is true and isInconclusive is true',
    res.isValid === false &&
      res.details.canReachPortal === true &&
      res.details.isInconclusive === true &&
      res.details.portalDistance === 1 &&
      hasInconclusiveWarning,
    `canReachPortal: ${res.details.canReachPortal}, portalDistance: ${res.details.portalDistance}, isInconclusive: ${res.details.isInconclusive}`
  );
}

// ---------------------------------------------------------------------------
// TEST 22: Objective "collect_keys" with zero keys fails validation
// ---------------------------------------------------------------------------
{
  const level = createBaseLevel({
    objective: 'collect_keys',
    keys: [], // Zero keys, targetValue omitted
  });
  const res = validateLevelPlayability(level);
  const keyErr = res.errors.some((e) =>
    e.includes('requires at least one key in the level')
  );
  report(
    22,
    'Objective "collect_keys" with zero keys is rejected with a clear error',
    res.isValid === false && keyErr,
    res.errors.join(' | ')
  );
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log('\n=============================================================');
console.log(`Validation Service Tests Completed: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('=============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}