import { resolveMysteryEffect } from '../../utils/mysteryApple.js';

export const DIRECTION_VECTORS = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
};

export function getMovingBlockPosition(obs, moves = 0) {
  if (obs.type !== 'moving_block' || !obs.range || !obs.axis) {
    return { x: obs.x, y: obs.y };
  }
  const cycle = 2 * obs.range;
  const phase = ((moves % cycle) + cycle) % cycle;
  const offset = phase <= obs.range ? phase : cycle - phase;
  return {
    x: obs.axis === 'horizontal' ? obs.x + offset : obs.x,
    y: obs.axis === 'vertical' ? obs.y + offset : obs.y,
  };
}

export function normalizeStarThresholds(rawThresholds) {
  if (!rawThresholds || typeof rawThresholds !== 'object') {
    return null;
  }

  const threeVal =
    rawThresholds.threeStars !== undefined
      ? rawThresholds.threeStars
      : rawThresholds.threeStar;

  const twoVal =
    rawThresholds.twoStars !== undefined
      ? rawThresholds.twoStars
      : rawThresholds.twoStar;

  const oneVal =
    rawThresholds.oneStar !== undefined
      ? rawThresholds.oneStar
      : rawThresholds.oneStars;

  if (
    typeof threeVal !== 'number' || !Number.isFinite(threeVal) || threeVal < 1 ||
    typeof twoVal !== 'number' || !Number.isFinite(twoVal) || twoVal < 1 ||
    typeof oneVal !== 'number' || !Number.isFinite(oneVal) || oneVal < 1
  ) {
    return null;
  }

  if (threeVal > twoVal || twoVal > oneVal) {
    return null;
  }

  return {
    threeStars: threeVal,
    twoStars: twoVal,
    oneStar: oneVal,
  };
}

export function computeInitialWorm(wormStart) {
  const { x = 2, y = 2, direction = 'RIGHT', initialLength = 2 } = wormStart || {};
  const segments = [{ x, y }];

  for (let i = 1; i < initialLength; i++) {
    let segX = x;
    let segY = y;
    if (direction === 'RIGHT') segX -= i;
    else if (direction === 'LEFT') segX += i;
    else if (direction === 'UP') segY += i;
    else if (direction === 'DOWN') segY -= i;
    segments.push({ x: segX, y: segY });
  }

  return segments;
}

export class WormGameEngine {
  constructor(levelData, initialSession = null, options = {}) {
    if (initialSession && typeof initialSession === 'object' && !initialSession._id && !initialSession.sessionId && !initialSession.levelId) {
      options = initialSession;
      initialSession = null;
    }
    this.level = levelData || {};
    this.session = initialSession;
    this.options = options || {};
    this.sessionSeed =
      this.options.sessionSeed ||
      this.session?._id?.toString() ||
      this.session?.sessionId ||
      this.level.levelNumber ||
      'default';
    this.mysteryAppleConfig = this.options.mysteryAppleConfig || this.level.mysteryAppleConfig || {};
    this.predefinedMysteryEffects =
      this.options.mysteryEffects || this.session?.mysteryEffects || this.level.mysteryEffects || [];

    this.cols = this.level.grid?.cols || 20;
    this.rows = this.level.grid?.rows || 12;
    this.moveLimit = this.level.moveLimit || 50;
    this.timeAppleBonusMoves = Number(this.level.timeAppleBonusMoves) || 5;
    this.extraMovesAllowed = 0;
    this.portal = {
      x: this.level.portal?.x ?? 0,
      y: this.level.portal?.y ?? 0,
    };
    this.objective = this.level.objective || 'reach_portal';
    this.targetValue = this.level.targetValue ?? null;
    this.totalApplesCount = Array.isArray(this.level.apples) ? this.level.apples.length : 0;
    this.totalKeysCount = Array.isArray(this.level.keys) ? this.level.keys.length : 0;
    this.starThresholds = normalizeStarThresholds(this.level.starThresholds);

    this.undoStack = [];
    this.reset();
  }

  get width() {
    return this.cols;
  }

