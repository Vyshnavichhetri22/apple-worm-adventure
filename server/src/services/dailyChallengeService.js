import mongoose from 'mongoose';
import Level from '../models/Level.js';
import GameSession from '../models/GameSession.js';
import DailyChallengeCompletion from '../models/DailyChallengeCompletion.js';
import PlayerDailyStreak, { STREAK_MILESTONES } from '../models/PlayerDailyStreak.js';
import PlayerProgress from '../models/PlayerProgress.js';
import User from '../models/User.js';
import EconomyConfig from '../models/EconomyConfig.js';
import gameSessionService from './gameSessionService.js';
import walletService from './walletService.js';

/**
 * Returns the current date in UTC format 'YYYY-MM-DD'.
 */
export function getUTCDateString(date = new Date()) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the integer difference in days between two 'YYYY-MM-DD' UTC date strings (date2 - date1).
 */
export function getDaysBetweenUTCDates(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return null;
  const [y1, m1, d1] = dateStr1.split('-').map(Number);
  const [y2, m2, d2] = dateStr2.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((utc2 - utc1) / msPerDay);
}

/**
 * Deterministically maps a UTC date string ('YYYY-MM-DD') to an eligible level number.
 * Accepts either an explicit array of eligible level numbers or a total level count.
 * Guarantees that all players receive the exact same puzzle level on the same calendar day.
 */
export function getDailyChallengeLevelNumber(dateStr, pool = 50) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  }
  if (Array.isArray(pool)) {
    if (pool.length === 0) return 1;
    return pool[hash % pool.length];
  }
  const total = Number(pool) || 50;
  if (total <= 1) return 1;
  return (hash % total) + 1;
}

export class DailyChallengeService {
  /**
   * Retrieves today's daily challenge details, completion status, and player streak overview.
   */
  async getTodayChallenge(userId = null, targetDate = null) {
    const dateStr = targetDate || getUTCDateString();

    // Query active levels to determine eligible pool
    const activeLevels = await Level.find({ isActive: true })
      .select('levelNumber')
      .sort({ levelNumber: 1 })
      .lean();
    const eligibleNumbers = activeLevels.length > 0 ? activeLevels.map((l) => l.levelNumber) : [1];
    const levelNumber = getDailyChallengeLevelNumber(dateStr, eligibleNumbers);

    const level = await Level.findOne({ levelNumber, isActive: true }).lean();
    if (!level) {
      const err = new Error(`Daily challenge level ${levelNumber} not found.`);
      err.statusCode = 404;
      throw err;
    }

    // Default daily reward amount (150 coins)
    const rewardCoins = 150;

    let completion = null;
    let streakData = {
      currentStreak: 0,
      longestStreak: 0,
      lastCompletedDate: null,
      isStreakActive: false,
      totalCompletions: 0,
      claimedMilestones: [],
      milestones: [],
    };

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const [existingCompletion, playerStreak] = await Promise.all([
        DailyChallengeCompletion.findOne({ userId: userObjectId, date: dateStr }).lean(),
        PlayerDailyStreak.findOne({ userId: userObjectId }).lean(),
      ]);

      completion = existingCompletion;

      const currentStreak = playerStreak?.currentStreak || 0;
      const longestStreak = playerStreak?.longestStreak || 0;
      const lastCompletedDate = playerStreak?.lastCompletedDate || null;
      const claimedMilestones = playerStreak?.claimedMilestones || [];

      let isStreakActive = false;
      let effectiveCurrentStreak = currentStreak;
      if (lastCompletedDate) {
        const diff = getDaysBetweenUTCDates(lastCompletedDate, dateStr);
        // Active if completed today (diff === 0) or completed yesterday (diff === 1)
        isStreakActive = diff === 0 || diff === 1;
        if (diff > 1) {
          // Lapsed streak: if player missed days and hasn't completed today's puzzle, current streak is 0
          effectiveCurrentStreak = 0;
        }
      } else {
        effectiveCurrentStreak = 0;
      }

      // Build enriched milestone indicators
      const enrichedMilestones = Object.values(STREAK_MILESTONES).map((m) => {
        const isClaimed = claimedMilestones.includes(m.days);
        const isUnlocked = effectiveCurrentStreak >= m.days || longestStreak >= m.days;
        return {
          days: m.days,
          rewardCoins: m.rewardCoins,
          label: m.label,
          icon: m.icon,
          claimed: isClaimed,
          unlocked: isUnlocked,
          canClaim: isUnlocked && !isClaimed,
        };
      });

      streakData = {
        currentStreak: effectiveCurrentStreak,
        longestStreak,
        lastCompletedDate,
        isStreakActive,
        totalCompletions: playerStreak?.totalCompletions || 0,
        claimedMilestones,
        milestones: enrichedMilestones,
      };
    } else {
      // Guest view default milestones
      streakData.milestones = Object.values(STREAK_MILESTONES).map((m) => ({
        days: m.days,
        rewardCoins: m.rewardCoins,
        label: m.label,
        icon: m.icon,
        claimed: false,
        unlocked: false,
        canClaim: false,
      }));
    }

