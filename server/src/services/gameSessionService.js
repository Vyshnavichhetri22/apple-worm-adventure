import mongoose from 'mongoose';
import GameSession from '../models/GameSession.js';
import PlayerProgress from '../models/PlayerProgress.js';
import Level from '../models/Level.js';
import User from '../models/User.js';
import EconomyConfig from '../models/EconomyConfig.js';
import walletService from './walletService.js';
import inventoryService from './inventoryService.js';
import { resolveMysteryEffect, MYSTERY_EFFECT_TYPES } from '../utils/mysteryApple.js';

const MAX_CHECKPOINT_HISTORY = 50;

function computeInitialWormSegments(wormStart) {
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

function isWormContiguous(wormSegments) {
  for (let i = 1; i < wormSegments.length; i++) {
    const prev = wormSegments[i - 1];
    const curr = wormSegments[i];
    const manhattan = Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y);
    if (manhattan !== 1) {
      return false;
    }
  }
  return true;
}

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

export function collidesWithImpassableObstacle(segment, obstacles, moves = 0, filledPits = [], collectedKeys = []) {
  if (!obstacles || obstacles.length === 0) return false;
  const filledPitSet = filledPits instanceof Set ? filledPits : new Set(filledPits || []);
  const keySet = collectedKeys instanceof Set ? collectedKeys : new Set(collectedKeys || []);

  return obstacles.some((obs) => {
    if (obs.type === 'wall' || obs.type === 'spike') {
      return obs.x === segment.x && obs.y === segment.y;
    }
    if (obs.type === 'pit') {
      // If pit has been filled by a pushed stone, it is bridged and safe to traverse
      if (filledPitSet.has(`${obs.x},${obs.y}`)) {
        return false;
      }
      return obs.x === segment.x && obs.y === segment.y;
    }
    if (obs.type === 'gate') {
      // If corresponding key has been collected, the gate is open and passable
      if (keySet.has(obs.keyId)) {
        return false;
      }
      return obs.x === segment.x && obs.y === segment.y;
    }
    if (obs.type === 'moving_block') {
      const pos = getMovingBlockPosition(obs, moves);
      return pos.x === segment.x && pos.y === segment.y;
    }
    return false;
  });
}

