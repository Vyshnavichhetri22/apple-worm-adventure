import rewardedAdService from '../services/rewardedAdService.js';

export const rewardedAdController = {
  /**
   * POST /api/ads/opportunity
   */
  async requestOpportunity(req, res, next) {
    try {
      const userId = req.user.userId;
      const { placement, sessionId, boosterType } = req.body;

      const result = await rewardedAdService.requestOpportunity(userId, {
        placement,
        sessionId,
        boosterType,
      });

      return res.status(201).json({
        success: true,
        message: 'Ad opportunity created and quota reserved successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ads/start
   */
  async startAd(req, res, next) {
    try {
      const userId = req.user.userId;
      const { opportunityId } = req.body;

      if (!opportunityId) {
        return res.status(400).json({
          success: false,
          message: 'opportunityId is required in request body.',
        });
      }

      const updated = await rewardedAdService.startAd(userId, opportunityId);

      return res.status(200).json({
        success: true,
        message: 'Ad playback started.',
        data: {
          opportunityId: updated._id,
          status: updated.status,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ads/status/:opportunityId
   */
  async getStatus(req, res, next) {
    try {
      const userId = req.user.userId;
      const { opportunityId } = req.params;

      const result = await rewardedAdService.getOpportunityStatus(userId, opportunityId);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ads/callback/admob
   */
  async handleAdMobCallback(req, res, next) {
    try {
      const queryIndex = req.originalUrl.indexOf('?');
      const rawQueryString = queryIndex !== -1 ? req.originalUrl.substring(queryIndex + 1) : '';

      const result = await rewardedAdService.processProviderCallback({
        provider: 'ADMOB',
        queryParams: req.query,
        rawQueryString,
      });

      return res.status(200).json({
        success: true,
        message: 'AdMob SSV callback verified and processed.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ads/callback/mock
   */
  async handleMockCallback(req, res, next) {
    try {
      const result = await rewardedAdService.processProviderCallback({
        provider: 'MOCK',
        headers: req.headers,
        body: req.body,
      });

      return res.status(200).json({
        success: true,
        message: 'Mock SSV callback verified and processed.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default rewardedAdController;