    return {
      success: true,
      date: dateStr,
      levelNumber,
      level: {
        _id: level._id,
        levelNumber: level.levelNumber,
        title: level.title || `Level ${level.levelNumber}`,
        difficulty: level.difficulty || 'medium',
        moveLimit: level.moveLimit,
        grid: level.grid,
        applesCount: Array.isArray(level.apples) ? level.apples.length : 0,
        keysCount: Array.isArray(level.keys) ? level.keys.length : 0,
        portal: level.portal,
      },
      rewardCoins,
      isCompleted: Boolean(completion),
      completion: completion
        ? {
            score: completion.score,
            moves: completion.moves,
            durationSeconds: completion.durationSeconds,
            completedAt: completion.completedAt,
            streakCount: completion.streakCount,
          }
        : null,
      streak: streakData,
    };
  }

  /**
   * Initiates a game session specifically configured for the daily challenge.
   * Playable regardless of player's standard progression unlock level.
   */
  async startDailyChallengeSession(userId, targetDate = null) {
    const dateStr = targetDate || getUTCDateString();
    const activeLevels = await Level.find({ isActive: true })
      .select('levelNumber')
      .sort({ levelNumber: 1 })
      .lean();
    const eligibleNumbers = activeLevels.length > 0 ? activeLevels.map((l) => l.levelNumber) : [1];
    const levelNumber = getDailyChallengeLevelNumber(dateStr, eligibleNumbers);

    const level = await Level.findOne({ levelNumber, isActive: true }).lean();
    if (!level) {
      const err = new Error(`Daily challenge level ${levelNumber} is unavailable.`);
      err.statusCode = 404;
      throw err;
    }

    const session = await gameSessionService.startSession(userId, levelNumber, {
      isDailyChallenge: true,
      challengeDate: dateStr,
    });

    return {
      success: true,
      date: dateStr,
      levelNumber,
      session,
    };
  }

  /**
   * Completes a daily challenge session with server-side objective validation,
   * updates the daily participation streak, and credits daily reward coins idempotently.
   */
  async completeDailyChallenge(userId, sessionId, completionData = {}) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const session = await GameSession.findById(sessionId);
    if (!session) {
      const err = new Error('Daily challenge game session not found.');
      err.statusCode = 404;
      throw err;
    }

    if (session.userId.toString() !== userObjectId.toString()) {
      const err = new Error('Access denied: You do not own this game session.');
      err.statusCode = 403;
      throw err;
    }

    if (!session.isDailyChallenge) {
      const err = new Error('This session was not registered as a daily challenge.');
      err.statusCode = 400;
      throw err;
    }

    const challengeDate = session.challengeDate || getUTCDateString();

    // Synchronize final checkpoint state if provided in completionData
    if (completionData?.checkpoint && Array.isArray(completionData.checkpoint.wormState)) {
      session.checkpoint = {
        ...(session.checkpoint ? session.checkpoint.toObject() : {}),
        ...completionData.checkpoint,
        savedAt: new Date(),
      };
      await session.save();
    }

    // 1. Authoritative gameplay objective validation (portal reachability, valid moves, keys)
    const sessionCompletion = await gameSessionService.completeSession(
      sessionId,
      userId,
      {
        ...completionData,
        _skipDailyChallengeSync: true,
      }
    );

    // 2. Synchronize daily challenge streak, completion record, and wallet reward
    const syncResult = await this.syncDailyChallengeCompletion(
      userId,
      session,
      {
        score: sessionCompletion?.session?.score || session.score || completionData.score || 0,
        moves: sessionCompletion?.session?.moves || session.moves || completionData.moves || 0,
        durationSeconds:
          sessionCompletion?.session?.durationSeconds || session.durationSeconds || completionData.durationSeconds || 0,
      }
    );

    return {
      ...syncResult,
      session: sessionCompletion?.session || session,
      rewards: {
        stars: sessionCompletion?.rewards?.stars || 1,
        coins: syncResult.rewardCoins,
        score: sessionCompletion?.rewards?.score || syncResult.completion?.score || 500,
        goldenApples: sessionCompletion?.rewards?.goldenApples || 0,
        goldenCoins: sessionCompletion?.rewards?.goldenCoins || 0,
        megaApples: sessionCompletion?.rewards?.megaApples || 0,
        timeApples: sessionCompletion?.rewards?.timeApples || 0,
        timeBonusMoves: sessionCompletion?.rewards?.timeBonusMoves || 0,
        mysteryApples: sessionCompletion?.rewards?.mysteryApples || 0,
        mysteryEffects: sessionCompletion?.rewards?.mysteryEffects || [],
        dailyStreak: syncResult.streak?.currentStreak || 1,
      },
    };
  }

  /**
   * Authoritatively synchronizes daily challenge completion, streak calculation,
   * DailyChallengeCompletion record, and idempotent DAILY_REWARD wallet credit.
   */
  async syncDailyChallengeCompletion(userId, session, completionMetrics = {}) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const challengeDate = session.challengeDate || getUTCDateString();

    let streakDoc = await PlayerDailyStreak.findOne({ userId: userObjectId });
    let currentStreak = streakDoc?.currentStreak || 0;
    let longestStreak = streakDoc?.longestStreak || 0;
    const lastCompletedDate = streakDoc?.lastCompletedDate || null;

    let newStreak = 1;
    if (lastCompletedDate) {
      const diff = getDaysBetweenUTCDates(lastCompletedDate, challengeDate);
      if (diff === 0) {
        // Same calendar day: maintain existing streak without double counting
        newStreak = currentStreak;
      } else if (diff === 1) {
        // Consecutive calendar day: increment streak
        newStreak = currentStreak + 1;
      } else {
        // Lapsed day (diff > 1): reset streak to 1
        newStreak = 1;
      }
    }

    longestStreak = Math.max(longestStreak, newStreak);
    const rewardCoins = 150;

    // 3. Atomic creation of DailyChallengeCompletion (enforces AT MOST ONE completion record per UTC day)
    let completion;
    let alreadyCompleted = false;

    try {
      completion = await DailyChallengeCompletion.create({
        userId: userObjectId,
        date: challengeDate,
        levelNumber: session.levelNumber,
        levelId: session.levelId,
        sessionId: session._id,
        score: completionMetrics.score || session.score || 0,
        moves: completionMetrics.moves || session.moves || 0,
        durationSeconds: completionMetrics.durationSeconds || session.durationSeconds || 0,
        rewardCoins,
        rewardClaimed: true,
        streakCount: newStreak,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Already completed today: fetch existing completion and proceed idempotently
        alreadyCompleted = true;
        completion = await DailyChallengeCompletion.findOne({
          userId: userObjectId,
          date: challengeDate,
        }).lean();
      } else {
        throw err;
      }
    }

    let wallet = null;

    // 4. Reward crediting & streak synchronization (only on first completion of the day)
    if (!alreadyCompleted) {
      // Credit daily challenge coin reward to wallet
      const idempotencyKey = `daily_challenge_${userObjectId}_${challengeDate}`;
      const creditResult = await walletService.credit(userId, rewardCoins, {
        type: 'DAILY_REWARD',
        idempotencyKey,
        description: `Daily login reward (Day ${newStreak} streak)`,
        metadata: {
          challengeDate,
          levelNumber: session.levelNumber,
          streak: newStreak,
        },
      });

      wallet = creditResult.wallet;

      // Persist updated streak document
      streakDoc = await PlayerDailyStreak.findOneAndUpdate(
        { userId: userObjectId },
        {
          $set: {
            currentStreak: newStreak,
            longestStreak,
            lastCompletedDate: challengeDate,
            lastCompletionAt: new Date(),
          },
          $inc: { totalCompletions: 1 },
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Mirror streak to PlayerProgress & User for cross-feature consistency
      await Promise.all([
        PlayerProgress.findOneAndUpdate(
          { userId: userObjectId },
          { $set: { currentStreak: newStreak, bestStreak: longestStreak } }
        ),
        User.findByIdAndUpdate(userId, {
          $set: { currentStreak: newStreak, bestStreak: longestStreak },
        }),
      ]);
    } else {
      streakDoc = await PlayerDailyStreak.findOne({ userId: userObjectId });
      wallet = await walletService.getOrCreateWallet(userId);
    }

    return {
      success: true,
      alreadyCompleted,
      challengeDate,
      levelNumber: session.levelNumber,
      rewardCoins: alreadyCompleted ? 0 : rewardCoins,
      streak: {
        currentStreak: streakDoc?.currentStreak || newStreak,
        longestStreak: streakDoc?.longestStreak || longestStreak,
        lastCompletedDate: streakDoc?.lastCompletedDate || challengeDate,
      },
      completion,
      wallet,
    };
  }

  /**
   * Claims a streak milestone reward (3, 7, 14, 30 days) idempotently.
   */
  async claimStreakMilestone(userId, daysInput) {
    const days = parseInt(daysInput, 10);
    const milestone = STREAK_MILESTONES[days];
    if (!milestone) {
      const err = new Error(`Invalid streak milestone: ${daysInput} days.`);
      err.statusCode = 400;
      throw err;
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Atomic CAS update: only claim if days not in claimedMilestones and player achieved this streak
    const updatedStreak = await PlayerDailyStreak.findOneAndUpdate(
      {
        userId: userObjectId,
        claimedMilestones: { $ne: days },
        $or: [{ currentStreak: { $gte: days } }, { longestStreak: { $gte: days } }],
      },
      {
        $addToSet: { claimedMilestones: days },
      },
      { returnDocument: 'after' }
    );

    if (!updatedStreak) {
      const existing = await PlayerDailyStreak.findOne({ userId: userObjectId }).lean();
      if (existing?.claimedMilestones?.includes(days)) {
        return {
          success: true,
          claimed: true,
          alreadyClaimed: true,
          days,
          rewardCoins: milestone.rewardCoins,
          message: `${milestone.label} reward has already been claimed.`,
        };
      }

      const err = new Error(
        `Streak milestone of ${days} days has not been achieved yet.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Authoritative wallet crediting with unique idempotencyKey
    const idempotencyKey = `streak_milestone_${userObjectId}_${days}`;
    const creditResult = await walletService.credit(userId, milestone.rewardCoins, {
      type: 'STREAK_MILESTONE_REWARD',
      idempotencyKey,
      metadata: {
        milestoneDays: days,
        milestoneLabel: milestone.label,
      },
    });

    return {
      success: true,
      claimed: true,
      alreadyClaimed: false,
      days,
      rewardCoins: milestone.rewardCoins,
      wallet: creditResult.wallet,
    };
  }
}

export const dailyChallengeService = new DailyChallengeService();
export default dailyChallengeService;