export const gameSessionService = {
  async getOrCreatePlayerProgress(userId) {
    let progress = await PlayerProgress.findOne({ userId });
    if (!progress) {
      const user = await User.findById(userId).lean();
      const currentLevel = user?.currentLevel || 1;
      const completedList = Array.isArray(user?.completedLevels) ? user.completedLevels : [];
      const highestUnlocked = Math.max(currentLevel, ...completedList.map((n) => n + 1), 1);

      progress = await PlayerProgress.create({
        userId,
        currentLevel,
        highestUnlockedLevel: highestUnlocked,
        completedLevels: completedList.map((num) => ({
          levelNumber: num,
          stars: 1,
          highScore: 0,
          leastMoves: 0,
          fastestTimeSeconds: 0,
          attemptsCount: 1,
        })),
        totalScore: user?.totalScore || 0,
        totalStars: user?.totalStars || 0,
        totalApplesEaten: 0,
      });
    }
    return progress;
  },

  async isLevelUnlocked(userId, levelNumber) {
    if (levelNumber === 1) return true;
    const progress = await this.getOrCreatePlayerProgress(userId);

    if (levelNumber <= progress.highestUnlockedLevel) return true;
    const hasCompletedPrior = progress.completedLevels.some(
      (rec) => rec.levelNumber === levelNumber - 1
    );
    return hasCompletedPrior;
  },

  async startSession(userId, levelNumber, options = {}) {
    if (typeof userId === 'object' && userId !== null && userId.userId) {
      options = userId.options || options;
      levelNumber = userId.levelNumber;
      userId = userId.userId;
    }

    const targetLevelNum = Number(levelNumber);
    const level = await Level.findOne({ levelNumber: targetLevelNum, isActive: true });
    if (!level) {
      const error = new Error(`Level ${targetLevelNum} not found or is currently inactive.`);
      error.statusCode = 404;
      throw error;
    }

    const isDaily = Boolean(options?.isDailyChallenge);
    if (!isDaily) {
      const unlocked = await this.isLevelUnlocked(userId, targetLevelNum);
      if (!unlocked) {
        const error = new Error(`Level ${targetLevelNum} is locked. You must complete preceding levels first.`);
        error.statusCode = 403;
        throw error;
      }
    }

    await GameSession.updateMany(
      { userId, levelNumber: targetLevelNum, status: 'ACTIVE' },
      {
        $set: {
          status: 'ABANDONED',
          endedAt: new Date(),
          failureReason: 'ABANDONED',
        },
      }
    );

    const initialWorm = level.wormStart
      ? computeInitialWormSegments(level.wormStart)
      : (level.worm && level.worm.length > 0
          ? level.worm
          : computeInitialWormSegments({ x: 2, y: 2, direction: 'RIGHT', initialLength: 2 }));

    const initialDirection = level.wormStart?.direction || level.startDirection || 'RIGHT';
    const initialApples = (level.apples || []).map((app) => ({ x: app.x, y: app.y, type: app.type || 'normal' }));
    const initialKeys = (level.keys || []).map((k) => ({ x: k.x, y: k.y, keyId: k.keyId || 'default' }));
    const initialStones = (level.stones || []).map((s) => ({ x: s.x, y: s.y }));

    const sessionId = new mongoose.Types.ObjectId();
    const economy = await EconomyConfig.getActiveConfig();
    const mysteryConfig = economy?.rules?.mysteryAppleConfig || {};
    const mysteryEffects = (level.apples || [])
      .filter((app) => (app.type || 'normal') === 'mystery')
      .map((app) => {
        if (app.mysteryEffect && app.mysteryEffect.type) {
          return {
            x: app.x,
            y: app.y,
            type: app.mysteryEffect.type,
            value: Number(app.mysteryEffect.value) || 0,
          };
        }
        return resolveMysteryEffect(sessionId.toString(), app.x, app.y, mysteryConfig);
      });

    const initialCheckpoint = {
      checkpointIndex: 0,
      wormState: initialWorm,
      direction: initialDirection,
      movesTaken: 0,
      applesEaten: 0,
      goldenApplesEaten: 0,
      megaApplesEaten: 0,
      timeApplesEaten: 0,
      mysteryApplesEaten: 0,
      mysteryEffectsApplied: [],
      currentScore: 0,
      applesRemaining: initialApples,
      keysRemaining: initialKeys,
      stones: initialStones,
      collectedKeys: [],
      filledPits: [],
      savedAt: new Date(),
    };

    const session = await GameSession.create({
      _id: sessionId,
      userId,
      levelId: level._id,
      levelNumber: targetLevelNum,
      isDailyChallenge: isDaily,
      challengeDate: isDaily ? (options?.challengeDate || null) : null,
      status: 'ACTIVE',
      startedAt: new Date(),
      extraMovesAllowed: 0,
      boostersUsed: 0,
      undosUsed: 0,
      hintsUsed: 0,
      mysteryApplesCollected: 0,
      mysteryEffects,
      initialState: {
        worm: initialWorm,
        apples: initialApples,
        keys: initialKeys,
        portal: level.portal ? { x: level.portal.x, y: level.portal.y } : { x: 0, y: 0 },
        grid: level.grid ? { cols: level.grid.cols, rows: level.grid.rows } : { cols: 20, rows: 12 },
      },
      checkpoint: initialCheckpoint,
      checkpointHistory: [],
      appliedBoosters: [],
      appliedUndos: [],
      appliedHints: [],
      appliedAdRewards: [],
    });

    return session;
  },

  async getSessionById(sessionId, userId) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      const error = new Error('Invalid session identifier.');
      error.statusCode = 400;
      throw error;
    }

    const session = await GameSession.findById(sessionId);
    if (!session) {
      const error = new Error('Game session not found.');
      error.statusCode = 404;
      throw error;
    }

    if (session.userId.toString() !== userId.toString()) {
      const error = new Error('Access denied: You do not own this game session.');
      error.statusCode = 403;
      throw error;
    }

    return session;
  },

  async saveCheckpoint(sessionId, userId, checkpointData) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      checkpointData = sessionId.checkpointData || sessionId.checkpoint;
      sessionId = sessionId.sessionId;
    }

    const session = await this.getSessionById(sessionId, userId);
    if (session.status !== 'ACTIVE') {
      const error = new Error(`Cannot save checkpoint for a session with status ${session.status}.`);
      error.statusCode = 400;
      throw error;
    }

    const level = await Level.findById(session.levelId);
    if (!level) {
      const error = new Error('Associated level definition was not found.');
      error.statusCode = 404;
      throw error;
    }

    const {
      wormState,
      direction = session.checkpoint?.direction || 'RIGHT',
      movesTaken,
      applesEaten = 0,
      currentScore = 0,
      applesRemaining,
      keysRemaining,
      stones = session.checkpoint?.stones || [],
      collectedKeys = session.checkpoint?.collectedKeys || [],
      filledPits = session.checkpoint?.filledPits || [],
    } = checkpointData || {};

    if (!Array.isArray(wormState) || wormState.length < 2) {
      const error = new Error('Checkpoint wormState must have at least 2 segments.');
      error.statusCode = 400;
      throw error;
    }

    if (typeof movesTaken !== 'number' || movesTaken < 0) {
      const error = new Error('Invalid movesTaken value provided.');
      error.statusCode = 400;
      throw error;
    }

    const currentMoves = session.checkpoint?.movesTaken ?? -1;
    if (movesTaken <= currentMoves) {
      return {
        success: true,
        deduplicated: true,
        moves: session.moves,
        historyLength: session.checkpointHistory.length,
      };
    }

    const cols = level.grid?.cols || 20;
    const rows = level.grid?.rows || 12;

    // 0a. Validate filled pits against authoritative level definitions
    const levelPits = (level.obstacles || []).filter((o) => o.type === 'pit');
    const levelPitCoords = new Set(levelPits.map((p) => `${p.x},${p.y}`));
    for (const pitKey of (filledPits || [])) {
      if (!levelPitCoords.has(pitKey)) {
        const error = new Error(`Invalid checkpoint: Filled pit '${pitKey}' is not a valid pit in level definition.`);
        error.statusCode = 400;
        throw error;
      }
    }

    // 0b. Validate collected keys against authoritative level definitions
    const levelKeys = level.keys || [];
    const validKeyIds = new Set(levelKeys.map((k) => k.keyId || 'default'));
    for (const keyId of (collectedKeys || [])) {
      if (!validKeyIds.has(keyId)) {
        const error = new Error(`Invalid checkpoint: Key '${keyId}' does not exist in level definition.`);
        error.statusCode = 400;
        throw error;
      }
    }

    // 0c. Validate stones invariants (bounds and conservation with filled pits)
    const initialStonesCount = (level.stones || []).length;
    if (initialStonesCount > 0) {
      const activeStonesCount = (stones || []).length;
      const filledCount = (filledPits || []).length;
      if (activeStonesCount + filledCount !== initialStonesCount) {
        const error = new Error(
          `Invalid checkpoint: Stone count mismatch. Initial: ${initialStonesCount}, active: ${activeStonesCount}, pits filled: ${filledCount}.`
        );
        error.statusCode = 400;
        throw error;
      }
      for (const st of (stones || [])) {
        if (st.x < 0 || st.x >= cols || st.y < 0 || st.y >= rows) {
          const error = new Error(`Stone at (${st.x}, ${st.y}) is out of bounds.`);
          error.statusCode = 400;
          throw error;
        }
      }
    }

    for (const segment of wormState) {
      if (segment.x < 0 || segment.x >= cols || segment.y < 0 || segment.y >= rows) {
        const error = new Error(`Worm segment (${segment.x}, ${segment.y}) is out of bounds [0..${cols - 1}, 0..${rows - 1}].`);
        error.statusCode = 400;
        throw error;
      }
      if (collidesWithImpassableObstacle(segment, level.obstacles, movesTaken, filledPits, collectedKeys)) {
        const error = new Error(`Worm segment (${segment.x}, ${segment.y}) overlaps an impassable obstacle.`);
        error.statusCode = 400;
        throw error;
      }
    }

    if (!isWormContiguous(wormState)) {
      const error = new Error('Worm segments must be contiguous (adjacent Manhattan distance of 1).');
      error.statusCode = 400;
      throw error;
    }

    const levelApples = level.apples || [];
    const normalizedApplesRemaining = (applesRemaining || []).map((a) => ({
      x: a.x,
      y: a.y,
      type: a.type || 'normal',
    }));

    // 1. Validate remaining apples against authoritative level definitions
    for (const remApple of normalizedApplesRemaining) {
      const existsInLevel = levelApples.some(
        (la) => la.x === remApple.x && la.y === remApple.y && (la.type || 'normal') === remApple.type
      );
      if (!existsInLevel) {
        const error = new Error(
          `Invalid checkpoint: Apple at (${remApple.x}, ${remApple.y}) does not exist in level definition.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    // 2. Reject duplicate coordinates in applesRemaining
    const seenAppleCoords = new Set();
    for (const remApple of normalizedApplesRemaining) {
      const coordKey = `${remApple.x},${remApple.y}`;
      if (seenAppleCoords.has(coordKey)) {
        const error = new Error(`Invalid checkpoint: Duplicate apple position (${remApple.x}, ${remApple.y}) in applesRemaining.`);
        error.statusCode = 400;
        throw error;
      }
      seenAppleCoords.add(coordKey);
    }

    // 3. Monotonic Apple Consumption from previous checkpoint
    const prevCp = session.checkpoint;
    const prevRemainingApples = prevCp?.applesRemaining || levelApples;
    for (const remApple of normalizedApplesRemaining) {
      const wasInPrev = prevRemainingApples.some(
        (pa) => pa.x === remApple.x && pa.y === remApple.y
      );
      if (!wasInPrev) {
        const error = new Error(
          `Invalid checkpoint: Apple at (${remApple.x}, ${remApple.y}) was already consumed in a previous checkpoint.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    // 4. Authoritatively identify collected apples by diffing level definitions against remaining apples
    const collectedApples = levelApples.filter(
      (la) => !normalizedApplesRemaining.some((ra) => ra.x === la.x && ra.y === la.y)
    );
    const authoritativeApplesEaten = collectedApples.length;
    const authoritativeGoldenEaten = collectedApples.filter((a) => (a.type || 'normal') === 'golden').length;
    const authoritativeMegaEaten = collectedApples.filter((a) => (a.type || 'normal') === 'mega').length;
    const authoritativeTimeEaten = collectedApples.filter((a) => (a.type || 'normal') === 'time').length;
    const authoritativeMysteryApples = collectedApples.filter((a) => (a.type || 'normal') === 'mystery');
    const authoritativeMysteryEaten = authoritativeMysteryApples.length;

    // Resolve authoritative effects for collected mystery apples
    const economy = await EconomyConfig.getActiveConfig();
    const mysteryConfig = economy?.rules?.mysteryAppleConfig || {};
    const sessionMysteryEffects = session.mysteryEffects || [];

    const resolvedAppliedEffects = [];
    let mysteryScoreBonus = 0;
    let mysteryExtraMoves = 0;
    let mysteryExtraGrowth = 0;

    for (const apple of authoritativeMysteryApples) {
      let effect = sessionMysteryEffects.find((e) => e.x === apple.x && e.y === apple.y);
      if (!effect) {
        if (apple.mysteryEffect && apple.mysteryEffect.type) {
          effect = {
            x: apple.x,
            y: apple.y,
            type: apple.mysteryEffect.type,
            value: Number(apple.mysteryEffect.value) || 0,
          };
        } else {
          effect = resolveMysteryEffect(session._id.toString(), apple.x, apple.y, mysteryConfig);
        }
        session.mysteryEffects.push(effect);
      }
      resolvedAppliedEffects.push({
        x: effect.x,
        y: effect.y,
        type: effect.type,
        value: effect.value,
      });

      if (effect.type === 'BONUS_SCORE') {
        mysteryScoreBonus += effect.value;
      } else if (effect.type === 'EXTRA_MOVES') {
        mysteryExtraMoves += effect.value;
      } else if (effect.type === 'EXTRA_GROWTH') {
        mysteryExtraGrowth += effect.value;
      }
    }

    // Client fabrication/spoofing guard for mystery effects
    if (Array.isArray(checkpointData?.mysteryEffectsApplied)) {
      for (const clientEff of checkpointData.mysteryEffectsApplied) {
        if (!clientEff || !clientEff.type || !MYSTERY_EFFECT_TYPES[clientEff.type]) {
          const error = new Error(`Invalid checkpoint: Unknown or unsupported mystery effect type '${clientEff?.type}'.`);
          error.statusCode = 400;
          throw error;
        }
        const expectedEff = resolvedAppliedEffects.find((e) => e.x === clientEff.x && e.y === clientEff.y);
        if (!expectedEff) {
          const error = new Error(
            `Invalid checkpoint: Reported mystery effect at (${clientEff.x}, ${clientEff.y}) does not match any consumed mystery apple.`
          );
          error.statusCode = 400;
          throw error;
        }
        if (expectedEff.type !== clientEff.type || Number(expectedEff.value) !== Number(clientEff.value)) {
          const error = new Error(
            `Invalid checkpoint: Spoofed mystery effect at (${clientEff.x}, ${clientEff.y}). Expected ${expectedEff.type} (${expectedEff.value}), got ${clientEff.type} (${clientEff.value}).`
          );
          error.statusCode = 400;
          throw error;
        }
      }
    }

    // Each normal/golden/time apple contributes 1 segment (+1); each mega apple contributes 2 segments (+2);
    // mystery apple contributes 1 segment or +2 if EXTRA_GROWTH effect is resolved:
    const authoritativeGrowth = authoritativeApplesEaten + authoritativeMegaEaten + mysteryExtraGrowth;

    // Movement allowance verification (including Time Apple bonus moves and Mystery extra moves)
    const timeAppleBonusMoves = level.timeAppleBonusMoves ?? economy?.rules?.timeAppleExtraMoves ?? 5;
    const authoritativeAllowedMoves =
      (level.moveLimit || 50) +
      (session.extraMovesAllowed || 0) +
      (authoritativeTimeEaten * timeAppleBonusMoves) +
      mysteryExtraMoves;

    if (movesTaken > authoritativeAllowedMoves) {
      const error = new Error(`movesTaken (${movesTaken}) exceeds level limit (${authoritativeAllowedMoves}).`);
      error.statusCode = 400;
      throw error;
    }

    // Checkpoint Anti-Cheat & Fabrication Guard:
    // Reject impossible client claim where client applesEaten exceeds level apples
    if (typeof applesEaten === 'number' && applesEaten > levelApples.length) {
      const error = new Error(
        `Reported applesEaten (${applesEaten}) exceeds total apples in level (${levelApples.length}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // 5. Worm Length Consistency Check
    const initialWormLength = session.initialState?.worm?.length || level.wormStart?.initialLength || 2;
    const expectedWormLength = initialWormLength + authoritativeGrowth;
    if (wormState.length !== expectedWormLength) {
      const error = new Error(
        `Worm length (${wormState.length}) does not match expected length (${expectedWormLength}) based on initial length (${initialWormLength}) and growth contribution (${authoritativeGrowth}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // 6. Movement budget and reachability for newly eaten apples
    const newlyEatenApples = prevRemainingApples.filter(
      (pa) => !normalizedApplesRemaining.some((ra) => ra.x === pa.x && ra.y === pa.y)
    );
    const moveDelta = movesTaken - Math.max(0, currentMoves);
    if (newlyEatenApples.length > moveDelta) {
      const error = new Error(
        `Cannot consume ${newlyEatenApples.length} apple(s) in ${moveDelta} move(s).`
      );
      error.statusCode = 400;
      throw error;
    }

    if (moveDelta === 1 && newlyEatenApples.length === 1) {
      const head = wormState[0];
      const eaten = newlyEatenApples[0];
      if (head.x !== eaten.x || head.y !== eaten.y) {
        const error = new Error(
          `Worm head at (${head.x}, ${head.y}) did not visit apple at (${eaten.x}, ${eaten.y}) on collection move.`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (newlyEatenApples.length > 0) {
      const prevHead = prevCp?.wormState?.[0] || session.initialState?.worm?.[0] || { x: level.wormStart?.x ?? 2, y: level.wormStart?.y ?? 2 };
      for (const eaten of newlyEatenApples) {
        const distFromPrev = Math.abs(eaten.x - prevHead.x) + Math.abs(eaten.y - prevHead.y);
        if (distFromPrev > moveDelta) {
          const error = new Error(
            `Apple at (${eaten.x}, ${eaten.y}) cannot be reached from previous position (${prevHead.x}, ${prevHead.y}) in ${moveDelta} move(s) (distance: ${distFromPrev}).`
          );
          error.statusCode = 400;
          throw error;
        }
      }
    }

    if (session.checkpoint) {
      session.checkpointHistory.push(session.checkpoint);
      if (session.checkpointHistory.length > MAX_CHECKPOINT_HISTORY) {
        session.checkpointHistory = session.checkpointHistory.slice(-MAX_CHECKPOINT_HISTORY);
      }
    }

    // Authoritative checkpoint score calculation including Golden Apple bonus (+50) and Mystery bonus score
    const baseAppleScore = (authoritativeApplesEaten * 100) + (authoritativeGoldenEaten * 50) + mysteryScoreBonus;
    const authoritativeCheckpointScore = baseAppleScore;

    const nextIndex = (session.checkpoint?.checkpointIndex || 0) + 1;
    const newCheckpoint = {
      checkpointIndex: nextIndex,
      wormState: wormState.map((s) => ({ x: s.x, y: s.y })),
      direction,
      movesTaken,
      applesEaten: authoritativeApplesEaten,
      goldenApplesEaten: authoritativeGoldenEaten,
      megaApplesEaten: authoritativeMegaEaten,
      timeApplesEaten: authoritativeTimeEaten,
      mysteryApplesEaten: authoritativeMysteryEaten,
      mysteryEffectsApplied: resolvedAppliedEffects,
      currentScore: authoritativeCheckpointScore,
      applesRemaining: normalizedApplesRemaining,
      keysRemaining: (keysRemaining || []).map((k) => ({ x: k.x, y: k.y, keyId: k.keyId || 'default' })),
      stones: stones.map((s) => ({ x: s.x, y: s.y })),
      collectedKeys: Array.isArray(collectedKeys) ? collectedKeys : Array.from(collectedKeys),
      filledPits: Array.isArray(filledPits) ? filledPits : Array.from(filledPits),
      savedAt: new Date(),
    };

    session.checkpoint = newCheckpoint;
    session.moves = movesTaken;
    session.score = authoritativeCheckpointScore;
    session.applesCollected = newCheckpoint.applesEaten;
    session.goldenApplesCollected = authoritativeGoldenEaten;
    session.megaApplesCollected = authoritativeMegaEaten;
    session.timeApplesCollected = authoritativeTimeEaten;
    session.mysteryApplesCollected = authoritativeMysteryEaten;

    await session.save();

    return {
      success: true,
      deduplicated: false,
      moves: session.moves,
      historyLength: session.checkpointHistory.length,
      checkpoint: session.checkpoint,
    };
  },

  async applyUndo(sessionId, userId, idempotencyKey) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      idempotencyKey = sessionId.idempotencyKey;
      sessionId = sessionId.sessionId;
    }

    if (!sessionId || !userId || !idempotencyKey) {
      const err = new Error('Session ID, User ID, and idempotency key are required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanKey = String(idempotencyKey).trim();
    const session = await this.getSessionById(sessionId, userId);

    const existing = session.appliedUndos?.find((u) => u.idempotencyKey === cleanKey);
    if (existing) {
      return {
        success: true,
        isDuplicate: true,
        restoredCheckpoint: existing.restoredCheckpoint,
        moves: existing.restoredMoves,
        extraMovesAllowed: session.extraMovesAllowed,
        undosUsed: session.undosUsed,
      };
    }

    const recoverableFailureReasons = [
      'SELF_COLLISION',
      'CRUSHED',
      'HIT_SPIKE',
      'FALLEN_OFF_GRID',
      'OUT_OF_MOVES',
      'TRAPPED',
    ];

    const isRecoverableFailed =
      session.status === 'FAILED' &&
      recoverableFailureReasons.includes(session.failureReason) &&
      !session.rewardClaimed &&
      !session.rewardTransactionId;

    if (session.status !== 'ACTIVE' && !isRecoverableFailed) {
      const err = new Error(`Cannot undo on a session that is ${session.status.toLowerCase()}.`);
      err.statusCode = 400;
      throw err;
    }

    const hasRecoverableCheckpoint =
      isRecoverableFailed &&
      session.checkpoint &&
      session.moves > (session.checkpoint.movesTaken ?? -1);

    if (
      !hasRecoverableCheckpoint &&
      (!session.checkpointHistory || session.checkpointHistory.length === 0 || session.moves === 0)
    ) {
      const err = new Error('No previous checkpoint exists to undo.');
      err.statusCode = 400;
      throw err;
    }

    const inventoryKey = `undo_${sessionId}_${cleanKey}`;
    const consumeRes = await inventoryService.consumeItem({
      userId,
      itemType: 'UNDO',
      idempotencyKey: inventoryKey,
      sessionId,
    });

    const freshSession = await GameSession.findById(sessionId);
    const raceCheck = freshSession.appliedUndos?.find((u) => u.idempotencyKey === cleanKey);
    if (raceCheck) {
      return {
        success: true,
        isDuplicate: true,
        restoredCheckpoint: raceCheck.restoredCheckpoint,
        moves: raceCheck.restoredMoves,
        extraMovesAllowed: freshSession.extraMovesAllowed,
        undosUsed: freshSession.undosUsed,
        status: freshSession.status,
      };
    }

    let restoredCheckpoint;
    if (
      freshSession.status === 'FAILED' &&
      freshSession.checkpoint &&
      freshSession.moves > (freshSession.checkpoint.movesTaken ?? -1)
    ) {
      restoredCheckpoint = freshSession.checkpoint;
    } else {
      if (!freshSession.checkpointHistory || freshSession.checkpointHistory.length === 0) {
        const err = new Error('No previous checkpoint exists to undo.');
        err.statusCode = 400;
        throw err;
      }
      restoredCheckpoint = freshSession.checkpointHistory.pop();
      freshSession.checkpoint = restoredCheckpoint;
    }

    freshSession.status = 'ACTIVE';
    freshSession.failureReason = null;
    freshSession.endedAt = null;
    freshSession.moves = restoredCheckpoint.movesTaken;
    freshSession.score = restoredCheckpoint.currentScore;
    freshSession.applesCollected = restoredCheckpoint.applesEaten;
    freshSession.goldenApplesCollected = restoredCheckpoint.goldenApplesEaten || 0;
    freshSession.megaApplesCollected = restoredCheckpoint.megaApplesEaten || 0;
    freshSession.timeApplesCollected = restoredCheckpoint.timeApplesEaten || 0;
    freshSession.mysteryApplesCollected = restoredCheckpoint.mysteryApplesEaten || 0;
    freshSession.undosUsed = (freshSession.undosUsed || 0) + 1;

    freshSession.appliedUndos.push({
      idempotencyKey: cleanKey,
      restoredMoves: restoredCheckpoint.movesTaken,
      restoredCheckpoint,
      appliedAt: new Date(),
    });

    await freshSession.save();

    return {
      success: true,
      isDuplicate: Boolean(consumeRes.isDuplicate),
      restoredCheckpoint,
      moves: freshSession.moves,
      extraMovesAllowed: freshSession.extraMovesAllowed,
      undosUsed: freshSession.undosUsed,
      status: freshSession.status,
    };
  },

  async applyBooster(sessionId, userId, boosterType, idempotencyKey) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      boosterType = sessionId.boosterType;
      idempotencyKey = sessionId.idempotencyKey;
      sessionId = sessionId.sessionId;
    }

    if (!sessionId || !userId || !boosterType || !idempotencyKey) {
      const err = new Error('Session ID, User ID, Booster Type, and idempotency key are required.');
      err.statusCode = 400;
      throw err;
    }

    if (boosterType !== 'EXTRA_MOVES') {
      const err = new Error(`Unsupported booster type: ${boosterType}. Only EXTRA_MOVES is supported.`);
      err.statusCode = 400;
      throw err;
    }

    const cleanKey = String(idempotencyKey).trim();
    const session = await this.getSessionById(sessionId, userId);

    const existing = session.appliedBoosters?.find((b) => b.idempotencyKey === cleanKey);
    if (existing) {
      return {
        success: true,
        isDuplicate: true,
        extraMovesAdded: existing.movesAdded,
        totalExtraMovesAllowed: session.extraMovesAllowed,
        boostersUsed: session.boostersUsed,
      };
    }

    if (session.status !== 'ACTIVE') {
      const err = new Error(`Cannot apply booster to a session that is ${session.status.toLowerCase()}.`);
      err.statusCode = 400;
      throw err;
    }

    const inventoryKey = `booster_${sessionId}_${cleanKey}`;
    const consumeRes = await inventoryService.consumeItem({
      userId,
      itemType: 'BOOSTER',
      idempotencyKey: inventoryKey,
      sessionId,
    });

    const economy = await EconomyConfig.getActiveConfig();
    const movesToAdd = economy?.rules?.boosterExtraMoves || economy?.boosterExtraMoves || 5;

    const updatedSession = await GameSession.findOneAndUpdate(
      {
        _id: sessionId,
        userId,
        'appliedBoosters.idempotencyKey': { $ne: cleanKey },
      },
      {
        $inc: {
          extraMovesAllowed: movesToAdd,
          boostersUsed: 1,
        },
        $push: {
          appliedBoosters: {
            idempotencyKey: cleanKey,
            boosterType: 'EXTRA_MOVES',
            movesAdded: movesToAdd,
            appliedAt: new Date(),
          },
        },
      },
      { returnDocument: 'after', runValidators: true }
    );

    if (updatedSession) {
      return {
        success: true,
        isDuplicate: Boolean(consumeRes.isDuplicate),
        extraMovesAdded: movesToAdd,
        totalExtraMovesAllowed: updatedSession.extraMovesAllowed,
        boostersUsed: updatedSession.boostersUsed,
      };
    }

    const reloaded = await GameSession.findById(sessionId);
    const recorded = reloaded.appliedBoosters.find((b) => b.idempotencyKey === cleanKey);
    return {
      success: true,
      isDuplicate: true,
      extraMovesAdded: recorded ? recorded.movesAdded : movesToAdd,
      totalExtraMovesAllowed: reloaded.extraMovesAllowed,
      boostersUsed: reloaded.boostersUsed,
    };
  },

  async requestHint(sessionId, userId, idempotencyKey) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      idempotencyKey = sessionId.idempotencyKey;
      sessionId = sessionId.sessionId;
    }

    if (!sessionId || !userId || !idempotencyKey) {
      const err = new Error('Session ID, User ID, and idempotency key are required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanKey = String(idempotencyKey).trim();
    const session = await this.getSessionById(sessionId, userId);

    const existing = session.appliedHints?.find((h) => h.idempotencyKey === cleanKey);
    if (existing) {
      return {
        success: true,
        isDuplicate: true,
        solutionMoves: existing.solutionMoves,
        hintsUsed: session.hintsUsed,
      };
    }

    if (session.status !== 'ACTIVE') {
      const err = new Error(`Cannot request hint on a session that is ${session.status.toLowerCase()}.`);
      err.statusCode = 400;
      throw err;
    }

    const inventoryKey = `hint_${sessionId}_${cleanKey}`;
    const consumeRes = await inventoryService.consumeItem({
      userId,
      itemType: 'HINT',
      idempotencyKey: inventoryKey,
      sessionId,
    });

    const level = await Level.findById(session.levelId);
    let moves = [];
    if (level && level.solution && level.solution.length > 0) {
      const stepIdx = session.moves % level.solution.length;
      moves = level.solution.slice(stepIdx, stepIdx + 3);
    }
    if (!moves || moves.length === 0) {
      const head = session.checkpoint?.wormState?.[0] || { x: 1, y: 1 };
      const target = session.checkpoint?.applesRemaining?.[0] || level?.portal || { x: head.x + 1, y: head.y };
      const dx = target.x - head.x;
      const dy = target.y - head.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        moves = [dx >= 0 ? 'RIGHT' : 'LEFT'];
      } else {
        moves = [dy >= 0 ? 'DOWN' : 'UP'];
      }
    }

    session.hintsUsed = (session.hintsUsed || 0) + 1;
    session.appliedHints.push({
      idempotencyKey: cleanKey,
      hintType: 'NEXT_MOVES',
      solutionMoves: moves,
      appliedAt: new Date(),
    });

    await session.save();

    return {
      success: true,
      isDuplicate: Boolean(consumeRes.isDuplicate),
      solutionMoves: moves,
      hintsUsed: session.hintsUsed,
    };
  },

  async completeSession(sessionId, userId, completionData) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      completionData = sessionId.completionData || sessionId;
      sessionId = sessionId.sessionId;
    }

    const session = await this.getSessionById(sessionId, userId);

    if (session.status === 'COMPLETED') {
      let progress = await this.getOrCreatePlayerProgress(userId);

      // Only perform campaign level progression reconciliation for non-daily-challenge sessions.
      // Daily Challenge sessions must NEVER unlock or advance normal campaign levels.
      if (!session.isDailyChallenge) {
        // Recovery check: Inspect whether PlayerProgress has recorded this completed level
        const existingLevelRecord = progress.completedLevels.find(
          (rec) => rec.levelNumber === session.levelNumber
        );

        const sessionStars = session.starsEarned || 1;
        const sessionScore = session.score || 0;
        const sessionMoves = session.moves || 0;
        const sessionDuration = session.durationSeconds || 1;
        const sessionGoldenApples = session.goldenApplesCollected || session.rewardBreakdown?.goldenApplesCount || 0;
        const sessionMegaApples = session.megaApplesCollected || session.rewardBreakdown?.megaApplesCount || 0;
        const sessionTimeApples = session.timeApplesCollected || session.rewardBreakdown?.timeApplesCount || 0;
        const sessionMysteryApples = session.mysteryApplesCollected || session.rewardBreakdown?.mysteryApplesCount || 0;
        const nextLevel = Math.max(1, session.levelNumber + 1);

        let needsReconciliation = false;
        if (!existingLevelRecord) {
          needsReconciliation = true;
        } else if (
          (existingLevelRecord.goldenApplesClaimed || 0) < sessionGoldenApples ||
          (existingLevelRecord.megaApplesClaimed || 0) < sessionMegaApples ||
          (existingLevelRecord.timeApplesClaimed || 0) < sessionTimeApples ||
          (existingLevelRecord.mysteryApplesClaimed || 0) < sessionMysteryApples ||
          (existingLevelRecord.stars || 0) < sessionStars ||
          (existingLevelRecord.highScore || 0) < sessionScore
        ) {
          needsReconciliation = true;
        }

        if (needsReconciliation) {
          // Atomic update path if level record exists
          let reconciledProgress = await PlayerProgress.findOneAndUpdate(
            { userId, 'completedLevels.levelNumber': session.levelNumber },
            {
              $max: {
                'completedLevels.$.stars': sessionStars,
                'completedLevels.$.highScore': sessionScore,
                'completedLevels.$.goldenApplesClaimed': sessionGoldenApples,
                'completedLevels.$.megaApplesClaimed': sessionMegaApples,
                'completedLevels.$.timeApplesClaimed': sessionTimeApples,
                'completedLevels.$.mysteryApplesClaimed': sessionMysteryApples,
                highestUnlockedLevel: nextLevel,
                currentLevel: nextLevel,
              },
              $min: {
                'completedLevels.$.leastMoves': sessionMoves,
                'completedLevels.$.fastestTimeSeconds': sessionDuration,
              },
              $set: {
                lastPlayedAt: new Date(),
              },
            },
            { returnDocument: 'after', runValidators: true }
          );

          // Atomic push with $ne check if level record does not exist
          if (!reconciledProgress) {
            reconciledProgress = await PlayerProgress.findOneAndUpdate(
              { userId, 'completedLevels.levelNumber': { $ne: session.levelNumber } },
              {
                $push: {
                  completedLevels: {
                    levelNumber: session.levelNumber,
                    stars: sessionStars,
                    highScore: sessionScore,
                    leastMoves: sessionMoves,
                    fastestTimeSeconds: sessionDuration,
                    goldenApplesClaimed: sessionGoldenApples,
                    megaApplesClaimed: sessionMegaApples,
                    timeApplesClaimed: sessionTimeApples,
                    mysteryApplesClaimed: sessionMysteryApples,
                    attemptsCount: 1,
                    firstCompletedAt: session.endedAt || new Date(),
                    lastCompletedAt: session.endedAt || new Date(),
                  },
                },
                $max: {
                  highestUnlockedLevel: nextLevel,
                  currentLevel: nextLevel,
                },
                $set: {
                  lastPlayedAt: new Date(),
                },
              },
              { returnDocument: 'after', runValidators: true }
            );
          }

          if (reconciledProgress) {
            const totalStars = reconciledProgress.completedLevels.reduce((sum, r) => sum + (r.stars || 0), 0);
            const totalScore = reconciledProgress.completedLevels.reduce((sum, r) => sum + (r.highScore || 0), 0);
            await PlayerProgress.findByIdAndUpdate(reconciledProgress._id, {
              $set: {
                totalStars,
                totalScore,
              },
            });
            reconciledProgress.totalStars = totalStars;
            reconciledProgress.totalScore = totalScore;
            progress = reconciledProgress;

            await User.findByIdAndUpdate(userId, {
              $set: {
                currentLevel: reconciledProgress.currentLevel,
                totalScore: reconciledProgress.totalScore,
                totalStars: reconciledProgress.totalStars,
              },
              $addToSet: {
                completedLevels: session.levelNumber,
              },
            });
          }
        }
      }

      let existingDailyStreak = null;
      if (session.isDailyChallenge && !completionData?._skipDailyChallengeSync) {
        try {
          const { default: dailyChallengeService } = await import('./dailyChallengeService.js');
          const dcInfo = await dailyChallengeService.syncDailyChallengeCompletion(
            userId,
            session,
            { score: session.score, moves: session.moves, durationSeconds: session.durationSeconds }
          );
          existingDailyStreak = dcInfo?.streak;
        } catch (e) {
          // ignore duplicate sync error
        }
      }

      // Authoritatively synchronize lifetime apples projection on completed-session duplicate recovery
      await this.syncPlayerApples(userId);
      await this.syncPlayerSpecialApples(userId);

      const wallet = await walletService.getOrCreateWallet(userId);
      return {
        session,
        isDuplicate: true,
        message: 'Level session already completed and confirmed on server.',
        rewards: {
          stars: session.starsEarned,
          coins: session.coinsEarned,
          score: session.score,
          goldenApples: session.rewardBreakdown?.goldenApplesCount || session.goldenApplesCollected || 0,
          goldenCoins: session.rewardBreakdown?.goldenApples || 0,
          megaApples: session.rewardBreakdown?.megaApplesCount || session.megaApplesCollected || 0,
          timeApples: session.rewardBreakdown?.timeApplesCount || session.timeApplesCollected || 0,
          mysteryApples: session.rewardBreakdown?.mysteryApplesCount || session.mysteryApplesCollected || 0,
          mysteryEffects: session.mysteryEffects || [],
          dailyStreak: existingDailyStreak?.currentStreak || (session.isDailyChallenge ? 1 : undefined),
        },
        wallet: {
          balance: wallet.balance,
          transactionId: null,
        },
        streak: existingDailyStreak || null,
        unlockedLevel: progress.highestUnlockedLevel,
      };
    }

    if (session.status !== 'ACTIVE') {
      const error = new Error(`Cannot complete a session that is ${session.status}.`);
      error.statusCode = 400;
      throw error;
    }

    const level = await Level.findById(session.levelId);
    if (!level) {
      const error = new Error('Associated level definition was not found.');
      error.statusCode = 404;
      throw error;
    }

    // Synchronize final checkpoint state if provided directly in completionData
    if (completionData?.checkpoint && Array.isArray(completionData.checkpoint.wormState)) {
      session.checkpoint = {
        ...(session.checkpoint ? session.checkpoint.toObject() : {}),
        ...completionData.checkpoint,
        savedAt: new Date(),
      };
      await session.save();
    }

    // 1. Authoritative Server Checkpoint Validation
    const currentCp = session.checkpoint;
    if (!currentCp || !Array.isArray(currentCp.wormState) || currentCp.wormState.length < 2) {
      const error = new Error('Cannot complete level: No valid checkpoint found on server.');
      error.statusCode = 400;
      throw error;
    }

    const head = currentCp.wormState[0];
    const portal = level.portal;

    // 1a. Validate Worm Head Position at Exit Portal
    if (!portal || head.x !== portal.x || head.y !== portal.y) {
      const error = new Error(
        `Cannot complete level: Worm head at (${head.x}, ${head.y}) has not reached exit portal at (${portal?.x}, ${portal?.y}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // 1b. Validate Worm Does Not Overlap Impassable Obstacle or Moving Block
    for (const segment of currentCp.wormState) {
      if (collidesWithImpassableObstacle(segment, level.obstacles, currentCp.movesTaken)) {
        const error = new Error(
          `Cannot complete level: Worm segment (${segment.x}, ${segment.y}) overlaps an impassable obstacle.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    // 1c. Validate Level Objectives & Worm Growth against server checkpoint
    const objective = level.objective || 'eat_all_apples';
    const totalKeys = (level.keys || []).length;
    const collectedKeys = currentCp.collectedKeys || [];

    // Authoritative Golden & Normal Apple Detection from level definition vs verified remaining apples
    const levelApples = level.apples || [];
    const remainingApples = currentCp.applesRemaining || [];
    const eatenApples = levelApples.filter(
      (la) => !remainingApples.some((ra) => ra.x === la.x && ra.y === la.y)
    );
    const authoritativeApplesEaten = eatenApples.length;
    const authoritativeGoldenEaten = eatenApples.filter((a) => (a.type || 'normal') === 'golden').length;
    const authoritativeMegaEaten = eatenApples.filter((a) => (a.type || 'normal') === 'mega').length;
    const authoritativeTimeEaten = eatenApples.filter((a) => (a.type || 'normal') === 'time').length;
    const authoritativeMysteryApples = eatenApples.filter((a) => (a.type || 'normal') === 'mystery');
    const authoritativeMysteryEaten = authoritativeMysteryApples.length;

    // Movement allowance verification (including Time Apple bonus moves and Mystery extra moves)
    const economy = await EconomyConfig.getActiveConfig();
    const timeAppleBonusMoves = level.timeAppleBonusMoves ?? economy?.rules?.timeAppleExtraMoves ?? 5;
    const mysteryConfig = economy?.rules?.mysteryAppleConfig || {};
    const sessionMysteryEffects = session.mysteryEffects || [];

    const resolvedAppliedEffects = [];
    let mysteryScoreBonus = 0;
    let mysteryExtraMoves = 0;
    let mysteryExtraGrowth = 0;

    for (const apple of authoritativeMysteryApples) {
      let effect = sessionMysteryEffects.find((e) => e.x === apple.x && e.y === apple.y);
      if (!effect) {
        if (apple.mysteryEffect && apple.mysteryEffect.type) {
          effect = {
            x: apple.x,
            y: apple.y,
            type: apple.mysteryEffect.type,
            value: Number(apple.mysteryEffect.value) || 0,
          };
        } else {
          effect = resolveMysteryEffect(session._id.toString(), apple.x, apple.y, mysteryConfig);
        }
        session.mysteryEffects.push(effect);
      }
      resolvedAppliedEffects.push({
        x: effect.x,
        y: effect.y,
        type: effect.type,
        value: effect.value,
      });

      if (effect.type === 'BONUS_SCORE') {
        mysteryScoreBonus += effect.value;
      } else if (effect.type === 'EXTRA_MOVES') {
        mysteryExtraMoves += effect.value;
      } else if (effect.type === 'EXTRA_GROWTH') {
        mysteryExtraGrowth += effect.value;
      }
    }

    // Each normal/golden/time apple contributes 1 segment (+1); each mega apple contributes 2 segments (+2);
    // mystery apple contributes 1 segment or +2 if EXTRA_GROWTH effect is resolved:
    const authoritativeGrowth = authoritativeApplesEaten + authoritativeMegaEaten + mysteryExtraGrowth;
    const totalApples = levelApples.length;

    // Validate Worm Length against Authoritative Apples Eaten and Growth Contribution
    const initialWormLength = session.initialState?.worm?.length || level.wormStart?.initialLength || 2;
    const expectedWormLength = initialWormLength + authoritativeGrowth;
    if (currentCp.wormState.length !== expectedWormLength) {
      const error = new Error(
        `Cannot complete level: Final worm length (${currentCp.wormState.length}) does not match expected length (${expectedWormLength}) based on initial length (${initialWormLength}) and growth contribution (${authoritativeGrowth}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // 1c. Authoritative Move Limit Verification
    const authoritativeMoves = currentCp.movesTaken;
    const baseMoveLimit =
      level.targetValue !== null && level.targetValue !== undefined && objective === 'limited_moves'
        ? level.targetValue
        : level.moveLimit || 50;
    const allowedMoves =
      baseMoveLimit +
      (session.extraMovesAllowed || 0) +
      (authoritativeTimeEaten * timeAppleBonusMoves) +
      mysteryExtraMoves;
    if (authoritativeMoves > allowedMoves) {
      const error = new Error(
        `Cannot complete level: Authoritative moves (${authoritativeMoves}) exceeds allowed limit (${allowedMoves}).`
      );
      error.statusCode = 400;
      throw error;
    }

    if (objective === 'eat_all_apples') {
      if (remainingApples.length > 0 || (totalApples > 0 && authoritativeApplesEaten < totalApples)) {
        const error = new Error(
          `Cannot complete level: Not all apples have been eaten (${remainingApples.length} remaining).`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (objective === 'collect_keys') {
      const requiredKeys = level.targetValue !== null && level.targetValue !== undefined ? level.targetValue : totalKeys;
      if (collectedKeys.length < requiredKeys) {
        const error = new Error(
          `Cannot complete level: Required keys not collected (${collectedKeys.length}/${requiredKeys}).`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (objective === 'collect_apple_count') {
      const requiredApples = level.targetValue !== null && level.targetValue !== undefined ? level.targetValue : 1;
      if (authoritativeApplesEaten < requiredApples) {
        const error = new Error(
          `Cannot complete level: Required apple count not met (${authoritativeApplesEaten}/${requiredApples}).`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (objective === 'reach_length') {
      const requiredLen = level.targetValue !== null && level.targetValue !== undefined ? level.targetValue : 3;
      if (currentCp.wormState.length < requiredLen) {
        const error = new Error(
          `Cannot complete level: Worm length requirement not met (${currentCp.wormState.length}/${requiredLen}).`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (objective === 'reach_portal') {
      // Reaching the exit portal satisfies the objective (worm head at portal verified in 1a).
      // Optional apples on the board are not required to be collected.
    } else if (objective === 'limited_moves') {
      // Reaching the portal within the allowed moves budget satisfies the objective.
      // Move budget verification is authoritatively enforced (authoritativeMoves <= allowedMoves).
      // Optional apples on the board are not required to be collected.
    } else if (objective === 'perfect_route') {
      const threeStarLimit = level.starThresholds?.threeStars ?? level.starThresholds?.threeStar;
      if (typeof threeStarLimit === 'number' && Number.isFinite(threeStarLimit)) {
        if (authoritativeMoves > threeStarLimit) {
          const error = new Error(
            `Cannot complete level: Authoritative moves (${authoritativeMoves}) exceeds perfect route threshold (${threeStarLimit}).`
          );
          error.statusCode = 400;
          throw error;
        }
      } else {
        const error = new Error(
          'Cannot complete level: Level is missing required threeStars threshold for perfect_route objective.'
        );
        error.statusCode = 400;
        throw error;
      }
      // Optional apples on the board are not required to be collected.
    } else {
      if (totalApples > 0 && (remainingApples.length > 0 || authoritativeApplesEaten < totalApples)) {
        const error = new Error('Cannot complete level: Apples remain uncollected.');
        error.statusCode = 400;
        throw error;
      }
    }

    // 2. Authoritative Stars Calculation from verified moves
    let calculatedStars = 1;
    if (level.starThresholds) {
      const threeStarLimit = level.starThresholds.threeStars ?? level.starThresholds.threeStar;
      const twoStarLimit = level.starThresholds.twoStars ?? level.starThresholds.twoStar;

      if (threeStarLimit !== undefined && authoritativeMoves <= threeStarLimit) {
        calculatedStars = 3;
      } else if (twoStarLimit !== undefined && authoritativeMoves <= twoStarLimit) {
        calculatedStars = 2;
      } else {
        calculatedStars = 1;
      }
    }

    // 3. Server-Authoritative Duration Calculation (Never trusts client-submitted duration)
    const now = new Date();
    const nowTime = now.getTime();
    const MAX_CLOCK_SKEW_TOLERANCE_MS = 2000; // 2 seconds tolerance

    let effectiveStartTime = session.startedAt instanceof Date
      ? session.startedAt.getTime()
      : typeof session.startedAt === 'string'
      ? new Date(session.startedAt).getTime()
      : NaN;

    // Fallback to immutable server creation timestamp if startedAt is missing or invalid
    if (isNaN(effectiveStartTime) || effectiveStartTime <= 0) {
      if (session.createdAt instanceof Date && !isNaN(session.createdAt.getTime())) {
        effectiveStartTime = session.createdAt.getTime();
      } else if (session._id && typeof session._id.getTimestamp === 'function') {
        const idTime = session._id.getTimestamp();
        if (idTime instanceof Date && !isNaN(idTime.getTime())) {
          effectiveStartTime = idTime.getTime();
        }
      }
    }

    // Strictly reject completion if no valid server-generated timestamp could be resolved
    if (isNaN(effectiveStartTime) || effectiveStartTime <= 0) {
      const error = new Error('Cannot complete session: Invalid or missing server session start timestamp.');
      error.statusCode = 400;
      throw error;
    }

    // Strictly reject completion if the start timestamp is in the future beyond acceptable clock-skew tolerance
    if (effectiveStartTime > nowTime + MAX_CLOCK_SKEW_TOLERANCE_MS) {
      const error = new Error(
        `Cannot complete session: Session start timestamp (${new Date(effectiveStartTime).toISOString()}) is in the future relative to server time (${now.toISOString()}).`
      );
      error.statusCode = 400;
      throw error;
    }

    const elapsedMs = Math.max(0, nowTime - effectiveStartTime);
    const authoritativeDurationSeconds = Math.max(1, Math.round(elapsedMs / 1000));

    // 4. Economy Configuration & Milestone-Based Reward Assessment
    const configBaseCompletion = economy?.rules?.levelCompletionBase ?? 25;
    const configThreeStarBonus = economy?.rules?.threeStarBonus ?? 20;
    const configTwoStarBonus = economy?.rules?.twoStarBonus ?? 10;
    const configOneStarBonus = economy?.rules?.oneStarBonus ?? 5;
    const configGoldenAppleReward = economy?.rules?.goldenAppleReward ?? 10;

    const getStarBonusForTier = (tier) => {
      if (tier === 3) return configThreeStarBonus;
      if (tier === 2) return configTwoStarBonus;
      if (tier === 1) return configOneStarBonus;
      return 0;
    };

    const initialProgress = await this.getOrCreatePlayerProgress(userId);
    const existingIdx = initialProgress.completedLevels.findIndex((rec) => rec.levelNumber === level.levelNumber);
    const isFirstClear = existingIdx === -1;
    const previousBestStars = isFirstClear ? 0 : (initialProgress.completedLevels[existingIdx].stars || 0);
    const previousGoldenClaimed = isFirstClear ? 0 : (initialProgress.completedLevels[existingIdx].goldenApplesClaimed || 0);

    let baseCoinsToAward = 0;
    let starCoinsToAward = 0;
    let goldenCoinsToAward = 0;

    // Daily Challenge sessions only receive daily challenge rewards (handled via dailyChallengeService),
    // NEVER standard campaign level rewards, to preserve campaign progression and avoid duplicate claims.
    if (!session.isDailyChallenge) {
      if (isFirstClear) {
        baseCoinsToAward = configBaseCompletion;
        starCoinsToAward = getStarBonusForTier(calculatedStars);
      } else {
        // Replay: Base reward is never awarded again
        baseCoinsToAward = 0;
        if (calculatedStars > previousBestStars) {
          const previousBonus = getStarBonusForTier(previousBestStars);
          const newBonus = getStarBonusForTier(calculatedStars);
          starCoinsToAward = Math.max(0, newBonus - previousBonus);
        } else {
          starCoinsToAward = 0;
        }
      }

      // Golden Apple Coins (Anti-Farming: Awarded only once per collected golden apple per level)
      let newGoldenToAwardCount = 0;
      if (authoritativeGoldenEaten > previousGoldenClaimed) {
        newGoldenToAwardCount = authoritativeGoldenEaten - previousGoldenClaimed;
        goldenCoinsToAward = newGoldenToAwardCount * configGoldenAppleReward;
      } else {
        goldenCoinsToAward = 0;
      }
    }

    const authoritativeCoins = baseCoinsToAward + starCoinsToAward + goldenCoinsToAward;

    // Server-Authoritative Score Calculation (Never trusts arbitrary client spoofed scores)
    const baseAppleScore = (authoritativeApplesEaten * 100) + (authoritativeGoldenEaten * 50) + mysteryScoreBonus;
    const authoritativeScore = baseAppleScore + calculatedStars * 500 + Math.max(0, (allowedMoves - authoritativeMoves) * 10);

    // 5. Atomic single-document transition to COMPLETED
    const updatedSession = await GameSession.findOneAndUpdate(
      { _id: sessionId, userId, status: 'ACTIVE' },
      {
        $set: {
          status: 'COMPLETED',
          endedAt: now,
          durationSeconds: authoritativeDurationSeconds,
          moves: authoritativeMoves,
          score: authoritativeScore,
          applesCollected: authoritativeApplesEaten,
          goldenApplesCollected: authoritativeGoldenEaten,
          megaApplesCollected: authoritativeMegaEaten,
          timeApplesCollected: authoritativeTimeEaten,
          mysteryApplesCollected: authoritativeMysteryEaten,
          starsEarned: calculatedStars,
          coinsEarned: 0,
          rewardClaimed: true,
          rewardBreakdown: {
            baseCompletion: 0,
            starBonus: 0,
            goldenApples: 0,
            goldenApplesCount: authoritativeGoldenEaten,
            megaApplesCount: authoritativeMegaEaten,
            timeApplesCount: authoritativeTimeEaten,
            mysteryApplesCount: authoritativeMysteryEaten,
            totalCoins: 0,
          },
        },
      },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updatedSession) {
      const error = new Error('Session completion conflict or session is no longer active.');
      error.statusCode = 409;
      throw error;
    }

    // 6. Credit coins via WalletService with deterministic, milestone-specific idempotency keys
    let latestWallet = null;
    let primaryTxId = null;
    let actualBaseCredited = 0;
    let actualStarCredited = 0;
    let actualGoldenCoinsCredited = 0;
    let actualCreditedTotal = 0;

    // 6a. Base completion reward (awarded at most once per user and level)
    if (baseCoinsToAward > 0) {
      const baseKey = `level_base_${userId}_level_${level.levelNumber}`;
      try {
        const baseCredit = await walletService.credit(userId, baseCoinsToAward, {
          type: 'LEVEL_REWARD',
          referenceId: session._id.toString(),
          idempotencyKey: baseKey,
          description: `Completed Level ${level.levelNumber} base reward`,
          metadata: {
            levelNumber: level.levelNumber,
            sessionId: session._id.toString(),
            stars: calculatedStars,
            moves: authoritativeMoves,
            rewardType: 'BASE_COMPLETION',
          },
        });
        latestWallet = baseCredit.wallet;
        primaryTxId = baseCredit.transaction?._id;
        if (!baseCredit.isDuplicate) {
          actualBaseCredited = baseCoinsToAward;
          actualCreditedTotal += baseCoinsToAward;
        }
      } catch (baseErr) {
        if (baseErr.statusCode === 409 || baseErr.code === 11000) {
          console.warn(`Base completion reward already claimed for user ${userId} level ${level.levelNumber}`);
        } else {
          throw baseErr;
        }
      }
    }

    // 6b. Star bonus milestone (awarded at most once per user, level, and achieved tier)
    if (starCoinsToAward > 0) {
      const starKey = `level_star_${userId}_level_${level.levelNumber}_tier_${calculatedStars}`;
      try {
        const starCredit = await walletService.credit(userId, starCoinsToAward, {
          type: 'STAR_BONUS',
          referenceId: session._id.toString(),
          idempotencyKey: starKey,
          description: isFirstClear
            ? `Star bonus for Level ${level.levelNumber} (${calculatedStars} stars)`
            : `Star bonus upgrade for Level ${level.levelNumber} (${previousBestStars} -> ${calculatedStars} stars)`,
          metadata: {
            levelNumber: level.levelNumber,
            sessionId: session._id.toString(),
            stars: calculatedStars,
            previousStars: previousBestStars,
            rewardType: 'STAR_BONUS',
          },
        });
        latestWallet = starCredit.wallet;
        if (!primaryTxId) primaryTxId = starCredit.transaction?._id;
        if (!starCredit.isDuplicate) {
          actualStarCredited = starCoinsToAward;
          actualCreditedTotal += starCoinsToAward;
        }
      } catch (starErr) {
        if (starErr.statusCode === 409 || starErr.code === 11000) {
          console.warn(`Star bonus already claimed for user ${userId} level ${level.levelNumber} tier ${calculatedStars}`);
        } else {
          throw starErr;
        }
      }
    }

    // 6c. Golden Apple reward milestones (awarded at most once per individual apple ordinal)
    if (authoritativeGoldenEaten > previousGoldenClaimed) {
      for (let appleOrdinal = previousGoldenClaimed + 1; appleOrdinal <= authoritativeGoldenEaten; appleOrdinal++) {
        const goldenKey = `level_golden_${userId}_level_${level.levelNumber}_apple_${appleOrdinal}`;
        try {
          const goldenCredit = await walletService.credit(userId, configGoldenAppleReward, {
            type: 'GOLDEN_APPLE_REWARD',
            referenceId: session._id.toString(),
            idempotencyKey: goldenKey,
            description: `Golden apple reward for Level ${level.levelNumber} (apple #${appleOrdinal})`,
            metadata: {
              levelNumber: level.levelNumber,
              sessionId: session._id.toString(),
              appleOrdinal,
              rewardType: 'GOLDEN_APPLE_REWARD',
            },
          });
          latestWallet = goldenCredit.wallet;
          if (!primaryTxId) primaryTxId = goldenCredit.transaction?._id;
          if (!goldenCredit.isDuplicate) {
            actualGoldenCoinsCredited += configGoldenAppleReward;
            actualCreditedTotal += configGoldenAppleReward;
          }
        } catch (goldenErr) {
          if (goldenErr.statusCode === 409 || goldenErr.code === 11000) {
            console.warn(
              `Golden apple milestone #${appleOrdinal} already claimed for user ${userId} level ${level.levelNumber}`
            );
          } else {
            throw goldenErr;
          }
        }
      }
    }

    // Ensure wallet balance is loaded even if 0 coins were awarded (e.g. replay with same/lower stars)
    if (!latestWallet) {
      latestWallet = await walletService.getOrCreateWallet(userId);
    }

    // Synchronize session record with confirmed actual credited amounts
    const finalRewardBreakdown = {
      baseCompletion: actualBaseCredited,
      starBonus: actualStarCredited,
      goldenApples: actualGoldenCoinsCredited,
      goldenApplesCount: authoritativeGoldenEaten,
      megaApplesCount: authoritativeMegaEaten,
      timeApplesCount: authoritativeTimeEaten,
      mysteryApplesCount: authoritativeMysteryEaten,
      totalCoins: actualCreditedTotal,
    };

    await GameSession.findByIdAndUpdate(sessionId, {
      $set: {
        coinsEarned: actualCreditedTotal,
        megaApplesCollected: authoritativeMegaEaten,
        timeApplesCollected: authoritativeTimeEaten,
        mysteryApplesCollected: authoritativeMysteryEaten,
        rewardBreakdown: finalRewardBreakdown,
      },
    });
    updatedSession.coinsEarned = actualCreditedTotal;
    updatedSession.megaApplesCollected = authoritativeMegaEaten;
    updatedSession.timeApplesCollected = authoritativeTimeEaten;
    updatedSession.mysteryApplesCollected = authoritativeMysteryEaten;
    updatedSession.rewardBreakdown = finalRewardBreakdown;

    // 7. Update PlayerProgress atomically to prevent race conditions across concurrent sessions
    let updatedProgress = null;

    if (session.isDailyChallenge) {
      // Daily Challenge sessions MUST NOT modify normal campaign progression:
      // - Do NOT advance highestUnlockedLevel or currentLevel
      // - Do NOT push to completedLevels
      // - Cumulative apple consumption and lastPlayedAt are authoritatively recorded
      updatedProgress = await PlayerProgress.findOneAndUpdate(
        { userId },
        {
          $set: {
            lastPlayedAt: now,
          },
        },
        { returnDocument: 'after', runValidators: true }
      );

      if (!updatedProgress) {
        updatedProgress = await this.getOrCreatePlayerProgress(userId);
      }

      const syncedDailyApples = await this.syncPlayerApples(userId);
      const syncedDailySpecial = await this.syncPlayerSpecialApples(userId);
      if (updatedProgress) {
        updatedProgress.totalApplesEaten = syncedDailyApples;
        updatedProgress.totalGoldenApplesEaten = syncedDailySpecial.golden;
        updatedProgress.totalMegaApplesEaten = syncedDailySpecial.mega;
        updatedProgress.totalTimeApplesEaten = syncedDailySpecial.time;
        updatedProgress.totalMysteryApplesEaten = syncedDailySpecial.mystery;
      }
    } else {
      const nextLevel = Math.max(1, level.levelNumber + 1);

      // Try atomic update first if level is already recorded in progress
      updatedProgress = await PlayerProgress.findOneAndUpdate(
        { userId, 'completedLevels.levelNumber': level.levelNumber },
        {
          $inc: { 'completedLevels.$.attemptsCount': 1 },
          $max: {
            'completedLevels.$.stars': calculatedStars,
            'completedLevels.$.highScore': authoritativeScore,
            'completedLevels.$.goldenApplesClaimed': authoritativeGoldenEaten,
            'completedLevels.$.megaApplesClaimed': authoritativeMegaEaten,
            'completedLevels.$.timeApplesClaimed': authoritativeTimeEaten,
            'completedLevels.$.mysteryApplesClaimed': authoritativeMysteryEaten,
            highestUnlockedLevel: nextLevel,
            currentLevel: nextLevel,
          },
          $min: {
            'completedLevels.$.leastMoves': authoritativeMoves,
            'completedLevels.$.fastestTimeSeconds': authoritativeDurationSeconds,
          },
          $set: {
            'completedLevels.$.lastCompletedAt': now,
            lastPlayedAt: now,
          },
        },
        { returnDocument: 'after', runValidators: true }
      );

      // If level not yet recorded in array, atomically push with $ne check to guarantee singularity
      if (!updatedProgress) {
        updatedProgress = await PlayerProgress.findOneAndUpdate(
          { userId, 'completedLevels.levelNumber': { $ne: level.levelNumber } },
          {
            $push: {
              completedLevels: {
                levelNumber: level.levelNumber,
                stars: calculatedStars,
                highScore: authoritativeScore,
                leastMoves: authoritativeMoves,
                fastestTimeSeconds: authoritativeDurationSeconds,
                goldenApplesClaimed: authoritativeGoldenEaten,
                megaApplesClaimed: authoritativeMegaEaten,
                timeApplesClaimed: authoritativeTimeEaten,
                mysteryApplesClaimed: authoritativeMysteryEaten,
                attemptsCount: 1,
                firstCompletedAt: now,
                lastCompletedAt: now,
              },
            },
            $max: {
              highestUnlockedLevel: nextLevel,
              currentLevel: nextLevel,
            },
            $set: {
              lastPlayedAt: now,
            },
          },
          { returnDocument: 'after', runValidators: true }
        );

        // If another concurrent request pushed the level in between, retry the update path
        if (!updatedProgress) {
          updatedProgress = await PlayerProgress.findOneAndUpdate(
            { userId, 'completedLevels.levelNumber': level.levelNumber },
            {
              $inc: { 'completedLevels.$.attemptsCount': 1 },
              $max: {
                'completedLevels.$.stars': calculatedStars,
                'completedLevels.$.highScore': authoritativeScore,
                'completedLevels.$.goldenApplesClaimed': authoritativeGoldenEaten,
                'completedLevels.$.megaApplesClaimed': authoritativeMegaEaten,
                'completedLevels.$.timeApplesClaimed': authoritativeTimeEaten,
                'completedLevels.$.mysteryApplesClaimed': authoritativeMysteryEaten,
                highestUnlockedLevel: nextLevel,
                currentLevel: nextLevel,
              },
              $min: {
                'completedLevels.$.leastMoves': authoritativeMoves,
                'completedLevels.$.fastestTimeSeconds': authoritativeDurationSeconds,
              },
              $set: {
                'completedLevels.$.lastCompletedAt': now,
                lastPlayedAt: now,
              },
            },
            { returnDocument: 'after', runValidators: true }
          );
        }
      }

      // Recompute totalStars and totalScore from distinct level records
      if (updatedProgress) {
        const totalStars = updatedProgress.completedLevels.reduce((sum, r) => sum + (r.stars || 0), 0);
        const totalScore = updatedProgress.completedLevels.reduce((sum, r) => sum + (r.highScore || 0), 0);
        await PlayerProgress.findByIdAndUpdate(updatedProgress._id, {
          $set: {
            totalStars,
            totalScore,
          },
        });
        updatedProgress.totalStars = totalStars;
        updatedProgress.totalScore = totalScore;
      } else {
        updatedProgress = await this.getOrCreatePlayerProgress(userId);
      }

      const syncedCampaignApples = await this.syncPlayerApples(userId);
      const syncedCampaignSpecial = await this.syncPlayerSpecialApples(userId);
      if (updatedProgress) {
        updatedProgress.totalApplesEaten = syncedCampaignApples;
        updatedProgress.totalGoldenApplesEaten = syncedCampaignSpecial.golden;
        updatedProgress.totalMegaApplesEaten = syncedCampaignSpecial.mega;
        updatedProgress.totalTimeApplesEaten = syncedCampaignSpecial.time;
        updatedProgress.totalMysteryApplesEaten = syncedCampaignSpecial.mystery;
      }

      await User.findByIdAndUpdate(userId, {
        $set: {
          currentLevel: updatedProgress.currentLevel,
          totalScore: updatedProgress.totalScore,
          totalStars: updatedProgress.totalStars,
        },
        $addToSet: {
          completedLevels: level.levelNumber,
        },
      });
    }

    let dailyChallengeData = null;
    if (session.isDailyChallenge && !completionData?._skipDailyChallengeSync) {
      try {
        const { default: dailyChallengeService } = await import('./dailyChallengeService.js');
        dailyChallengeData = await dailyChallengeService.syncDailyChallengeCompletion(
          userId,
          updatedSession,
          {
            score: authoritativeScore,
            moves: authoritativeMoves,
            durationSeconds: authoritativeDurationSeconds,
          }
        );
      } catch (dcErr) {
        console.error('Failed to auto-sync daily challenge completion:', dcErr);
      }
    }

    return {
      session: updatedSession,
      rewards: {
        stars: calculatedStars,
        coins: actualCreditedTotal + (dailyChallengeData?.rewardCoins || 0),
        score: authoritativeScore,
        goldenApples: authoritativeGoldenEaten,
        goldenCoins: actualGoldenCoinsCredited,
        megaApples: authoritativeMegaEaten,
        timeApples: authoritativeTimeEaten,
        timeBonusMoves: authoritativeTimeEaten * timeAppleBonusMoves,
        mysteryApples: authoritativeMysteryEaten,
        mysteryEffects: resolvedAppliedEffects,
        dailyStreak: dailyChallengeData?.streak?.currentStreak || (session.isDailyChallenge ? 1 : undefined),
      },
      wallet: {
        balance: dailyChallengeData?.wallet?.balance ?? latestWallet.balance,
        transactionId: primaryTxId || null,
      },
      streak: dailyChallengeData?.streak || null,
      dailyChallenge: dailyChallengeData || null,
      unlockedLevel: updatedProgress?.highestUnlockedLevel || initialProgress?.highestUnlockedLevel,
    };
  },

  async failSession(sessionId, userId, failureData) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      failureData = sessionId.failureData || sessionId;
      sessionId = sessionId.sessionId;
    }

    const session = await this.getSessionById(sessionId, userId);
    if (session.status !== 'ACTIVE') {
      return session;
    }

    const {
      failureReason = 'OUT_OF_MOVES',
      moves = session.moves,
      durationSeconds = 0,
    } = failureData || {};

    const updatedSession = await GameSession.findOneAndUpdate(
      { _id: sessionId, userId, status: 'ACTIVE' },
      {
        $set: {
          status: 'FAILED',
          failureReason,
          moves: Math.max(0, moves),
          durationSeconds: Math.max(0, durationSeconds),
          endedAt: new Date(),
        },
      },
      { returnDocument: 'after', runValidators: true }
    );

    return updatedSession;
  },

  async abandonSession(sessionId, userId) {
    if (typeof sessionId === 'object' && sessionId !== null && sessionId.sessionId) {
      userId = sessionId.userId;
      sessionId = sessionId.sessionId;
    }

    const session = await this.getSessionById(sessionId, userId);
    if (session.status !== 'ACTIVE') {
      return session;
    }

    const updatedSession = await GameSession.findOneAndUpdate(
      { _id: sessionId, userId, status: 'ACTIVE' },
      {
        $set: {
          status: 'ABANDONED',
          failureReason: 'ABANDONED',
          endedAt: new Date(),
        },
      },
      { returnDocument: 'after', runValidators: true }
    );

    return updatedSession;
  },

  async getActiveSession(userId, levelNumber) {
    const query = { userId, status: 'ACTIVE' };
    if (levelNumber) query.levelNumber = Number(levelNumber);

    const session = await GameSession.findOne(query).sort({ updatedAt: -1 });
    return session;
  },

  async getPlayerHistory(userId, options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = { userId };
    if (options.status) query.status = options.status;
    if (options.levelNumber) query.levelNumber = parseInt(options.levelNumber, 10);

    const [sessions, total] = await Promise.all([
      GameSession.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-initialState.grid -initialState.worm')
        .lean(),
      GameSession.countDocuments(query),
    ]);

    return {
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getPlayerProgress(userId) {
    return this.getOrCreatePlayerProgress(userId);
  },

  /**
   * Synchronizes PlayerProgress.totalApplesEaten using an authoritative
   * aggregation projection of all completed GameSession documents for the user.
   * Uses MongoDB $max to guarantee monotonic progression and protect against stale writes.
   *
   * @param {string|mongoose.Types.ObjectId} userId - The user ID
   * @returns {Promise<number>} Authoritative lifetime apples count
   */
  async syncPlayerApples(userId) {
    if (!userId) return 0;
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    const aggregation = await GameSession.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: 'COMPLETED',
        },
      },
      {
        $group: {
          _id: null,
          totalApples: { $sum: '$applesCollected' },
        },
      },
    ]);

    const authoritativeTotal = aggregation[0]?.totalApples || 0;

    let updatedProgress = await PlayerProgress.findOneAndUpdate(
      { userId: userObjectId },
      { $max: { totalApplesEaten: authoritativeTotal } },
      { returnDocument: 'after' }
    );

    if (!updatedProgress) {
      await this.getOrCreatePlayerProgress(userId);
      updatedProgress = await PlayerProgress.findOneAndUpdate(
        { userId: userObjectId },
        { $max: { totalApplesEaten: authoritativeTotal } },
        { returnDocument: 'after' }
      );
    }

    return authoritativeTotal;
  },

  /**
   * Synchronizes PlayerProgress special apple lifetime statistics
   * (totalGoldenApplesEaten, totalMegaApplesEaten, totalTimeApplesEaten, totalMysteryApplesEaten)
   * using an authoritative aggregation projection of all completed GameSession documents for the user.
   * Uses MongoDB $max to guarantee monotonic progression, protect against stale concurrent writes,
   * and preserve previously earned counts.
   *
   * @param {string|mongoose.Types.ObjectId} userId - The user ID
   * @returns {Promise<{golden: number, mega: number, time: number, mystery: number}>} Authoritative special apple counts
   */
  async syncPlayerSpecialApples(userId) {
    const defaultTotals = { golden: 0, mega: 0, time: 0, mystery: 0 };
    if (!userId) return defaultTotals;
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    const aggregation = await GameSession.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: 'COMPLETED',
        },
      },
      {
        $group: {
          _id: null,
          golden: {
            $sum: {
              $cond: [
                { $gt: ['$goldenApplesCollected', 0] },
                '$goldenApplesCollected',
                { $ifNull: ['$rewardBreakdown.goldenApplesCount', 0] },
              ],
            },
          },
          mega: {
            $sum: {
              $cond: [
                { $gt: ['$megaApplesCollected', 0] },
                '$megaApplesCollected',
                { $ifNull: ['$rewardBreakdown.megaApplesCount', 0] },
              ],
            },
          },
          time: {
            $sum: {
              $cond: [
                { $gt: ['$timeApplesCollected', 0] },
                '$timeApplesCollected',
                { $ifNull: ['$rewardBreakdown.timeApplesCount', 0] },
              ],
            },
          },
          mystery: {
            $sum: {
              $cond: [
                { $gt: ['$mysteryApplesCollected', 0] },
                '$mysteryApplesCollected',
                { $ifNull: ['$rewardBreakdown.mysteryApplesCount', 0] },
              ],
            },
          },
        },
      },
    ]);

    const projectedTotals = {
      golden: aggregation[0]?.golden || 0,
      mega: aggregation[0]?.mega || 0,
      time: aggregation[0]?.time || 0,
      mystery: aggregation[0]?.mystery || 0,
    };

    let updatedProgress = await PlayerProgress.findOneAndUpdate(
      { userId: userObjectId },
      {
        $max: {
          totalGoldenApplesEaten: projectedTotals.golden,
          totalMegaApplesEaten: projectedTotals.mega,
          totalTimeApplesEaten: projectedTotals.time,
          totalMysteryApplesEaten: projectedTotals.mystery,
        },
      },
      { returnDocument: 'after' }
    );

    if (!updatedProgress) {
      await this.getOrCreatePlayerProgress(userId);
      updatedProgress = await PlayerProgress.findOneAndUpdate(
        { userId: userObjectId },
        {
          $max: {
            totalGoldenApplesEaten: projectedTotals.golden,
            totalMegaApplesEaten: projectedTotals.mega,
            totalTimeApplesEaten: projectedTotals.time,
            totalMysteryApplesEaten: projectedTotals.mystery,
          },
        },
        { returnDocument: 'after' }
      );
    }

    if (updatedProgress) {
      return {
        golden: updatedProgress.totalGoldenApplesEaten,
        mega: updatedProgress.totalMegaApplesEaten,
        time: updatedProgress.totalTimeApplesEaten,
        mystery: updatedProgress.totalMysteryApplesEaten,
      };
    }

    return projectedTotals;
  },
};

export default gameSessionService;
