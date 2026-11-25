import leaderboardService from '../services/leaderboardService.js';

export const leaderboardController = {
  async getLeaderboard(req, res, next) {
    try {
      const { page = 1, limit = 20, metric = 'totalScore' } = req.query;
      const currentUserId = req.user?.userId || req.user?._id || null;

      const data = await leaderboardService.getLeaderboard({
        page,
        limit,
        metric,
        currentUserId,
      });

      return res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
};

export default leaderboardController;
