/**
 * @file levelValidationService.js
 * @description Semantic gameplay rule and static tile-graph reachability validation engine for Apple Worm Adventure.
 * Evaluates static grid connectivity, key-gate access ordering, and initial worm-body clearance using bounded BFS
 * with BigInt bitmasks.
 *
 * SCOPE & SYSTEM LIMITATIONS:
 * - Static Tile-Graph Reachability: Verifies that required gameplay assets (apples, keys, portal) are theoretically
 *   accessible along open grid tiles and key-gate unlock sequences without colliding with static obstacles or the
 *   initial worm body.
 * - Solvability Disclaimer: Passing this validation does NOT guarantee that a level is fully solvable during active
 *   gameplay. Full dynamic simulation—including sequential multi-item routing without self-entrapment, body growth
 *   upon eating apples, gravity drop physics, pushing stones into pits to form bridges, and moving-block patrol
 *   timing—is not evaluated by this static BFS.
 * - Advisory Warnings: Dynamic puzzle elements (multiple apples, pushable stones, moving blocks, unlinked gates)
 *   emit advisory warnings to assist level designers.
 */

/**
 * Fast FIFO Queue implementation with amortized O(1) operations.
 * Avoids the O(N) array.shift() performance penalty during state-space BFS.
 */
class FastQueue {
  constructor() {
    this.elements = [];
    this.head = 0;
  }

  push(item) {
    this.elements.push(item);
  }

  shift() {
    if (this.head >= this.elements.length) return undefined;
    const item = this.elements[this.head];
    this.elements[this.head] = null; // Enable GC
    this.head++;

    // Periodically reclaim memory when half the array has been dequeued
    if (this.head > 1000 && this.head > this.elements.length / 2) {
      this.elements = this.elements.slice(this.head);
      this.head = 0;
    }
    return item;
  }

  get length() {
    return this.elements.length - this.head;
  }

  isEmpty() {
    return this.length === 0;
  }
}

/**
 * Validates the gameplay semantics and static reachability of an Apple Worm level.
 *
 * @param {Object} level - The level configuration object (matching Level.js schema).
 * @param {Object} [options={}] - Search configuration options.
 * @param {number} [options.maxStates] - Maximum state-space exploration budget (positive finite integer).
 * @returns {Object} Validation outcome { isValid, errors, warnings, details }
 */
