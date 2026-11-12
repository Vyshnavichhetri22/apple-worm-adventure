import mongoose from 'mongoose';
import GameSession from '../models/GameSession.js';
import PlayerProgress from '../models/PlayerProgress.js';
import Level from '../models/Level.js';
import User from '../models/User.js';
import EconomyConfig from '../models/EconomyConfig.js';
import walletService from './walletService.js';

/**
 * Computes the initial contiguous worm body segments from the level's wormStart configuration.
 */
function computeInitialWormSegments(wormStart) {
  const { x, y, direction, initialLength = 2 } = wormStart;
  const segments = [{ x, y }];

  for (let i = 1; i < initialLength; i++) {
    let segX = x;
    let segY = y;

    if (direction === 'RIGHT') segX = x - i;
    else if (direction === 'LEFT') segX = x + i;
    else if (direction === 'UP') segY = y + i;
    else if (direction === 'DOWN') segY = y - i;

    segments.push({ x: segX, y: segY });
  }

  return segments;
}

/**
 * Check whether adjacent segments in a worm are connected horizontally or vertically.
 */
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

/**
 * Verify if coordinates collide with static hazards or barriers.
 */
function collidesWithImpassableObstacle(segment, obstacles) {
  if (!obstacles || obstacles.length === 0) return false;
  return obstacles.some((obs) => {
    if (obs.type === 'wall' || obs.type === 'spike' || obs.type === 'pit') {
      return obs.x === segment.x && obs.y === segment.y;
    }
    return false;
  });
}

/**
 * Service orchestrating game session progression, validation, and history.
 */
