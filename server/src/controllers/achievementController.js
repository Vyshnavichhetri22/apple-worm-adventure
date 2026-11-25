import achievementService from '../services/achievementService.js';

export const achievementController = {
  async getAchievements(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const achievements = await achievementService.getUserAchievements(userId);

      return res.status(200).json({
        success: true,
        achievements,
      });
    } catch (err) {
      next(err);
    }
  },

  async claimAchievement(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const { id } = req.params;

      const result = await achievementService.claimAchievement(userId, id);

      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default achievementController;