  get height() {
    return this.rows;
  }

  get gridWidth() {
    return this.cols;
  }

  get gridHeight() {
    return this.rows;
  }

  get movesCount() {
    return this.moves;
  }

  get currentScore() {
    return (
      this.applesEaten * 100 +
      (this.goldenApplesEaten || 0) * 50 +
      (this.mysteryScoreBonus || 0)
    );
  }

  get score() {
    return this.currentScore;
  }

  get effectiveMoveLimit() {
    return (
      this.moveLimit +
      this.extraMovesAllowed +
      (this.timeApplesEaten || 0) * (this.timeAppleBonusMoves || 5) +
      (this.mysteryExtraMoves || 0)
    );
  }

  get movesRemaining() {
    return Math.max(0, this.effectiveMoveLimit - this.moves);
  }

  setExtraMovesAllowed(extraMoves) {
    this.extraMovesAllowed = Math.max(0, Number(extraMoves) || 0);
    if (this.status === 'FAILED' && this.failureReason === 'OUT_OF_MOVES' && this.moves < this.effectiveMoveLimit) {
      this.status = 'PLAYING';
      this.failureReason = null;
    }
  }

  reset() {
    const wormStart = this.level.wormStart || { x: 2, y: 2, initialLength: 2, direction: 'RIGHT' };
    this.worm = computeInitialWorm(wormStart);
    this.direction = wormStart.direction || 'RIGHT';

    this.apples = (this.level.apples || []).map((a) => ({
      x: a.x,
      y: a.y,
      type: a.type || 'normal',
      mysteryEffect: a.mysteryEffect ? { ...a.mysteryEffect } : undefined,
    }));
    this.stones = (this.level.stones || []).map((s) => ({ x: s.x, y: s.y }));
    this.keys = (this.level.keys || []).map((k) => ({ x: k.x, y: k.y, keyId: k.keyId }));
    this.obstacles = (this.level.obstacles || []).map((o) => ({ ...o }));

    this.collectedKeys = new Set();
    this.filledPits = new Set();
    this.moves = 0;
    this.applesEaten = 0;
    this.goldenApplesEaten = 0;
    this.megaApplesEaten = 0;
    this.timeApplesEaten = 0;
    this.mysteryApplesEaten = 0;
    this.appliedMysteryEffects = [];
    this.mysteryScoreBonus = 0;
    this.mysteryExtraMoves = 0;
    this.mysteryExtraGrowth = 0;
    this.status = 'PLAYING';
    this.failureReason = null;
    this.extraMovesAllowed = 0;
    this.undoStack = [];
  }

  getCheckpointState() {
    return {
      wormState: this.worm.map((s) => ({ x: s.x, y: s.y })),
      direction: this.direction,
      movesTaken: this.moves,
      applesEaten: this.applesEaten,
      goldenApplesEaten: this.goldenApplesEaten || 0,
      megaApplesEaten: this.megaApplesEaten || 0,
      timeApplesEaten: this.timeApplesEaten || 0,
      mysteryApplesEaten: this.mysteryApplesEaten || 0,
      mysteryEffectsApplied: this.appliedMysteryEffects.map((e) => ({ ...e })),
      currentScore: this.currentScore,
      applesRemaining: this.apples.map((a) => ({
        x: a.x,
        y: a.y,
        type: a.type,
        mysteryEffect: a.mysteryEffect ? { ...a.mysteryEffect } : undefined,
      })),
      keysRemaining: this.keys.map((k) => ({ x: k.x, y: k.y, keyId: k.keyId })),
      stones: this.stones.map((s) => ({ x: s.x, y: s.y })),
      collectedKeys: Array.from(this.collectedKeys),
      filledPits: Array.from(this.filledPits),
    };
  }

