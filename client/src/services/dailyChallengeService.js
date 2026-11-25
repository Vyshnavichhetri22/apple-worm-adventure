import api from './api.js';

export const dailyChallengeService = {
  /**
   * Retrieves today's daily challenge, level preview, completion status, and streak state.
   */
  async getTodayChallenge(date = null) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return api.get(`/daily-challenge/today${query}`);
  },

  /**
   * Starts a game session for today's daily challenge.
   */
  async startDailyChallenge(date = null) {
    return api.post('/daily-challenge/start', { date });
  },

  /**
   * Submits daily challenge completion with authoritative verification.
   */
  async completeDailyChallenge(sessionId, completionData = {}) {
    return api.post('/daily-challenge/complete', {
      sessionId,
      ...completionData,
    });
  },

  /**
   * Claims a streak milestone reward (3, 7, 14, 30 days).
   */
  async claimStreakMilestone(days) {
    return api.post(`/daily-challenge/claim-milestone/${days}`, {});
  },
};

export default dailyChallengeService;
