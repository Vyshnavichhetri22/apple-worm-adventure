import mongoose from 'mongoose';
import PlayerAchievement, { ACHIEVEMENT_DEFINITIONS } from '../models/PlayerAchievement.js';
import PlayerProgress from '../models/PlayerProgress.js';
import GameSession from '../models/GameSession.js';
import walletService from './walletService.js';

export class AchievementService {
  /**
   * Computes the current numeric progress value for an achievement based on user progress and game sessions.
   */
  calculateProgress(achievementId, userProgress, sessions = []) {
    const def = ACHIEVEMENT_DEFINITIONS[achievementId];
    if (!def) return 0;

    switch (achievementId) {
      case 'FIRST_VICTORY': {
        const completedCount = userProgress?.completedLevels?.length || 0;
        return Math.min(def.target, completedCount);
      }

      case 'APPLE_COLLECTOR': {
        let total = userProgress?.totalApplesEaten || 0;
        if (total === 0 && sessions.length > 0) {
          total = sessions.reduce((sum, s) => sum + (s.applesCollected || 0), 0);
        }
        return Math.min(def.target, total);
      }

      case 'WORM_MASTER': {
        let maxLen = 2;
        for (const s of sessions) {
          const wormLen = s.checkpoint?.wormState?.length;
          if (wormLen && wormLen > maxLen) {
            maxLen = wormLen;
          }
        }
        return Math.min(def.target, maxLen);
      }

      case 'SPEED_RUNNER': {
        const hasFastFromProgress = userProgress?.completedLevels?.some(
          (l) => l.fastestTimeSeconds > 0 && l.fastestTimeSeconds <= 15
        );
        const hasFastFromSession = sessions.some(
          (s) => s.status === 'COMPLETED' && s.durationSeconds > 0 && s.durationSeconds <= 15
        );
        return hasFastFromProgress || hasFastFromSession ? 1 : 0;
      }

      case 'STAR_CHAMPION': {
        const stars = userProgress?.totalStars || 0;
        return Math.min(def.target, stars);
      }

      case 'PIT_BRIDGER': {
        const hasBridged = sessions.some((s) => s.checkpoint?.filledPits && s.checkpoint.filledPits.length > 0);
        return hasBridged ? 1 : 0;
      }

      case 'KEY_HUNTER': {
        let totalKeys = 0;
        for (const s of sessions) {
          if (Array.isArray(s.checkpoint?.collectedKeys)) {
            totalKeys += s.checkpoint.collectedKeys.length;
          }
        }
        return Math.min(def.target, totalKeys);
      }

      case 'LEVEL_EXPLORER': {
        const highest = userProgress?.highestUnlockedLevel || 1;
        return Math.min(def.target, highest);
      }

      case 'MYSTERY_LOVER': {
        let totalMystery = userProgress?.totalMysteryApplesEaten || 0;
        if (totalMystery === 0 && sessions.length > 0) {
          totalMystery = sessions.reduce((sum, s) => sum + (s.mysteryApplesCollected || 0), 0);
        }
        return Math.min(def.target, totalMystery);
      }

      case 'VETERAN_PLAYER': {
        const completedCount = userProgress?.completedLevels?.length || 0;
        return Math.min(def.target, completedCount);
      }

      default:
        return 0;
    }
  }

  /**
   * Retrieves and updates all achievements for the specified user.
   */
  async getUserAchievements(userId) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [userProgress, sessions, existingRecords] = await Promise.all([
      PlayerProgress.findOne({ userId: userObjectId }).lean(),
      GameSession.find({ userId: userObjectId })
        .select('status durationSeconds checkpoint levelNumber applesCollected mysteryApplesCollected')
        .lean(),
      PlayerAchievement.find({ userId: userObjectId }).lean(),
    ]);

    const existingMap = new Map();
    for (const rec of existingRecords) {
      existingMap.set(rec.achievementId, rec);
    }

    const results = [];
    const now = new Date();

    for (const [key, def] of Object.entries(ACHIEVEMENT_DEFINITIONS)) {
      const existing = existingMap.get(key);
      const computedProgress = this.calculateProgress(key, userProgress, sessions);
      const finalProgress = existing ? Math.max(existing.progress || 0, computedProgress) : computedProgress;
      const isUnlocked = Boolean(existing?.unlocked || finalProgress >= def.target);
      const isClaimed = Boolean(existing?.claimed);
      const unlockedAt = existing?.unlockedAt || (isUnlocked ? now : null);

      // Perform upsert to keep PlayerAchievement state authoritative and indexed
      const updated = await PlayerAchievement.findOneAndUpdate(
        { userId: userObjectId, achievementId: key },
        {
          $set: {
            progress: finalProgress,
            target: def.target,
            rewardCoins: def.rewardCoins,
            unlocked: isUnlocked,
            unlockedAt: unlockedAt,
          },
          $setOnInsert: {
            claimed: false,
            claimedAt: null,
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      ).lean();

      results.push({
        id: def.id,
        title: def.title,
        description: def.description,
        icon: def.icon,
        target: def.target,
        rewardCoins: def.rewardCoins,
        progress: updated.progress,
        percentage: Math.min(100, Math.round((updated.progress / def.target) * 100)),
        unlocked: updated.unlocked,
        unlockedAt: updated.unlockedAt,
        claimed: updated.claimed,
        claimedAt: updated.claimedAt,
      });
    }

    return results;
  }

  /**
   * Atomically claims an unlocked achievement reward, idempotently crediting the user's wallet.
   */
  async claimAchievement(userId, achievementId) {
    if (!ACHIEVEMENT_DEFINITIONS[achievementId]) {
      const err = new Error(`Unknown achievement: ${achievementId}`);
      err.statusCode = 400;
      throw err;
    }

    const def = ACHIEVEMENT_DEFINITIONS[achievementId];
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Sync latest progress first to ensure freshly unlocked achievements can be claimed
    await this.getUserAchievements(userId);

    // Atomic CAS update: only claim if unlocked and not yet claimed
    const claimedRecord = await PlayerAchievement.findOneAndUpdate(
      {
        userId: userObjectId,
        achievementId,
        unlocked: true,
        claimed: false,
      },
      {
        $set: {
          claimed: true,
          claimedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!claimedRecord) {
      const existing = await PlayerAchievement.findOne({ userId: userObjectId, achievementId }).lean();
      if (existing && existing.claimed) {
        return {
          success: true,
          claimed: true,
          alreadyClaimed: true,
          achievementId,
          rewardCoins: existing.rewardCoins || def.rewardCoins,
          message: 'Achievement reward already claimed.',
        };
      }

      const err = new Error('Achievement is not unlocked yet.');
      err.statusCode = 400;
      throw err;
    }

    // Authoritative wallet crediting with unique idempotencyKey
    const idempotencyKey = `achievement_claim_${userId}_${achievementId}`;
    const creditResult = await walletService.credit(userId, claimedRecord.rewardCoins, {
      type: 'ACHIEVEMENT_REWARD',
      idempotencyKey,
      metadata: {
        achievementId,
        title: def.title,
      },
    });

    return {
      success: true,
      claimed: true,
      alreadyClaimed: false,
      achievementId,
      rewardCoins: claimedRecord.rewardCoins,
      wallet: creditResult.wallet,
    };
  }
}

export const achievementService = new AchievementService();
export default achievementService;