  restoreFromCheckpoint(cp) {
    if (!cp) return;
    if (Array.isArray(cp.wormState)) {
      this.worm = cp.wormState.map((s) => ({ ...s }));
    }
    if (cp.direction) {
      this.direction = cp.direction;
    }
    if (cp.movesTaken !== undefined) {
      this.moves = Number(cp.movesTaken) || 0;
    }
    if (cp.applesEaten !== undefined) {
      this.applesEaten = Number(cp.applesEaten) || 0;
    }
    if (cp.goldenApplesEaten !== undefined) {
      this.goldenApplesEaten = Number(cp.goldenApplesEaten) || 0;
    }
    if (cp.megaApplesEaten !== undefined) {
      this.megaApplesEaten = Number(cp.megaApplesEaten) || 0;
    }
    if (cp.timeApplesEaten !== undefined) {
      this.timeApplesEaten = Number(cp.timeApplesEaten) || 0;
    }
    if (cp.mysteryApplesEaten !== undefined) {
      this.mysteryApplesEaten = Number(cp.mysteryApplesEaten) || 0;
    }
    if (Array.isArray(cp.mysteryEffectsApplied)) {
      this.appliedMysteryEffects = cp.mysteryEffectsApplied.map((e) => ({ ...e }));
      this.mysteryScoreBonus = this.appliedMysteryEffects
        .filter((e) => e.type === 'BONUS_SCORE')
        .reduce((sum, e) => sum + (Number(e.value) || 0), 0);
      this.mysteryExtraMoves = this.appliedMysteryEffects
        .filter((e) => e.type === 'EXTRA_MOVES')
        .reduce((sum, e) => sum + (Number(e.value) || 0), 0);
      this.mysteryExtraGrowth = this.appliedMysteryEffects
        .filter((e) => e.type === 'EXTRA_GROWTH')
        .reduce((sum, e) => sum + (Number(e.value) || 0), 0);
    }
    if (Array.isArray(cp.applesRemaining)) {
      this.apples = cp.applesRemaining.map((a) => ({
        x: a.x,
        y: a.y,
        type: a.type || 'normal',
        mysteryEffect: a.mysteryEffect ? { ...a.mysteryEffect } : undefined,
      }));
    }
    if (Array.isArray(cp.keysRemaining)) {
      this.keys = cp.keysRemaining.map((k) => ({ ...k }));
    }
    if (Array.isArray(cp.stones)) {
      this.stones = cp.stones.map((s) => ({ ...s }));
    }
    if (Array.isArray(cp.collectedKeys)) {
      this.collectedKeys = new Set(cp.collectedKeys);
    }
    if (Array.isArray(cp.filledPits)) {
      this.filledPits = new Set(cp.filledPits);
    }

    if (this.moves >= this.effectiveMoveLimit) {
      this.status = 'FAILED';
      this.failureReason = 'OUT_OF_MOVES';
    } else {
      this.status = 'PLAYING';
      this.failureReason = null;
    }
  }

  createSnapshot() {
    return {
      worm: this.worm.map((s) => ({ ...s })),
      direction: this.direction,
      apples: this.apples.map((a) => ({
        x: a.x,
        y: a.y,
        type: a.type,
        mysteryEffect: a.mysteryEffect ? { ...a.mysteryEffect } : undefined,
      })),
      stones: this.stones.map((s) => ({ ...s })),
      keys: this.keys.map((k) => ({ ...k })),
      collectedKeys: new Set(this.collectedKeys),
      filledPits: new Set(this.filledPits),
      moves: this.moves,
      applesEaten: this.applesEaten,
      goldenApplesEaten: this.goldenApplesEaten || 0,
      megaApplesEaten: this.megaApplesEaten || 0,
      timeApplesEaten: this.timeApplesEaten || 0,
      mysteryApplesEaten: this.mysteryApplesEaten || 0,
      appliedMysteryEffects: this.appliedMysteryEffects.map((e) => ({ ...e })),
      mysteryScoreBonus: this.mysteryScoreBonus || 0,
      mysteryExtraMoves: this.mysteryExtraMoves || 0,
      mysteryExtraGrowth: this.mysteryExtraGrowth || 0,
      status: this.status,
      failureReason: this.failureReason,
      extraMovesAllowed: this.extraMovesAllowed,
    };
  }

