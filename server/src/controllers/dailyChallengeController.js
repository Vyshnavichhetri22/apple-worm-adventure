import dailyChallengeService from '../services/dailyChallengeService.js';

export const dailyChallengeController = {
  async getTodayChallenge(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id || null;
      const { date } = req.query;

      const result = await dailyChallengeService.getTodayChallenge(userId, date);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async startDailyChallenge(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const { date } = req.body;

      const result = await dailyChallengeService.startDailyChallengeSession(userId, date);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async completeDailyChallenge(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const { sessionId, ...completionData } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'sessionId is required to complete daily challenge.',
        });
      }

      const result = await dailyChallengeService.completeDailyChallenge(
        userId,
        sessionId,
        completionData
      );

      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async claimMilestone(req, res, next) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const { days } = req.params;

      const result = await dailyChallengeService.claimStreakMilestone(userId, days);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default dailyChallengeController;