export const gameSessionService = {
  /**
   * Initializes or fetches a player's progress record.
   */
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

  /**
   * Check if a level is currently unlocked for the user.
   */
  async isLevelUnlocked(userId, levelNumber) {
    if (levelNumber === 1) return true;
    const progress = await this.getOrCreatePlayerProgress(userId);

    if (levelNumber <= progress.highestUnlockedLevel) return true;
    const hasCompletedPrior = progress.completedLevels.some(
      (rec) => rec.levelNumber === levelNumber - 1
    );
    return hasCompletedPrior;
  },

  /**
   * Start a new active game session.
   */
  async startSession(userId, levelNumber) {
    const level = await Level.findOne({ levelNumber, isActive: true });
    if (!level) {
      const error = new Error(`Level ${levelNumber} not found or is currently inactive.`);
      error.statusCode = 404;
      throw error;
    }

    const unlocked = await this.isLevelUnlocked(userId, levelNumber);
    if (!unlocked) {
      const error = new Error(
        `Level ${levelNumber} is locked. You must complete preceding levels first.`
      );
      error.statusCode = 403;
      throw error;
    }

    // Auto-abandon any stale active sessions for this player
    await GameSession.updateMany(
      { userId, status: 'ACTIVE' },
      {
        $set: {
          status: 'ABANDONED',
          endedAt: new Date(),
          failureReason: 'ABANDONED',
        },
      }
    );

    // Derive authoritative initial state using flat Level schema coordinates
    const initialWorm = computeInitialWormSegments(level.wormStart);
    const initialApples = (level.apples || []).map((app) => ({ x: app.x, y: app.y }));
    const initialKeys = (level.keys || []).map((k) => ({ x: k.x, y: k.y }));

    const session = await GameSession.create({
      userId,
      levelId: level._id,
      levelNumber: level.levelNumber,
      status: 'ACTIVE',
      startedAt: new Date(),
      extraMovesAllowed: 0,
      availableBoosters: [],
      appliedAdRewards: [],
      initialState: {
        worm: initialWorm,
        apples: initialApples,
        keys: initialKeys,
        portal: { x: level.portal.x, y: level.portal.y },
        grid: { cols: level.grid.cols, rows: level.grid.rows },
      },
      checkpoint: {
        checkpointIndex: 0,
        wormState: initialWorm,
        applesRemaining: initialApples,
        keysRemaining: initialKeys,
        movesTaken: 0,
        currentScore: 0,
        savedAt: new Date(),
      },
    });

    return session;
  },

  /**
   * Retrieve a game session ensuring ownership.
   */
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

  /**
   * Persist a server-validated intermediate checkpoint.
   */
  async saveCheckpoint(sessionId, userId, checkpointData) {
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

    const { wormState, movesTaken, currentScore, applesRemaining, keysRemaining } = checkpointData;

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

    if (typeof currentScore !== 'number' || currentScore < 0) {
      const error = new Error('Invalid currentScore value provided.');
      error.statusCode = 400;
      throw error;
    }

    // Regressive moves check against current checkpoint
    if (session.checkpoint && movesTaken < session.checkpoint.movesTaken) {
      const error = new Error(
        `movesTaken (${movesTaken}) cannot be lower than previous checkpoint (${session.checkpoint.movesTaken}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // Move limit check accounts for awarded extra moves
    const allowedMoves = level.moveLimit + (session.extraMovesAllowed || 0);
    if (movesTaken > allowedMoves) {
      const error = new Error(`movesTaken (${movesTaken}) exceeds level limit (${allowedMoves}).`);
      error.statusCode = 400;
      throw error;
    }

    // Spatial boundaries validation
    for (const segment of wormState) {
      if (
        segment.x < 0 ||
        segment.x >= level.grid.cols ||
        segment.y < 0 ||
        segment.y >= level.grid.rows
      ) {
        const error = new Error(
          `Worm segment (${segment.x}, ${segment.y}) is out of bounds [0..${level.grid.cols - 1}, 0..${level.grid.rows - 1}].`
        );
        error.statusCode = 400;
        throw error;
      }

      if (collidesWithImpassableObstacle(segment, level.obstacles)) {
        const error = new Error(
          `Worm segment (${segment.x}, ${segment.y}) overlaps an impassable obstacle.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    if (!isWormContiguous(wormState)) {
      const error = new Error('Worm segments must be contiguous (adjacent Manhattan distance of 1).');
      error.statusCode = 400;
      throw error;
    }

    const nextIndex = (session.checkpoint?.checkpointIndex || 0) + 1;
    session.checkpoint = {
      checkpointIndex: nextIndex,
      wormState: wormState.map((s) => ({ x: s.x, y: s.y })),
      applesRemaining: (applesRemaining || []).map((a) => ({ x: a.x, y: a.y })),
      keysRemaining: (keysRemaining || []).map((k) => ({ x: k.x, y: k.y })),
      movesTaken,
      currentScore,
      savedAt: new Date(),
    };
    session.moves = movesTaken;
    session.score = currentScore;

    await session.save();
    return session;
  },

  /**
   * Complete a session idempotently with server-calculated rewards and centralized economy integration.
   */
  async completeSession(sessionId, userId, completionData) {
    const session = await this.getSessionById(sessionId, userId);

    if (session.status === 'COMPLETED') {
      const error = new Error('Session is already completed.');
      error.statusCode = 400;
      throw error;
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

    const { moves, durationSeconds, applesCollected = 0 } = completionData;

    // Move limits anti-cheat accounts for extra moves awarded
    if (typeof moves !== 'number' || moves < 1) {
      const error = new Error('Invalid moves value provided.');
      error.statusCode = 400;
      throw error;
    }

    const allowedMoves = level.moveLimit + (session.extraMovesAllowed || 0);
    if (moves > allowedMoves) {
      const error = new Error(
        `Anti-cheat: Submitted moves (${moves}) exceeds level limit (${allowedMoves}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // Minimum physical execution duration verification (>= 0.1s per move)
    const minPhysicalDurationSeconds = Math.max(1, Math.floor(moves * 0.1));
    if (typeof durationSeconds !== 'number' || durationSeconds < minPhysicalDurationSeconds) {
      const error = new Error(
        `Anti-cheat: durationSeconds (${durationSeconds}) is impossibly fast for ${moves} moves.`
      );
      error.statusCode = 400;
      throw error;
    }

    // Apples upper-bound validation
    const totalApplesInLevel = level.apples?.length || 0;
    if (applesCollected < 0 || applesCollected > totalApplesInLevel) {
      const error = new Error(
        `Anti-cheat: applesCollected (${applesCollected}) cannot exceed level apples (${totalApplesInLevel}).`
      );
      error.statusCode = 400;
      throw error;
    }

    // Authoritative Stars Calculation (supports threeStars/threeStar schema naming)
    let calculatedStars = 1;
    if (level.starThresholds) {
      const threeStarLimit =
        level.starThresholds.threeStars !== undefined
          ? level.starThresholds.threeStars
          : level.starThresholds.threeStar;
      const twoStarLimit =
        level.starThresholds.twoStars !== undefined
          ? level.starThresholds.twoStars
          : level.starThresholds.twoStar;

      if (threeStarLimit !== undefined && moves <= threeStarLimit) {
        calculatedStars = 3;
      } else if (twoStarLimit !== undefined && moves <= twoStarLimit) {
        calculatedStars = 2;
      } else {
        calculatedStars = 1;
      }
    }

    // Configurable Economy Rules Integration
    const economy = await EconomyConfig.getActiveConfig();
    const baseCompletionReward = economy.rules.levelCompletionBase || 25;
    let starBonusReward = 0;
    if (calculatedStars === 3) starBonusReward = economy.rules.threeStarBonus || 20;
    else if (calculatedStars === 2) starBonusReward = economy.rules.twoStarBonus || 10;
    else starBonusReward = economy.rules.oneStarBonus || 5;

    // Check for golden apple bonuses in collected items
    const goldenAppleCount = (level.apples || []).filter((a) => a.type === 'golden').length;
    const goldenAppleReward = goldenAppleCount * (economy.rules.goldenAppleReward || 10);

    const authoritativeCoins = baseCompletionReward + starBonusReward + goldenAppleReward;
    const authoritativeScore =
      calculatedStars * 500 +
      Math.max(0, (allowedMoves - moves) * 10) +
      applesCollected * 50;

    // Atomic update to guarantee single completion
    const updatedSession = await GameSession.findOneAndUpdate(
      { _id: sessionId, userId, status: 'ACTIVE' },
      {
        $set: {
          status: 'COMPLETED',
          endedAt: new Date(),
          durationSeconds,
          moves,
          score: authoritativeScore,
          applesCollected,
          starsEarned: calculatedStars,
          coinsEarned: authoritativeCoins,
        },
      },
      { returnDocument: 'after' }
    );

    if (!updatedSession) {
      const error = new Error('Session completion conflict or session is no longer active.');
      error.statusCode = 409;
      throw error;
    }

    // Credit coins through the authoritative WalletService using the unique session ID as idempotency key
    const walletCredit = await walletService.credit(userId, authoritativeCoins, {
      type: 'LEVEL_REWARD',
      referenceId: session._id.toString(),
      idempotencyKey: `level_completion_${session._id}`,
      description: `Completed Level ${level.levelNumber} with ${calculatedStars} stars`,
      metadata: {
        levelNumber: level.levelNumber,
        sessionId: session._id.toString(),
        stars: calculatedStars,
        moves,
        durationSeconds,
      },
    });

    // Update Player Progress and synchronize with User
    const progress = await this.getOrCreatePlayerProgress(userId);
    const existingRecordIndex = progress.completedLevels.findIndex(
      (rec) => rec.levelNumber === level.levelNumber
    );

    let isFirstTimeClear = false;

    if (existingRecordIndex === -1) {
      isFirstTimeClear = true;
      progress.completedLevels.push({
        levelNumber: level.levelNumber,
        stars: calculatedStars,
        highScore: authoritativeScore,
        leastMoves: moves,
        fastestTimeSeconds: durationSeconds,
        attemptsCount: 1,
        firstCompletedAt: new Date(),
        lastCompletedAt: new Date(),
      });
      progress.highestUnlockedLevel = Math.max(
        progress.highestUnlockedLevel,
        level.levelNumber + 1
      );
      progress.currentLevel = Math.max(progress.currentLevel, level.levelNumber + 1);
    } else {
      const existing = progress.completedLevels[existingRecordIndex];
      existing.attemptsCount += 1;
      existing.lastCompletedAt = new Date();
      if (calculatedStars > existing.stars) existing.stars = calculatedStars;
      if (authoritativeScore > existing.highScore) existing.highScore = authoritativeScore;
      if (existing.leastMoves === 0 || moves < existing.leastMoves) existing.leastMoves = moves;
      if (existing.fastestTimeSeconds === 0 || durationSeconds < existing.fastestTimeSeconds) {
        existing.fastestTimeSeconds = durationSeconds;
      }
    }

    // Recompute total stars and score
    progress.totalStars = progress.completedLevels.reduce((sum, r) => sum + r.stars, 0);
    progress.totalScore = progress.completedLevels.reduce((sum, r) => sum + r.highScore, 0);
    progress.totalApplesEaten += applesCollected;
    progress.lastPlayedAt = new Date();

    await progress.save();

    // Mirror progress to User document for backward compatibility
    await User.findByIdAndUpdate(userId, {
      $set: {
        currentLevel: progress.currentLevel,
        totalScore: progress.totalScore,
        totalStars: progress.totalStars,
      },
      $addToSet: {
        completedLevels: level.levelNumber,
      },
    });

    return {
      session: updatedSession,
      isFirstTimeClear,
      rewards: {
        stars: calculatedStars,
        coins: authoritativeCoins,
        score: authoritativeScore,
      },
      wallet: {
        balance: walletCredit.balanceAfter,
        transactionId: walletCredit.transaction?._id,
      },
      unlockedLevel: progress.highestUnlockedLevel,
    };
  },

  /**
   * Mark an active session as failed.
   */
  async failSession(sessionId, userId, failureData) {
    const session = await this.getSessionById(sessionId, userId);

    if (session.status !== 'ACTIVE') {
      const error = new Error(`Cannot fail a session that is already ${session.status}.`);
      error.statusCode = 400;
      throw error;
    }

    const {
      failureReason = 'OUT_OF_MOVES',
      moves = session.moves,
      durationSeconds = 0,
    } = failureData;

    const validReasons = [
      'OUT_OF_MOVES',
      'HIT_SPIKE',
      'FALLEN_OFF_GRID',
      'TRAPPED',
      'MANUAL_RESTART',
      'TIMEOUT',
      'ABANDONED',
    ];

    if (!validReasons.includes(failureReason)) {
      const error = new Error(`Invalid failureReason. Must be one of: ${validReasons.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

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
      { returnDocument: 'after' }
    );

    return updatedSession;
  },

  /**
   * Retrieve paginated history of games for a user.
   */
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

  /**
   * Retrieve player's aggregated progression profile.
   */
  async getPlayerProgress(userId) {
    return this.getOrCreatePlayerProgress(userId);
  },
};

export default gameSessionService;