  restoreSnapshot(snapshot) {
    this.worm = snapshot.worm.map((s) => ({ ...s }));
    this.direction = snapshot.direction;
    this.apples = snapshot.apples.map((a) => ({
      x: a.x,
      y: a.y,
      type: a.type,
      mysteryEffect: a.mysteryEffect ? { ...a.mysteryEffect } : undefined,
    }));
    this.stones = snapshot.stones.map((s) => ({ ...s }));
    this.keys = snapshot.keys.map((k) => ({ ...k }));
    this.collectedKeys = new Set(snapshot.collectedKeys);
    this.filledPits = new Set(snapshot.filledPits);
    this.moves = snapshot.moves;
    this.applesEaten = snapshot.applesEaten;
    this.goldenApplesEaten = snapshot.goldenApplesEaten || 0;
    this.megaApplesEaten = snapshot.megaApplesEaten || 0;
    this.timeApplesEaten = snapshot.timeApplesEaten || 0;
    this.mysteryApplesEaten = snapshot.mysteryApplesEaten || 0;
    this.appliedMysteryEffects = (snapshot.appliedMysteryEffects || []).map((e) => ({ ...e }));
    this.mysteryScoreBonus = snapshot.mysteryScoreBonus || 0;
    this.mysteryExtraMoves = snapshot.mysteryExtraMoves || 0;
    this.mysteryExtraGrowth = snapshot.mysteryExtraGrowth || 0;
    this.status = snapshot.status;
    this.failureReason = snapshot.failureReason;
    this.extraMovesAllowed = snapshot.extraMovesAllowed || 0;
  }

  undo() {
    if (this.undoStack.length === 0 || this.status === 'WON') {
      return false;
    }
    const previous = this.undoStack.pop();
    this.restoreSnapshot(previous);
    return true;
  }

  /**
   * Revive the worm from a fatal state using last valid checkpoint or undo snapshot.
   * Clears failure state and restores status to PLAYING.
   * @param {number} [extraMoves=0] - Optional extra moves granted on revive.
   */
  revive(extraMoves = 0) {
    if (this.status !== 'FAILED') {
      return false;
    }
    if (this.undoStack.length > 0) {
      const previous = this.undoStack.pop();
      this.restoreSnapshot(previous);
    }
    this.status = 'PLAYING';
    this.failureReason = null;
    if (extraMoves > 0) {
      this.extraMovesAllowed = (this.extraMovesAllowed || 0) + extraMoves;
    }
    return true;
  }

  /**
   * Add bonus moves to the move limit to continue an active puzzle.
   * @param {number} movesToAdd - Number of moves to grant
   */
  addExtraMoves(movesToAdd = 5) {
    this.extraMovesAllowed = (this.extraMovesAllowed || 0) + movesToAdd;
    if (this.status === 'FAILED' && this.failureReason === 'OUT_OF_MOVES') {
      this.status = 'PLAYING';
      this.failureReason = null;
    }
    return this.extraMovesAllowed;
  }

  getMovingBlockPosition(obs, moves = this.moves) {
    return getMovingBlockPosition(obs, moves);
  }

  isSolidObstacle(x, y, moves = this.moves) {
    const coordKey = `${x},${y}`;
    for (const obs of this.obstacles) {
      if (obs.type === 'moving_block') {
        const pos = this.getMovingBlockPosition(obs, moves);
        if (pos.x === x && pos.y === y) return true;
      } else if (obs.x === x && obs.y === y) {
        if (obs.type === 'wall') return true;
        if (obs.type === 'gate' && !this.collectedKeys.has(obs.keyId)) return true;
        if (obs.type === 'pit' && this.filledPits.has(coordKey)) return false;
      }
    }
    return false;
  }