export function validateLevelPlayability(level, options = {}) {
  const errors = [];
  const warnings = [];

  const details = {
    reachableApples: [],
    reachableKeys: [],
    canReachPortal: null, // null when inconclusive; boolean once BFS determines reachability
    portalDistance: null,
    statesExplored: 0,
    isInconclusive: false,
  };

  // 1. Level object validation
  if (!level || typeof level !== 'object') {
    errors.push('Level configuration must be a non-null object');
    return { isValid: false, errors, warnings, details };
  }

  // 2. Grid dimension validation
  if (!level.grid || typeof level.grid !== 'object') {
    errors.push('Level missing required grid configuration');
    return { isValid: false, errors, warnings, details };
  }

  const { rows, cols } = level.grid;
  if (
    typeof rows !== 'number' ||
    !Number.isFinite(rows) ||
    !Number.isInteger(rows) ||
    rows < 4 ||
    rows > 30
  ) {
    errors.push(`Grid rows must be a finite integer between 4 and 30 (received: ${rows})`);
  }

  if (
    typeof cols !== 'number' ||
    !Number.isFinite(cols) ||
    !Number.isInteger(cols) ||
    cols < 4 ||
    cols > 30
  ) {
    errors.push(`Grid cols must be a finite integer between 4 and 30 (received: ${cols})`);
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, details };
  }

  // 3. Search budget option validation
  let maxStates;
  if (options && options.maxStates !== undefined) {
    const val = options.maxStates;
    if (
      typeof val !== 'number' ||
      !Number.isFinite(val) ||
      !Number.isInteger(val) ||
      val <= 0
    ) {
      errors.push(`Invalid options.maxStates: "${val}". Must be a finite positive integer.`);
      return { isValid: false, errors, warnings, details };
    }
    maxStates = val;
  } else {
    const numKeys = Array.isArray(level.keys) ? level.keys.length : 0;
    const keyFactor = Math.pow(2, Math.min(numKeys, 10));
    const computedBudget = Math.min(rows * cols * keyFactor, 50000);
    maxStates = Math.max(computedBudget, 2000);
  }

  // 4. Worm start configuration validation
  if (!level.wormStart || typeof level.wormStart !== 'object') {
    errors.push('Level missing required wormStart configuration');
    return { isValid: false, errors, warnings, details };
  }

  const { x: wx, y: wy, direction, initialLength } = level.wormStart;
  const VALID_DIRECTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

  if (!VALID_DIRECTIONS.includes(direction)) {
    errors.push(`Invalid worm direction "${direction}". Must be one of: UP, DOWN, LEFT, RIGHT`);
  }

  if (
    typeof initialLength !== 'number' ||
    !Number.isFinite(initialLength) ||
    !Number.isInteger(initialLength) ||
    initialLength < 2
  ) {
    errors.push(`wormStart.initialLength must be a finite integer >= 2 (received: ${initialLength})`);
  }

  if (
    typeof wx !== 'number' ||
    !Number.isFinite(wx) ||
    !Number.isInteger(wx) ||
    typeof wy !== 'number' ||
    !Number.isFinite(wy) ||
    !Number.isInteger(wy) ||
    wx < 0 ||
    wx >= cols ||
    wy < 0 ||
    wy >= rows
  ) {
    errors.push(`wormStart head coordinate (${wx}, ${wy}) is outside grid boundaries (${cols}x${rows})`);
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, details };
  }

  // 5. Initial worm body segments computation
  const bodySegments = [{ x: wx, y: wy }];
  for (let i = 1; i < initialLength; i++) {
    let segX = wx;
    let segY = wy;
    if (direction === 'RIGHT') segX -= i;
    else if (direction === 'LEFT') segX += i;
    else if (direction === 'UP') segY += i;
    else if (direction === 'DOWN') segY -= i;

    if (segX < 0 || segX >= cols || segY < 0 || segY >= rows) {
      errors.push(`Initial worm segment [${i}] at (${segX}, ${segY}) extends outside grid boundaries (${cols}x${rows})`);
      return { isValid: false, errors, warnings, details };
    }
    bodySegments.push({ x: segX, y: segY });
  }

  // 6. Portal validation
  if (!level.portal || typeof level.portal !== 'object') {
    errors.push('Level missing required portal configuration');
    return { isValid: false, errors, warnings, details };
  }

  const { x: px, y: py } = level.portal;
  if (
    typeof px !== 'number' ||
    !Number.isFinite(px) ||
    !Number.isInteger(px) ||
    typeof py !== 'number' ||
    !Number.isFinite(py) ||
    !Number.isInteger(py) ||
    px < 0 ||
    px >= cols ||
    py < 0 ||
    py >= rows
  ) {
    errors.push(`Portal coordinate (${px}, ${py}) is outside grid boundaries (${cols}x${rows})`);
    return { isValid: false, errors, warnings, details };
  }

  // 7. Objective targets pre-validation
  const objective = level.objective || 'reach_portal';
  const targetValue = level.targetValue;
  const apples = Array.isArray(level.apples) ? level.apples : [];
  const keys = Array.isArray(level.keys) ? level.keys : [];

  if (objective === 'collect_apple_count') {
    if (
      typeof targetValue !== 'number' ||
      !Number.isFinite(targetValue) ||
      !Number.isInteger(targetValue) ||
      targetValue <= 0
    ) {
      errors.push(`Objective "collect_apple_count" requires a positive integer targetValue (received: ${targetValue})`);
    } else if (targetValue > apples.length) {
      errors.push(`Objective "collect_apple_count" targetValue (${targetValue}) exceeds total apples in level (${apples.length})`);
    }
  } else if (objective === 'reach_length') {
    if (
      typeof targetValue !== 'number' ||
      !Number.isFinite(targetValue) ||
      !Number.isInteger(targetValue) ||
      targetValue <= 0
    ) {
      errors.push(`Objective "reach_length" requires a positive integer targetValue (received: ${targetValue})`);
    }
  } else if (objective === 'collect_keys') {
    if (keys.length === 0) {
      errors.push('Objective "collect_keys" requires at least one key in the level (found 0)');
    } else if (targetValue !== undefined && targetValue !== null) {
      if (
        typeof targetValue !== 'number' ||
        !Number.isFinite(targetValue) ||
        !Number.isInteger(targetValue) ||
        targetValue <= 0
      ) {
        errors.push(`Objective "collect_keys" targetValue must be a positive integer when supplied (received: ${targetValue})`);
      } else if (targetValue > keys.length) {
        errors.push(`Objective "collect_keys" targetValue (${targetValue}) exceeds total keys in level (${keys.length})`);
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, details };
  }

  // 8. Entity Indexing & Coordinate Maps
  const staticObstacles = new Set();
  const trailingBodyTiles = new Set();
  const gatesByCoord = new Map();
  const keysByCoord = new Map();
  const applesByCoord = new Map();
  const keyIdToIndex = new Map();

  // Index trailing worm body as impassable tiles during initial movement
  for (let i = 1; i < bodySegments.length; i++) {
    trailingBodyTiles.add(`${bodySegments[i].x},${bodySegments[i].y}`);
  }

  // Index keys with BigInt bit positions
  if (keys.length > 12) {
    warnings.push(`Level contains ${keys.length} keys. State space is 2^${keys.length}; search budget may be exceeded.`);
  }

  keys.forEach((k, idx) => {
    keyIdToIndex.set(k.keyId, idx);
    keysByCoord.set(`${k.x},${k.y}`, { ...k, bitIndex: idx });
  });

  // Index obstacles
  const obstacles = Array.isArray(level.obstacles) ? level.obstacles : [];
  let unlinkedGateCount = 0;

  for (const obs of obstacles) {
    const coordKey = `${obs.x},${obs.y}`;
    if (obs.type === 'wall' || obs.type === 'spike' || obs.type === 'pit') {
      staticObstacles.add(coordKey);
    } else if (obs.type === 'gate') {
      const trimmedKeyId = obs.keyId ? String(obs.keyId).trim() : '';
      if (!trimmedKeyId) {
        // Unlinked gate: permanently impassable in static search
        staticObstacles.add(coordKey);
        unlinkedGateCount++;
      } else if (keyIdToIndex.has(trimmedKeyId)) {
        gatesByCoord.set(coordKey, keyIdToIndex.get(trimmedKeyId));
      } else {
        errors.push(`Gate at (${obs.x}, ${obs.y}) references non-existent keyId "${trimmedKeyId}"`);
      }
    }
  }

  if (unlinkedGateCount > 0) {
    warnings.push(`Level contains ${unlinkedGateCount} gate(s) with no keyId; treated as permanently impassable in static search.`);
  }

  // Verify initial worm body does not start intersecting static obstacles
  for (let i = 0; i < bodySegments.length; i++) {
    const coordKey = `${bodySegments[i].x},${bodySegments[i].y}`;
    if (staticObstacles.has(coordKey)) {
      errors.push(`Initial worm segment [${i}] at (${bodySegments[i].x}, ${bodySegments[i].y}) overlaps a static obstacle`);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings, details };
  }

  // Index apples
  apples.forEach((a, idx) => {
    applesByCoord.set(`${a.x},${a.y}`, { ...a, index: idx });
  });

  // 9. Bounded State-Space BFS Reachability
  const queue = new FastQueue();
  const visited = new Set();

  let initialMask = 0n;
  const startKeyCoord = `${wx},${wy}`;
  if (keysByCoord.has(startKeyCoord)) {
    const startKey = keysByCoord.get(startKeyCoord);
    initialMask |= (1n << BigInt(startKey.bitIndex));
  }

  const startStateKey = `${wx},${wy},${initialMask.toString(16)}`;
  visited.add(startStateKey);
  queue.push({ x: wx, y: wy, mask: initialMask, dist: 0 });

  let statesExplored = 0;
  let budgetExhausted = false;

  const reachedApplesMap = new Map();
  const reachedKeysMap = new Map();
  let minPortalDist = null;

  // Immediate start tile checks
  if (wx === px && wy === py) {
    minPortalDist = 0;
  }
  if (applesByCoord.has(startKeyCoord)) {
    const a = applesByCoord.get(startKeyCoord);
    reachedApplesMap.set(a.index, { appleId: a.appleId, type: a.type, x: a.x, y: a.y, distance: 0 });
  }
  if (keysByCoord.has(startKeyCoord)) {
    const k = keysByCoord.get(startKeyCoord);
    reachedKeysMap.set(k.keyId, { keyId: k.keyId, x: k.x, y: k.y, distance: 0 });
  }

  const CARDINALS = [
    { dx: 0, dy: -1 }, // UP
    { dx: 0, dy: 1 },  // DOWN
    { dx: -1, dy: 0 }, // LEFT
    { dx: 1, dy: 0 },  // RIGHT
  ];

  while (!queue.isEmpty()) {
    if (statesExplored >= maxStates) {
      budgetExhausted = true;
      break;
    }

    const curr = queue.shift();
    statesExplored++;

    for (const { dx, dy } of CARDINALS) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;

      // Check grid bounds
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

      const nextCoord = `${nx},${ny}`;

      // Check static walls, spikes, pits, unlinked gates, and initial body
      if (staticObstacles.has(nextCoord) || trailingBodyTiles.has(nextCoord)) {
        continue;
      }

      // Check key-locked gates
      if (gatesByCoord.has(nextCoord)) {
        const requiredBitIdx = gatesByCoord.get(nextCoord);
        const requiredBit = 1n << BigInt(requiredBitIdx);
        if ((curr.mask & requiredBit) === 0n) {
          // Locked gate without matching key
          continue;
        }
      }

      // Calculate key pickup
      let nextMask = curr.mask;
      if (keysByCoord.has(nextCoord)) {
        const k = keysByCoord.get(nextCoord);
        nextMask |= (1n << BigInt(k.bitIndex));
        if (!reachedKeysMap.has(k.keyId)) {
          reachedKeysMap.set(k.keyId, {
            keyId: k.keyId,
            x: k.x,
            y: k.y,
            distance: curr.dist + 1,
          });
        }
      }

      const nextStateKey = `${nx},${ny},${nextMask.toString(16)}`;
      if (visited.has(nextStateKey)) continue;

      visited.add(nextStateKey);

      // Check apple reachability
      if (applesByCoord.has(nextCoord)) {
        const a = applesByCoord.get(nextCoord);
        if (!reachedApplesMap.has(a.index)) {
          reachedApplesMap.set(a.index, {
            appleId: a.appleId,
            type: a.type,
            x: a.x,
            y: a.y,
            distance: curr.dist + 1,
          });
        }
      }

      // Check portal reachability
      if (nx === px && ny === py) {
        if (minPortalDist === null || curr.dist + 1 < minPortalDist) {
          minPortalDist = curr.dist + 1;
        }
      }

      queue.push({ x: nx, y: ny, mask: nextMask, dist: curr.dist + 1 });
    }
  }

  details.statesExplored = statesExplored;
  details.reachableApples = Array.from(reachedApplesMap.values());
  details.reachableKeys = Array.from(reachedKeysMap.values());

  // 10. Process Reachability & Inconclusive Status
  if (budgetExhausted) {
    details.isInconclusive = true;
    if (minPortalDist !== null) {
      details.canReachPortal = true;
      details.portalDistance = minPortalDist;
    } else {
      details.canReachPortal = null; // Inconclusive: do not declare definitely false
      details.portalDistance = null;
    }
    warnings.push(
      `Search budget of ${maxStates} states exhausted before exploration finished. Reachability results are inconclusive.`
    );
    errors.push(`Reachability search exceeded state budget (${maxStates} states): level verification is inconclusive.`);
  } else {
    details.isInconclusive = false;
    details.canReachPortal = minPortalDist !== null; // Definitive boolean result
    details.portalDistance = minPortalDist;
  }

  // 11. Gameplay Objectives Verification
  // Only declare definitive portal unreachability when exploration completed without finding it
  if (details.canReachPortal === false) {
    errors.push(`Portal at (${px}, ${py}) cannot be reached from starting state`);
  }

  if (!details.isInconclusive) {
    const reachedApplesCount = details.reachableApples.length;
    const reachedKeysCount = details.reachableKeys.length;

    switch (objective) {
      case 'eat_all_apples':
        if (reachedApplesCount < apples.length) {
          errors.push(
            `Objective "eat_all_apples" failed: only ${reachedApplesCount} of ${apples.length} apples are reachable`
          );
        }
        break;

      case 'collect_apple_count':
        if (reachedApplesCount < targetValue) {
          errors.push(
            `Objective "collect_apple_count" requires ${targetValue} apples, but only ${reachedApplesCount} are reachable`
          );
        }
        break;

      case 'reach_length': {
        const potentialLength = initialLength + reachedApplesCount;
        if (potentialLength < targetValue) {
          errors.push(
            `Objective "reach_length" requires length ${targetValue}, but maximum reachable length is ${potentialLength}`
          );
        }
        break;
      }

      case 'collect_keys': {
        if (keys.length === 0) {
          errors.push('Objective "collect_keys" requires at least one key in the level (found 0)');
        } else {
          const reqKeys = (targetValue !== undefined && targetValue !== null && targetValue > 0)
            ? targetValue
            : keys.length;
          if (reachedKeysCount < reqKeys) {
            errors.push(
              `Objective "collect_keys" requires ${reqKeys} keys, but only ${reachedKeysCount} are reachable`
            );
          }
        }
        break;
      }

      case 'limited_moves':
        if (
          typeof level.moveLimit === 'number' &&
          details.portalDistance !== null &&
          details.portalDistance > level.moveLimit
        ) {
          errors.push(
            `Objective "limited_moves": shortest route to portal (${details.portalDistance}) exceeds moveLimit (${level.moveLimit})`
          );
        }
        break;

      case 'perfect_route':
        if (Array.isArray(level.starThresholds) && level.starThresholds.length === 3) {
          const threeStarTarget = level.starThresholds[0];
          if (details.portalDistance !== null && details.portalDistance > threeStarTarget) {
            errors.push(
              `Objective "perfect_route": shortest route to portal (${details.portalDistance}) exceeds 3-star threshold (${threeStarTarget})`
            );
          }
        }
        break;

      case 'reach_portal':
      default:
        break;
    }

    // Absolute moveLimit constraint check
    if (
      typeof level.moveLimit === 'number' &&
      details.portalDistance !== null &&
      details.portalDistance > level.moveLimit
    ) {
      errors.push(
        `Level moveLimit (${level.moveLimit}) is strictly less than shortest path to portal (${details.portalDistance})`
      );
    }
  }

  // 12. Physics & Simulation Advisory Warnings
  if (apples.length > 1) {
    warnings.push(
      'Static BFS verifies individual apple reachability; it does not guarantee a single continuous route exists without body entrapment.'
    );
  }

  const stones = Array.isArray(level.stones) ? level.stones : [];
  if (stones.length > 0) {
    warnings.push(
      `Level contains ${stones.length} pushable stone(s); dynamic displacement physics are not evaluated in static reachability.`
    );
  }

  const movingBlocks = obstacles.filter((o) => o.type === 'moving_block');
  if (movingBlocks.length > 0) {
    warnings.push(
      `Level contains ${movingBlocks.length} moving block(s); patrol timing and collision clearance are not evaluated in static reachability.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    details,
  };
}

export default {
  validateLevelPlayability,
};