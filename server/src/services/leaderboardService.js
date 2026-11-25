import mongoose from 'mongoose';
import PlayerProgress from '../models/PlayerProgress.js';

export class LeaderboardService {
  /**
   * Retrieves paginated global leaderboard rankings and the requesting user's authoritative rank.
   */
  async getLeaderboard({ page = 1, limit = 20, metric = 'totalScore', currentUserId = null } = {}) {
    const validMetrics = ['totalScore', 'totalStars'];
    const activeMetric = validMetrics.includes(metric) ? metric : 'totalScore';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const sortCriteria =
      activeMetric === 'totalStars'
        ? { totalStars: -1, totalScore: -1, updatedAt: 1 }
        : { totalScore: -1, totalStars: -1, updatedAt: 1 };

    const [totalPlayers, records] = await Promise.all([
      PlayerProgress.countDocuments({}),
      PlayerProgress.find({})
        .sort(sortCriteria)
        .skip(skip)
        .limit(limitNum)
        .populate('userId', 'username role')
        .lean(),
    ]);

    const leaderboard = records.map((rec, index) => {
      const user = rec.userId && typeof rec.userId === 'object' ? rec.userId : null;
      return {
        rank: skip + index + 1,
        userId: user ? user._id : rec.userId,
        username: user ? user.username : 'Worm Adventurer',
        role: user?.role || 'player',
        totalScore: rec.totalScore || 0,
        totalStars: rec.totalStars || 0,
        completedLevelsCount: Array.isArray(rec.completedLevels) ? rec.completedLevels.length : 0,
        highestUnlockedLevel: rec.highestUnlockedLevel || 1,
        totalApplesEaten: rec.totalApplesEaten || 0,
        lastPlayedAt: rec.lastPlayedAt || rec.updatedAt,
      };
    });

    let myEntry = null;
    if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
      const userObjectId = new mongoose.Types.ObjectId(currentUserId);
      const myProgress = await PlayerProgress.findOne({ userId: userObjectId })
        .populate('userId', 'username role')
        .lean();

      if (myProgress) {
        const higherCountQuery =
          activeMetric === 'totalStars'
            ? {
                $or: [
                  { totalStars: { $gt: myProgress.totalStars } },
                  { totalStars: myProgress.totalStars, totalScore: { $gt: myProgress.totalScore } },
                  {
                    totalStars: myProgress.totalStars,
                    totalScore: myProgress.totalScore,
                    updatedAt: { $lt: myProgress.updatedAt },
                  },
                ],
              }
            : {
                $or: [
                  { totalScore: { $gt: myProgress.totalScore } },
                  { totalScore: myProgress.totalScore, totalStars: { $gt: myProgress.totalStars } },
                  {
                    totalScore: myProgress.totalScore,
                    totalStars: myProgress.totalStars,
                    updatedAt: { $lt: myProgress.updatedAt },
                  },
                ],
              };

        const rankCount = await PlayerProgress.countDocuments(higherCountQuery);
        const user = myProgress.userId && typeof myProgress.userId === 'object' ? myProgress.userId : null;

        myEntry = {
          rank: rankCount + 1,
          userId: user ? user._id : myProgress.userId,
          username: user ? user.username : 'You',
          role: user?.role || 'player',
          totalScore: myProgress.totalScore || 0,
          totalStars: myProgress.totalStars || 0,
          completedLevelsCount: Array.isArray(myProgress.completedLevels) ? myProgress.completedLevels.length : 0,
          highestUnlockedLevel: myProgress.highestUnlockedLevel || 1,
          totalApplesEaten: myProgress.totalApplesEaten || 0,
          lastPlayedAt: myProgress.lastPlayedAt || myProgress.updatedAt,
        };
      }
    }

    return {
      success: true,
      metric: activeMetric,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalPlayers / limitNum) || 1,
      totalPlayers,
      leaderboard,
      myEntry,
    };
  }
}

export const leaderboardService = new LeaderboardService();
export default leaderboardService;