  getObjectiveDescription() {
    switch (this.objective) {
      case 'reach_portal':
        return 'Navigate the worm to the exit portal.';
      case 'eat_all_apples':
        return 'Eat all apples and enter the exit portal.';
      case 'collect_keys': {
        const required = this.targetValue !== null ? this.targetValue : this.totalKeysCount;
        return `Collect ${required} key${required === 1 ? '' : 's'} (${this.collectedKeys.size}/${required}) and reach the portal.`;
      }
      case 'collect_apple_count': {
        const required = this.targetValue !== null ? this.targetValue : 1;
        return `Eat ${required} apple${required === 1 ? '' : 's'} (${this.applesEaten}/${required}) and reach the portal.`;
      }
      case 'reach_length': {
        const required = this.targetValue !== null ? this.targetValue : 3;
        return `Grow the worm to length ${required} (current: ${this.worm.length}) and reach the portal.`;
      }
      case 'limited_moves': {
        const threshold = this.targetValue !== null ? this.targetValue : this.effectiveMoveLimit;
        return `Reach the exit portal in ${threshold} moves or fewer (used: ${this.moves}).`;
      }
      case 'perfect_route': {
        const threeStarTarget = this.starThresholds?.threeStars ?? this.starThresholds?.threeStar;
        if (typeof threeStarTarget === 'number' && Number.isFinite(threeStarTarget)) {
          return `Achieve a 3-star clear by reaching the portal in ≤ ${threeStarTarget} moves (used: ${this.moves}).`;
        }
        return 'Reach the exit portal with optimal moves (3-star threshold unconfigured).';
      }
      default:
        return 'Eat all apples and reach the exit portal.';
    }
  }

  isObjectiveMet() {
    switch (this.objective) {
      case 'eat_all_apples':
        return this.apples.length === 0;
      case 'reach_portal':
        return true;
      case 'collect_keys': {
        const required = this.targetValue !== null ? this.targetValue : this.totalKeysCount;
        return this.collectedKeys.size >= required;
      }
      case 'collect_apple_count': {
        const required = this.targetValue !== null ? this.targetValue : 1;
        return this.applesEaten >= required;
      }
      case 'reach_length': {
        const required = this.targetValue !== null ? this.targetValue : 3;
        return this.worm.length >= required;
      }
      case 'limited_moves': {
        const threshold = this.targetValue !== null ? this.targetValue : this.effectiveMoveLimit;
        return this.moves <= threshold;
      }
      case 'perfect_route': {
        const threshold = this.starThresholds?.threeStars ?? this.starThresholds?.threeStar;
        if (typeof threshold === 'number' && Number.isFinite(threshold)) {
          return this.moves <= threshold;
        }
        return false;
      }
      default:
        return this.apples.length === 0;
    }
  }

