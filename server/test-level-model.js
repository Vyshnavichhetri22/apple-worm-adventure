import Level from './src/models/Level.js';

async function runUpdatedLevelValidationTests() {
  let passedCount = 0;
  let failedCount = 0;

  console.log('=== Running Comprehensive Level Model Schema Validation Tests ===\n');

  function report(testName, passed, details = '') {
    if (passed) {
      console.log(`[PASS] ${testName}`);
      if (details) {
        console.log(`       └─ Details: ${details}`);
      }
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (details) {
        console.error(`       └─ Reason: ${details}`);
      }
      failedCount++;
    }
  }

  // Helper for asserting that an expected Mongoose validation error path was triggered
  function assertExpectedPath(err, expectedPath, testName) {
    if (!err || !err.errors) {
      report(testName, false, `Expected validation error on [${expectedPath}], but received: ${err?.message || 'unknown error'}`);
      return;
    }

    if (err.errors[expectedPath]) {
      report(testName, true, `Path [${expectedPath}] correctly rejected: "${err.errors[expectedPath].message}"`);
    } else {
      const actualPaths = Object.keys(err.errors).join(', ') || 'none';
      report(testName, false, `Expected error path [${expectedPath}], but received [${actualPaths}]`);
    }
  }

  // Helper baseline level fixture generator
  function createBaseFixture(overrides = {}) {
    return {
      levelNumber: 100,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [{ x: 4, y: 3, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 7, y: 7 },
      moveLimit: 25,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      isActive: true,
      ...overrides,
    };
  }

  // -------------------------------------------------------------
  // Test 1: Complete Valid Level
  // -------------------------------------------------------------
  try {
    const validLevel = new Level({
      levelNumber: 1,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      // Worm head at (3,6), initial body segments at (2,6) and (1,6)
      wormStart: { x: 3, y: 6, initialLength: 3, direction: 'RIGHT' },
      apples: [{ x: 4, y: 3, type: 'normal' }],
      stones: [{ x: 2, y: 4 }],
      keys: [{ x: 5, y: 2, keyId: 'gate_key_1' }],
      obstacles: [
        { x: 0, y: 7, type: 'wall' },
        { x: 5, y: 7, type: 'spike' },
        { x: 6, y: 2, type: 'gate', keyId: 'gate_key_1' },
        // Moving block starts at (0,1), patrols through (1,1) and (2,1)
        { x: 0, y: 1, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 7, y: 1 },
      moveLimit: 30,
      starThresholds: { threeStars: 12, twoStars: 18, oneStar: 25 },
      objective: 'collect_keys',
      targetValue: 1,
    });

    await validLevel.validate();
    report('1. Complete valid level passes validation', true);
  } catch (err) {
    const errorDetails = Object.entries(err.errors || {})
      .map(([k, v]) => `${k}: ${v.message}`)
      .join(' | ') || err.message;
    report('1. Complete valid level passes validation', false, `Unexpected error -> ${errorDetails}`);
  }

  // -------------------------------------------------------------
  // Test 2: Out-of-bounds apple
  // -------------------------------------------------------------
  try {
    const oobApple = new Level({
      levelNumber: 2,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [{ x: 10, y: 3, type: 'normal' }],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'eat_all_apples',
    });
    await oobApple.validate();
    report('2. Out-of-bounds apple is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'apples.0', '2. Out-of-bounds apple is rejected');
  }

  // -------------------------------------------------------------
  // Test 3: Duplicate Apples on same coordinate
  // -------------------------------------------------------------
  try {
    const duplicateApples = new Level({
      levelNumber: 3,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [
        { x: 4, y: 4, type: 'normal' },
        { x: 4, y: 4, type: 'golden' },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'eat_all_apples',
    });
    await duplicateApples.validate();
    report('3. Duplicate apples on same tile are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'apples.1', '3. Duplicate apples on same tile are rejected');
  }

  // -------------------------------------------------------------
  // Test 4: Duplicate Keys on same coordinate
  // -------------------------------------------------------------
  try {
    const duplicateKeys = new Level({
      levelNumber: 4,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      keys: [
        { x: 5, y: 5, keyId: 'key_1' },
        { x: 5, y: 5, keyId: 'key_2' },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'collect_keys',
      targetValue: 2,
    });
    await duplicateKeys.validate();
    report('4. Duplicate keys on same coordinate are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'keys.1', '4. Duplicate keys on same coordinate are rejected');
  }

  // -------------------------------------------------------------
  // Test 5: Duplicate Stones on same coordinate
  // -------------------------------------------------------------
  try {
    const duplicateStones = new Level({
      levelNumber: 5,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      stones: [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await duplicateStones.validate();
    report('5. Duplicate stones on same coordinate are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'stones.1', '5. Duplicate stones on same coordinate are rejected');
  }

  // -------------------------------------------------------------
  // Test 6: Duplicate Obstacles on same coordinate
  // -------------------------------------------------------------
  try {
    const duplicateObstacles = new Level({
      levelNumber: 6,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      obstacles: [
        { x: 2, y: 2, type: 'wall' },
        { x: 2, y: 2, type: 'spike' },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await duplicateObstacles.validate();
    report('6. Duplicate obstacles on same tile are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.1', '6. Duplicate obstacles on same tile are rejected');
  }

  // -------------------------------------------------------------
  // Test 7: Non-moving obstacle having axis/range
  // -------------------------------------------------------------
  try {
    const wallWithRange = new Level({
      levelNumber: 7,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      obstacles: [{ x: 2, y: 2, type: 'wall', axis: 'horizontal', range: 2 }],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await wallWithRange.validate();
    report('7. Wall obstacle with axis/range is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.axis', '7. Wall obstacle with axis/range is rejected');
  }

  // -------------------------------------------------------------
  // Test 8: Moving block path collides with static wall
  // -------------------------------------------------------------
  try {
    const movingBlockCollision = new Level({
      levelNumber: 8,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [
        { x: 0, y: 3, type: 'moving_block', axis: 'horizontal', range: 3 },
        { x: 2, y: 3, type: 'wall' }, // Collides at step 2
      ],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await movingBlockCollision.validate();
    report('8. Moving block path colliding with static obstacle is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '8. Moving block path colliding with static obstacle is rejected');
  }

  // -------------------------------------------------------------
  // Test 9: Moving block path collides with an apple
  // -------------------------------------------------------------
  try {
    const movingBlockApple = new Level({
      levelNumber: 9,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      apples: [{ x: 2, y: 3, type: 'normal' }], // Collides at step 2
      obstacles: [{ x: 0, y: 3, type: 'moving_block', axis: 'horizontal', range: 3 }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'eat_all_apples',
    });
    await movingBlockApple.validate();
    report('9. Moving block path colliding with apple is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '9. Moving block path colliding with apple is rejected');
  }

  // -------------------------------------------------------------
  // Test 10: Moving block path collides with a key
  // -------------------------------------------------------------
  try {
    const movingBlockKey = new Level({
      levelNumber: 10,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      keys: [{ x: 2, y: 3, keyId: 'key_1' }], // Collides at step 2
      obstacles: [{ x: 0, y: 3, type: 'moving_block', axis: 'horizontal', range: 3 }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'collect_keys',
      targetValue: 1,
    });
    await movingBlockKey.validate();
    report('10. Moving block path colliding with key is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '10. Moving block path colliding with key is rejected');
  }

  // -------------------------------------------------------------
  // Test 11: Moving block path collides with the portal
  // -------------------------------------------------------------
  try {
    const movingBlockPortal = new Level({
      levelNumber: 11,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 3, y: 5 }, // Collides at step 3
      obstacles: [{ x: 3, y: 2, type: 'moving_block', axis: 'vertical', range: 3 }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await movingBlockPortal.validate();
    report('11. Moving block path colliding with portal is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '11. Moving block path colliding with portal is rejected');
  }

  // -------------------------------------------------------------
  // Test 12: Moving block path collides with worm initial body
  // -------------------------------------------------------------
  try {
    const movingBlockWorm = new Level({
      levelNumber: 12,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      // Worm head at (3,1), body tail at (2,1)
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      // Path reaches (2,1) at step 2, hitting worm's body
      obstacles: [{ x: 0, y: 1, type: 'moving_block', axis: 'horizontal', range: 2 }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await movingBlockWorm.validate();
    report('12. Moving block path colliding with worm body is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '12. Moving block path colliding with worm body is rejected');
  }

  // -------------------------------------------------------------
  // Test 13: Non-gate obstacle with empty string keyId is rejected
  // -------------------------------------------------------------
  try {
    const wallEmptyKey = new Level({
      levelNumber: 13,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 4, y: 4, type: 'wall', keyId: '' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await wallEmptyKey.validate();
    report('13. Non-gate obstacle with empty keyId is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.keyId', '13. Non-gate obstacle with empty keyId is rejected');
  }

  // -------------------------------------------------------------
  // Test 14: Non-gate obstacle with whitespace-only keyId is rejected
  // -------------------------------------------------------------
  try {
    const wallWhitespaceKey = new Level({
      levelNumber: 14,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 4, y: 4, type: 'wall', keyId: '   ' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await wallWhitespaceKey.validate();
    report('14. Non-gate obstacle with whitespace-only keyId is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.keyId', '14. Non-gate obstacle with whitespace-only keyId is rejected');
  }

  // -------------------------------------------------------------
  // Test 15: Non-gate obstacle with normal keyId is rejected
  // -------------------------------------------------------------
  try {
    const wallNormalKey = new Level({
      levelNumber: 15,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 4, y: 4, type: 'wall', keyId: 'gold_key' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await wallNormalKey.validate();
    report('15. Non-gate obstacle with normal keyId is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.keyId', '15. Non-gate obstacle with normal keyId is rejected');
  }

  // -------------------------------------------------------------
  // Test 16: Gate with empty string keyId is rejected
  // -------------------------------------------------------------
  try {
    const gateEmptyKey = new Level({
      levelNumber: 16,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 4, y: 4, type: 'gate', keyId: '   ' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await gateEmptyKey.validate();
    report('16. Gate with empty keyId string is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.keyId', '16. Gate with empty keyId string is rejected');
  }

  // -------------------------------------------------------------
  // Test 17: Gate referencing non-existent keyId is rejected
  // -------------------------------------------------------------
  try {
    const gateMissingKey = new Level({
      levelNumber: 17,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      keys: [{ x: 1, y: 1, keyId: 'key_A' }],
      obstacles: [{ x: 4, y: 4, type: 'gate', keyId: 'missing_key_B' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'collect_keys',
      targetValue: 1,
    });
    await gateMissingKey.validate();
    report('17. Gate referencing non-existent keyId is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.keyId', '17. Gate referencing non-existent keyId is rejected');
  }

  // -------------------------------------------------------------
  // Test 18: Gate without keyId passes validation (ordinary gate)
  // -------------------------------------------------------------
  try {
    const gateNoKey = new Level({
      levelNumber: 18,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 4, y: 4, type: 'gate' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await gateNoKey.validate();
    report('18. Gate without keyId passes validation as an ordinary gate', true);
  } catch (err) {
    report('18. Gate without keyId passes validation as an ordinary gate', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 19: Move limit less than oneStar threshold is rejected
  // -------------------------------------------------------------
  try {
    const badMoveLimit = new Level({
      levelNumber: 19,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      moveLimit: 15, // Less than oneStar (20)
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await badMoveLimit.validate();
    report('19. Move limit less than oneStar threshold is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'moveLimit', '19. Move limit less than oneStar threshold is rejected');
  }

  // -------------------------------------------------------------
  // Test 20: Inverted star thresholds are rejected
  // -------------------------------------------------------------
  try {
    const invalidStars = new Level({
      levelNumber: 20,
      difficulty: 'medium',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      moveLimit: 30,
      starThresholds: { threeStars: 25, twoStars: 15, oneStar: 20 }, // 25 > 15
      objective: 'reach_portal',
    });
    await invalidStars.validate();
    report('20. Inverted star thresholds are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'starThresholds', '20. Inverted star thresholds are rejected');
  }

  // -------------------------------------------------------------
  // Test 21: Invalid obstacle enum is rejected
  // -------------------------------------------------------------
  try {
    const invalidObstacle = new Level({
      levelNumber: 21,
      difficulty: 'hard',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      obstacles: [{ x: 2, y: 2, type: 'laser_turret' }],
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await invalidObstacle.validate();
    report('21. Invalid obstacle enum is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.type', '21. Invalid obstacle enum is rejected');
  }

  // -------------------------------------------------------------
  // Test 22: Worm initial body segment outside grid is rejected
  // -------------------------------------------------------------
  try {
    const oobWorm = new Level({
      levelNumber: 22,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      // Head at (1,2) facing RIGHT -> tail reaches x: -1 (off-grid)
      wormStart: { x: 1, y: 2, initialLength: 3, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      moveLimit: 25,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await oobWorm.validate();
    report('22. Worm initial body segment outside grid is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'wormStart', '22. Worm initial body segment outside grid is rejected');
  }

  // -------------------------------------------------------------
  // Test 23: Worm body spawning on an obstacle is rejected
  // -------------------------------------------------------------
  try {
    const wormOnSpike = new Level({
      levelNumber: 23,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      // Worm head at (3,2), body at (2,2)
      wormStart: { x: 3, y: 2, initialLength: 2, direction: 'RIGHT' },
      obstacles: [{ x: 2, y: 2, type: 'spike' }], // Directly under tail
      portal: { x: 7, y: 7 },
      moveLimit: 25,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    });
    await wormOnSpike.validate();
    report('23. Worm body spawning on an obstacle is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'wormStart', '23. Worm body spawning on an obstacle is rejected');
  }

  // -------------------------------------------------------------
  // Test 24: Apple spawning inside a wall is rejected
  // -------------------------------------------------------------
  try {
    const appleInWall = new Level({
      levelNumber: 24,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 7 },
      apples: [{ x: 4, y: 4, type: 'normal' }],
      obstacles: [{ x: 4, y: 4, type: 'wall' }], // Overlaps apple coordinate
      moveLimit: 25,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'eat_all_apples',
    });
    await appleInWall.validate();
    report('24. Apple spawning inside a wall is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'apples.0', '24. Apple spawning inside a wall is rejected');
  }

  // -------------------------------------------------------------
  // Test 25: Two moving blocks with intersecting patrol paths are rejected
  // -------------------------------------------------------------
  try {
    const overlappingBlocks = new Level(createBaseFixture({
      levelNumber: 25,
      obstacles: [
        // Block 0: horizontal from (0,3) patrolling (1,3), (2,3), (3,3)
        { x: 0, y: 3, type: 'moving_block', axis: 'horizontal', range: 3 },
        // Block 1: vertical from (2,1) patrolling (2,2), (2,3), (2,4) - collides at (2,3)
        { x: 2, y: 1, type: 'moving_block', axis: 'vertical', range: 3 },
      ],
    }));
    await overlappingBlocks.validate();
    report('25. Moving blocks with intersecting patrol paths are rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.1.range', '25. Moving blocks with intersecting patrol paths are rejected');
  }

  // -------------------------------------------------------------
  // Test 26: Two moving blocks with separate non-intersecting patrol paths pass validation
  // -------------------------------------------------------------
  try {
    const separateBlocks = new Level(createBaseFixture({
      levelNumber: 26,
      obstacles: [
        { x: 0, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
        { x: 0, y: 4, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
    }));
    await separateBlocks.validate();
    report('26. Moving blocks with separate non-intersecting patrol paths pass validation', true);
  } catch (err) {
    report('26. Moving blocks with separate non-intersecting patrol paths pass validation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 27: Moving block path colliding with another obstacle starting position is rejected
  // -------------------------------------------------------------
  try {
    const blockCollidesWithObsStart = new Level(createBaseFixture({
      levelNumber: 27,
      obstacles: [
        { x: 0, y: 2, type: 'moving_block', axis: 'horizontal', range: 3 }, // Path reaches (2,2)
        { x: 2, y: 2, type: 'moving_block', axis: 'vertical', range: 2 },   // Starts at (2,2)
      ],
    }));
    await blockCollidesWithObsStart.validate();
    report('27. Moving block patrol path collides with another obstacle starting position', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'obstacles.0.range', '27. Moving block patrol path collides with another obstacle starting position');
  }

  // -------------------------------------------------------------
  // Test 28: Objective "collect_apple_count" with missing targetValue is rejected
  // -------------------------------------------------------------
  try {
    const missingTarget = new Level(createBaseFixture({
      levelNumber: 28,
      objective: 'collect_apple_count',
      targetValue: null,
      apples: [{ x: 4, y: 3, type: 'normal' }],
    }));
    await missingTarget.validate();
    report('28. Objective "collect_apple_count" with missing targetValue is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '28. Objective "collect_apple_count" with missing targetValue is rejected');
  }

  // -------------------------------------------------------------
  // Test 29: Objective "collect_apple_count" with targetValue exceeding available apples is rejected
  // -------------------------------------------------------------
  try {
    const excessiveTarget = new Level(createBaseFixture({
      levelNumber: 29,
      objective: 'collect_apple_count',
      targetValue: 3, // Level only has 1 apple
      apples: [{ x: 4, y: 3, type: 'normal' }],
    }));
    await excessiveTarget.validate();
    report('29. Objective "collect_apple_count" with targetValue exceeding apples is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '29. Objective "collect_apple_count" with targetValue exceeding apples is rejected');
  }

  // -------------------------------------------------------------
  // Test 30: Objective "collect_apple_count" with valid targetValue passes validation
  // -------------------------------------------------------------
  try {
    const validAppleCount = new Level(createBaseFixture({
      levelNumber: 30,
      objective: 'collect_apple_count',
      targetValue: 2,
      apples: [
        { x: 4, y: 3, type: 'normal' },
        { x: 5, y: 3, type: 'golden' },
      ],
    }));
    await validAppleCount.validate();
    report('30. Objective "collect_apple_count" with valid targetValue passes validation', true);
  } catch (err) {
    report('30. Objective "collect_apple_count" with valid targetValue passes validation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 31: Objective "reach_length" with missing targetValue is rejected
  // -------------------------------------------------------------
  try {
    const missingLenTarget = new Level(createBaseFixture({
      levelNumber: 31,
      objective: 'reach_length',
      targetValue: null,
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [{ x: 4, y: 3, type: 'normal' }],
    }));
    await missingLenTarget.validate();
    report('31. Objective "reach_length" with missing targetValue is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '31. Objective "reach_length" with missing targetValue is rejected');
  }

  // -------------------------------------------------------------
  // Test 32: Objective "reach_length" with targetValue <= initialLength is rejected
  // -------------------------------------------------------------
  try {
    const invalidLenTarget = new Level(createBaseFixture({
      levelNumber: 32,
      objective: 'reach_length',
      wormStart: { x: 3, y: 1, initialLength: 3, direction: 'RIGHT' },
      targetValue: 3, // Target must be strictly > initialLength (3)
      apples: [{ x: 4, y: 3, type: 'normal' }],
    }));
    await invalidLenTarget.validate();
    report('32. Objective "reach_length" with targetValue <= initialLength is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '32. Objective "reach_length" with targetValue <= initialLength is rejected');
  }

  // -------------------------------------------------------------
  // Test 33: Objective "reach_length" with targetValue > initialLength + apples is rejected
  // -------------------------------------------------------------
  try {
    const unattainableLenTarget = new Level(createBaseFixture({
      levelNumber: 33,
      objective: 'reach_length',
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [{ x: 4, y: 3, type: 'normal' }], // Max length is 2 + 1 = 3
      targetValue: 5,
    }));
    await unattainableLenTarget.validate();
    report('33. Objective "reach_length" with targetValue > initialLength + apples is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '33. Objective "reach_length" with targetValue > initialLength + apples is rejected');
  }

  // -------------------------------------------------------------
  // Test 34: Objective "reach_length" with valid targetValue passes validation
  // -------------------------------------------------------------
  try {
    const validReachLen = new Level(createBaseFixture({
      levelNumber: 34,
      objective: 'reach_length',
      wormStart: { x: 3, y: 1, initialLength: 2, direction: 'RIGHT' },
      apples: [
        { x: 4, y: 3, type: 'normal' },
        { x: 5, y: 3, type: 'golden' },
      ], // Max length is 2 + 2 = 4
      targetValue: 3,
    }));
    await validReachLen.validate();
    report('34. Objective "reach_length" with valid targetValue passes validation', true);
  } catch (err) {
    report('34. Objective "reach_length" with valid targetValue passes validation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 35: Objective "collect_keys" with zero keys is rejected
  // -------------------------------------------------------------
  try {
    const keysObjectiveNoKeys = new Level(createBaseFixture({
      levelNumber: 35,
      objective: 'collect_keys',
      keys: [], // Zero keys
    }));
    await keysObjectiveNoKeys.validate();
    report('35. Objective "collect_keys" with zero keys is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'objective', '35. Objective "collect_keys" with zero keys is rejected');
  }

  // -------------------------------------------------------------
  // Test 36: Objective "collect_keys" with omitted targetValue and available keys passes validation
  // -------------------------------------------------------------
  try {
    const keysOmittedTarget = new Level(createBaseFixture({
      levelNumber: 36,
      objective: 'collect_keys',
      keys: [{ x: 5, y: 2, keyId: 'k1' }],
      targetValue: null, // Target omitted: collecting all available keys
    }));
    await keysOmittedTarget.validate();
    report('36. Objective "collect_keys" with omitted targetValue passes validation', true);
  } catch (err) {
    report('36. Objective "collect_keys" with omitted targetValue passes validation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 37: Objective "collect_keys" with targetValue exceeding available keys is rejected
  // -------------------------------------------------------------
  try {
    const keysTargetExcess = new Level(createBaseFixture({
      levelNumber: 37,
      objective: 'collect_keys',
      keys: [{ x: 5, y: 2, keyId: 'k1' }], // 1 key available
      targetValue: 3,
    }));
    await keysTargetExcess.validate();
    report('37. Objective "collect_keys" with targetValue exceeding keys is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'targetValue', '37. Objective "collect_keys" with targetValue exceeding keys is rejected');
  }

  // -------------------------------------------------------------
  // Test 38: Objective "eat_all_apples" with zero apples is rejected
  // -------------------------------------------------------------
  try {
    const eatAllNoApples = new Level(createBaseFixture({
      levelNumber: 38,
      objective: 'eat_all_apples',
      apples: [],
    }));
    await eatAllNoApples.validate();
    report('38. Objective "eat_all_apples" with zero apples is rejected', false, 'Expected validation to fail, but it passed.');
  } catch (err) {
    assertExpectedPath(err, 'objective', '38. Objective "eat_all_apples" with zero apples is rejected');
  }

  // -------------------------------------------------------------
  // Test 39: Objective "eat_all_apples" with at least one apple and no targetValue passes validation
  // -------------------------------------------------------------
  try {
    const eatAllValid = new Level(createBaseFixture({
      levelNumber: 39,
      objective: 'eat_all_apples',
      apples: [{ x: 4, y: 3, type: 'normal' }],
      targetValue: null,
    }));
    await eatAllValid.validate();
    report('39. Objective "eat_all_apples" with at least one apple passes validation', true);
  } catch (err) {
    report('39. Objective "eat_all_apples" with at least one apple passes validation', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 40: Objectives "reach_portal", "limited_moves", and "perfect_route" reject supplied targetValue
  // -------------------------------------------------------------
  const unusedTargetObjectives = ['reach_portal', 'limited_moves', 'perfect_route'];
  let allTargetRejected = true;

  for (const obj of unusedTargetObjectives) {
    try {
      const invalidTargetObj = new Level(createBaseFixture({
        levelNumber: 40,
        objective: obj,
        targetValue: 5, // Non-null targetValue not permitted
      }));
      await invalidTargetObj.validate();
      allTargetRejected = false;
      break;
    } catch (err) {
      if (!err?.errors?.targetValue) {
        allTargetRejected = false;
        break;
      }
    }
  }

  report(
    '40. Objectives "reach_portal", "limited_moves", and "perfect_route" reject supplied targetValue',
    allTargetRejected,
    allTargetRejected ? 'All 3 objectives correctly rejected non-null targetValue' : 'One or more objectives failed to reject targetValue'
  );

  // -------------------------------------------------------------
  // Test 41: Objectives "reach_portal", "limited_moves", and "perfect_route" pass when targetValue is omitted
  // -------------------------------------------------------------
  let allPassedWhenOmitted = true;

  for (const obj of unusedTargetObjectives) {
    try {
      const validOmittedTarget = new Level(createBaseFixture({
        levelNumber: 41,
        objective: obj,
        targetValue: null,
      }));
      await validOmittedTarget.validate();
    } catch (err) {
      allPassedWhenOmitted = false;
      break;
    }
  }

  report(
    '41. Objectives "reach_portal", "limited_moves", and "perfect_route" pass when targetValue is omitted',
    allPassedWhenOmitted,
    allPassedWhenOmitted ? 'All 3 objectives successfully validated with omitted targetValue' : 'Validation failed unexpectedly'
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n-------------------------------------------------------------');
  console.log(`Validation Results: ${passedCount} passed, ${failedCount} failed. (Total: ${passedCount + failedCount})`);
  console.log('-------------------------------------------------------------');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runUpdatedLevelValidationTests();