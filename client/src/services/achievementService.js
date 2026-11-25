import api from './api.js';

export const achievementService = {
  /**
   * Fetches all 10 achievements with authoritative player progress and unlock status.
   * @returns {Promise<any>}
   */
  async getAchievements() {
    return api.get('/achievements');
  },

  /**
   * Claims the coin reward for an unlocked achievement.
   * @param {string} achievementId
   * @returns {Promise<any>}
   */
  async claimAchievement(achievementId) {
    return api.post(`/achievements/${achievementId}/claim`, {});
  },
};

export default achievementService;