  move(dir) {
    if (this.status !== 'PLAYING') {
      return { moved: false };
    }

    const vector = DIRECTION_VECTORS[dir];
    if (!vector) return { moved: false };

    const head = this.worm[0];
    const neck = this.worm[1];

    if (neck && head.x + vector.dx === neck.x && head.y + vector.dy === neck.y) {
      return { moved: false, message: 'Cannot reverse directly into your own body!' };
    }

    const nextX = head.x + vector.dx;
    const nextY = head.y + vector.dy;

    if (nextX < 0 || nextX >= this.cols || nextY < 0 || nextY >= this.rows) {
      return { moved: false, message: 'Boundary blocked!' };
    }

    if (this.isSolidObstacle(nextX, nextY)) {
      return { moved: false, message: 'Path blocked by obstacle!' };
    }

    const hitDirectSpike = this.obstacles.some((o) => o.type === 'spike' && o.x === nextX && o.y === nextY);
    if (hitDirectSpike) {
      this.undoStack.push(this.createSnapshot());
      this.moves++;
      this.status = 'FAILED';
      this.failureReason = 'HIT_SPIKE';
      return {
        moved: true,
        status: 'FAILED',
        failureReason: 'HIT_SPIKE',
        event: 'spike',
        collectedApple: false,
        collectedKey: false,
      };
    }

    const hitDirectPit = this.obstacles.some(
      (o) => o.type === 'pit' && o.x === nextX && o.y === nextY && !this.filledPits.has(`${nextX},${nextY}`)
    );
    if (hitDirectPit) {
      this.undoStack.push(this.createSnapshot());
      this.moves++;
      this.status = 'FAILED';
      this.failureReason = 'FALLEN_OFF_GRID';
      return {
        moved: true,
        status: 'FAILED',
        failureReason: 'FALLEN_OFF_GRID',
        event: 'pit',
        collectedApple: false,
        collectedKey: false,
      };
    }

    const stoneIndex = this.stones.findIndex((s) => s.x === nextX && s.y === nextY);
    let pendingStonePush = null;

    if (stoneIndex !== -1) {
      const stoneDestX = nextX + vector.dx;
      const stoneDestY = nextY + vector.dy;

      if (stoneDestX < 0 || stoneDestX >= this.cols || stoneDestY < 0 || stoneDestY >= this.rows) {
        return { moved: false, message: 'Cannot push stone outside grid!' };
      }
      if (this.isSolidObstacle(stoneDestX, stoneDestY)) {
        return { moved: false, message: 'Stone path is blocked by an obstacle!' };
      }
      const isMovingBlockPatrolTile = this.obstacles.some((obs) => {
        if (obs.type !== 'moving_block' || !obs.range || !obs.axis) return false;
        if (obs.axis === 'horizontal') {
          return stoneDestY === obs.y && stoneDestX >= obs.x && stoneDestX <= obs.x + obs.range;
        }
        if (obs.axis === 'vertical') {
          return stoneDestX === obs.x && stoneDestY >= obs.y && stoneDestY <= obs.y + obs.range;
        }
        return false;
      });
      if (isMovingBlockPatrolTile) {
        return { moved: false, message: 'Cannot push stone into a moving obstacle path!' };
      }
      if (this.stones.some((s) => s.x === stoneDestX && s.y === stoneDestY)) {
        return { moved: false, message: 'Cannot push into another stone!' };
      }
      if (this.worm.some((w) => w.x === stoneDestX && w.y === stoneDestY)) {
        return { moved: false, message: 'Stone is blocked by your body!' };
      }

      pendingStonePush = {
        index: stoneIndex,
        destX: stoneDestX,
        destY: stoneDestY,
      };
    }

    const appleOnNext = this.apples.find((a) => a.x === nextX && a.y === nextY);
    const bodySegmentsToCheck = appleOnNext ? this.worm : this.worm.slice(0, -1);
    const hitSelf = bodySegmentsToCheck.some((seg) => seg.x === nextX && seg.y === nextY);

    if (hitSelf) {
      this.undoStack.push(this.createSnapshot());
      this.moves++;
      this.status = 'FAILED';
      this.failureReason = 'SELF_COLLISION';
      return {
        moved: true,
        status: 'FAILED',
        failureReason: 'SELF_COLLISION',
        event: 'self_collision',
        collectedApple: false,
        collectedKey: false,
      };
    }

    this.undoStack.push(this.createSnapshot());

    let filledPit = false;
    let pitCoord = null;
    let pushedStone = false;

    if (pendingStonePush) {
      pushedStone = true;
      const pitAtDest = this.obstacles.find(
        (o) => o.type === 'pit' && o.x === pendingStonePush.destX && o.y === pendingStonePush.destY
      );

      if (pitAtDest && !this.filledPits.has(`${pendingStonePush.destX},${pendingStonePush.destY}`)) {
        this.filledPits.add(`${pendingStonePush.destX},${pendingStonePush.destY}`);
        this.stones.splice(pendingStonePush.index, 1);
        filledPit = true;
        pitCoord = { x: pendingStonePush.destX, y: pendingStonePush.destY };
      } else {
        this.stones[pendingStonePush.index].x = pendingStonePush.destX;
        this.stones[pendingStonePush.index].y = pendingStonePush.destY;
      }
    }

    this.direction = dir;
    this.moves++;

    let collectedApple = false;
    let collectedAppleType = null;
    let mysteryEffect = null;
    if (appleOnNext) {
      collectedApple = true;
      collectedAppleType = appleOnNext.type || 'normal';
      this.applesEaten++;
      if (collectedAppleType === 'golden') {
        this.goldenApplesEaten = (this.goldenApplesEaten || 0) + 1;
      } else if (collectedAppleType === 'mega') {
        this.megaApplesEaten = (this.megaApplesEaten || 0) + 1;
      } else if (collectedAppleType === 'time') {
        this.timeApplesEaten = (this.timeApplesEaten || 0) + 1;
      } else if (collectedAppleType === 'mystery') {
        this.mysteryApplesEaten = (this.mysteryApplesEaten || 0) + 1;
        if (appleOnNext.mysteryEffect) {
          mysteryEffect = {
            x: appleOnNext.x,
            y: appleOnNext.y,
            type: appleOnNext.mysteryEffect.type,
            value: appleOnNext.mysteryEffect.value,
          };
        } else {
          const predefined = this.predefinedMysteryEffects.find(
            (p) => p.x === appleOnNext.x && p.y === appleOnNext.y
          );
          if (predefined) {
            mysteryEffect = {
              x: appleOnNext.x,
              y: appleOnNext.y,
              type: predefined.type,
              value: predefined.value,
            };
          } else {
            mysteryEffect = resolveMysteryEffect(
              this.sessionSeed,
              appleOnNext.x,
              appleOnNext.y,
              this.mysteryAppleConfig
            );
          }
        }
        this.appliedMysteryEffects.push({ ...mysteryEffect });
        if (mysteryEffect.type === 'BONUS_SCORE') {
          this.mysteryScoreBonus += mysteryEffect.value;
        } else if (mysteryEffect.type === 'EXTRA_MOVES') {
          this.mysteryExtraMoves += mysteryEffect.value;
        } else if (mysteryEffect.type === 'EXTRA_GROWTH') {
          this.mysteryExtraGrowth += mysteryEffect.value;
        }
      }
      this.apples = this.apples.filter((a) => a !== appleOnNext);
    }

    let collectedKey = false;
    let collectedKeyId = null;
    const keyOnNext = this.keys.find((k) => k.x === nextX && k.y === nextY);
    if (keyOnNext) {
      collectedKey = true;
      collectedKeyId = keyOnNext.keyId;
      this.collectedKeys.add(keyOnNext.keyId);
      this.keys = this.keys.filter((k) => k !== keyOnNext);
    }

    const isGoldenApple = collectedAppleType === 'golden';
    const isMegaApple = collectedAppleType === 'mega';
    const isTimeApple = collectedAppleType === 'time';
    const isMysteryApple = collectedAppleType === 'mystery';
    const isExtraGrowth = isMegaApple || (isMysteryApple && mysteryEffect?.type === 'EXTRA_GROWTH');
    const timeBonusMoves = isTimeApple ? (this.timeAppleBonusMoves || 5) : 0;

    const newHead = { x: nextX, y: nextY };
    let newWorm;
    if (!collectedApple) {
      newWorm = [newHead, ...this.worm.slice(0, -1).map((s) => ({ ...s }))];
    } else if (!isExtraGrowth) {
      // Normal, Golden, Time or non-extra-growth Mystery Apple: grows by +1 segment (preserves all existing segments)
      newWorm = [newHead, ...this.worm.map((s) => ({ ...s }))];
    } else {
      // Mega Apple or Mystery EXTRA_GROWTH Apple: grows by exactly +2 segments
      const baseSegments = [newHead, ...this.worm.map((s) => ({ ...s }))];
      const tail = baseSegments[baseSegments.length - 1];
      const beforeTail = baseSegments[baseSegments.length - 2];
      const dx = tail.x - beforeTail.x;
      const dy = tail.y - beforeTail.y;

      const candidates = [
        { x: tail.x + dx, y: tail.y + dy },      // Straight continuation
        { x: tail.x - dy, y: tail.y + dx },      // Perpendicular candidate 1
        { x: tail.x + dy, y: tail.y - dx },      // Perpendicular candidate 2
      ];

      let extraTail = candidates.find(
        (c) =>
          c.x >= 0 &&
          c.x < this.cols &&
          c.y >= 0 &&
          c.y < this.rows &&
          !this.isSolidObstacle(c.x, c.y) &&
          !this.obstacles.some((o) => o.type === 'spike' && o.x === c.x && o.y === c.y) &&
          !baseSegments.some((s) => s.x === c.x && s.y === c.y) &&
          !this.stones.some((s) => s.x === c.x && s.y === c.y)
      );

      if (!extraTail) {
        extraTail = candidates[0];
      }

      newWorm = [...baseSegments, { x: extraTail.x, y: extraTail.y }];
    }
    this.worm = newWorm;

    const crushedByBlock = this.obstacles.find((obs) => {
      if (obs.type !== 'moving_block') return false;
      const pos = this.getMovingBlockPosition(obs, this.moves);
      return this.worm.some((seg) => seg.x === pos.x && seg.y === pos.y);
    });

    if (crushedByBlock) {
      this.status = 'FAILED';
      this.failureReason = 'CRUSHED';
      return {
        moved: true,
        status: 'FAILED',
        failureReason: 'CRUSHED',
        event: 'crushed',
        collectedApple,
        collectedAppleType,
        isGoldenApple,
        isMegaApple,
        isTimeApple,
        isMysteryApple,
        mysteryEffect,
        timeBonusMoves,
        collectedKey,
        collectedKeyId,
        pushedStone,
        filledPit,
        pitCoord,
        moveHead: { x: nextX, y: nextY },
      };
    }

    if (this.moves >= this.effectiveMoveLimit && this.status === 'PLAYING') {
      if (this.worm[0].x === this.portal.x && this.worm[0].y === this.portal.y && this.isObjectiveMet()) {
        this.status = 'WON';
        return {
          moved: true,
          status: 'WON',
          failureReason: null,
          event: 'victory',
          collectedApple,
          collectedAppleType,
          isGoldenApple,
          isMegaApple,
          isTimeApple,
          isMysteryApple,
          mysteryEffect,
          timeBonusMoves,
          collectedKey,
          collectedKeyId,
          pushedStone,
          filledPit,
          pitCoord,
          moveHead: { x: nextX, y: nextY },
        };
      }
      this.status = 'FAILED';
      this.failureReason = 'OUT_OF_MOVES';
      return {
        moved: true,
        status: 'FAILED',
        failureReason: 'OUT_OF_MOVES',
        event: 'out_of_moves',
        collectedApple,
        collectedAppleType,
        isGoldenApple,
        isMegaApple,
        isTimeApple,
        isMysteryApple,
        mysteryEffect,
        timeBonusMoves,
        collectedKey,
        collectedKeyId,
        pushedStone,
        filledPit,
        pitCoord,
        moveHead: { x: nextX, y: nextY },
      };
    }

    if (this.status === 'PLAYING' && this.worm[0].x === this.portal.x && this.worm[0].y === this.portal.y) {
      if (this.isObjectiveMet()) {
        this.status = 'WON';
        return {
          moved: true,
          status: 'WON',
          failureReason: null,
          event: 'victory',
          collectedApple,
          collectedAppleType,
          isGoldenApple,
          isMegaApple,
          isTimeApple,
          isMysteryApple,
          mysteryEffect,
          timeBonusMoves,
          collectedKey,
          collectedKeyId,
          pushedStone,
          filledPit,
          pitCoord,
          moveHead: { x: nextX, y: nextY },
        };
      }
    }

    const event = collectedApple ? 'grow' : pendingStonePush ? (filledPit ? 'pit_fill' : 'push') : 'step';
    return {
      moved: true,
      status: this.status,
      failureReason: null,
      event,
      collectedApple,
      collectedAppleType,
      isGoldenApple,
      isMegaApple,
      isTimeApple,
      isMysteryApple,
      mysteryEffect,
      timeBonusMoves,
      collectedKey,
      collectedKeyId,
      pushedStone,
      filledPit,
      pitCoord,
      moveHead: { x: nextX, y: nextY },
    };
  }

  calculateStars() {
    if (this.starThresholds) {
      const { threeStars, twoStars } = this.starThresholds;
      if (this.moves <= threeStars) return 3;
      if (this.moves <= twoStars) return 2;
      return 1;
    }
    return 1;
  }
}

export default WormGameEngine;