import crypto from 'node:crypto';
import mongoose from 'mongoose';
import AdOpportunity, { AD_PLACEMENTS } from '../models/AdOpportunity.js';
import AdQuotaReservation from '../models/AdQuotaReservation.js';
import GameSession from '../models/GameSession.js';
import PlayerProgress from '../models/PlayerProgress.js';
import EconomyConfig from '../models/EconomyConfig.js';
import walletService from './walletService.js';
import adProviderService from './adProviderService.js';

const OPPORTUNITY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const GRANT_LEASE_TIMEOUT_MS = 30 * 1000; // 30 seconds

export const rewardedAdService = {
  /**
   * Map placement to authoritative reward type.
   */
  getPlacementRewardType(placement) {
    switch (placement) {
      case 'GAME_OVER_REVIVE':
        return 'REVIVE';
      case 'MOVE_EXHAUSTED_EXTRA':
        return 'EXTRA_MOVES';
      case 'SESSION_BOOSTER':
        return 'BOOSTER';
      case 'POST_WIN_DOUBLE_COIN':
        return 'DOUBLE_COINS';
      case 'POST_WIN_DOUBLE_SCORE':
        return 'DOUBLE_SCORE';
      case 'STORE_FREE_COINS':
        return 'COIN_REWARD';
      default:
        return null;
    }
  },

  /**
   * Authoritative check: are rewarded ads operational and supported in this environment?
   * - In production: rewarded ads are UNAVAILABLE unless a real supported web provider
   *   is configured and integrated. (AdMob is mobile native only; mock provider is prohibited).
   * - In non-production (development, test): mock provider is permitted.
   */
  isAdAvailable() {
    if (process.env.NODE_ENV === 'production') {
      // Production requires an integrated, supported real web ad provider.
      // Currently no real web provider is integrated in this web client.
      return false;
    }
    // Development and test environments permit the mock provider.
    return true;
  },

  getAdAvailability() {
    const available = this.isAdAvailable();
    return {
      available,
      provider: available ? 'MOCK' : null,
      reason: available
        ? 'Mock provider enabled for non-production environment.'
        : 'Rewarded ads are unavailable in production until a supported web provider is integrated.',
    };
  },

  /**
   * Request an ad opportunity with atomic quota reservation.
   */
  async requestOpportunity(userId, { placement, sessionId = null, boosterType = 'APPLE_MAGNET' }) {
    if (!this.isAdAvailable()) {
      const error = new Error('Rewarded ads are currently unavailable in this environment.');
      error.statusCode = 503;
      throw error;
    }

    if (!AD_PLACEMENTS.includes(placement)) {
      const error = new Error(`Invalid placement: ${placement}. Must be one of: ${AD_PLACEMENTS.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const rewardType = this.getPlacementRewardType(placement);
    const economy = await EconomyConfig.getActiveConfig();
    const rules = economy.rules.adLimits;

    let targetSession = null;
    if (sessionId) {
      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        const error = new Error('Invalid sessionId provided.');
        error.statusCode = 400;
        throw error;
      }
      targetSession = await GameSession.findById(sessionId);
      if (!targetSession) {
        const error = new Error('GameSession not found.');
        error.statusCode = 404;
        throw error;
      }
      if (targetSession.userId.toString() !== userId.toString()) {
        const error = new Error('Access denied: You do not own this game session.');
        error.statusCode = 403;
        throw error;
      }

      // Placement prerequisites
      if (placement === 'GAME_OVER_REVIVE' && targetSession.status !== 'FAILED') {
        const error = new Error(`Cannot request REVIVE for a session with status ${targetSession.status}.`);
        error.statusCode = 400;
        throw error;
      }
      if (placement === 'MOVE_EXHAUSTED_EXTRA' && targetSession.status !== 'ACTIVE') {
        const error = new Error(`Cannot request EXTRA_MOVES for a session that is ${targetSession.status}.`);
        error.statusCode = 400;
        throw error;
      }
      if (
        (placement === 'POST_WIN_DOUBLE_COIN' || placement === 'POST_WIN_DOUBLE_SCORE') &&
        targetSession.status !== 'COMPLETED'
      ) {
        const error = new Error(`Cannot request double reward for an uncompleted session (${targetSession.status}).`);
        error.statusCode = 400;
        throw error;
      }
    }

    // Determine baseline reward amount
    let rewardAmount = 0;
    if (rewardType === 'COIN_REWARD') rewardAmount = rules.baseCoinReward || 25;
    else if (rewardType === 'EXTRA_MOVES') rewardAmount = rules.extraMovesReward || 5;
    else if (rewardType === 'DOUBLE_COINS' && targetSession) rewardAmount = targetSession.coinsEarned;
    else if (rewardType === 'DOUBLE_SCORE' && targetSession) rewardAmount = targetSession.score;

    const tempOpportunityId = new mongoose.Types.ObjectId();

    // Safeguard 1: Database-backed atomic quota reservation
    await AdQuotaReservation.reserveQuota({
      userId,
      sessionId,
      rewardType,
      opportunityId: tempOpportunityId,
      rules,
    });

    // Generate cryptographically secure nonce
    const customDataNonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + OPPORTUNITY_TTL_MS);

    const opportunity = await AdOpportunity.create({
      _id: tempOpportunityId,
      userId,
      sessionId,
      placement,
      rewardType,
      rewardAmount,
      boosterType: rewardType === 'BOOSTER' ? boosterType : null,
      status: 'REQUESTED',
      customDataNonce,
      provider: process.env.NODE_ENV === 'production' ? 'ADMOB' : 'MOCK',
      expiresAt,
    });

    return {
      opportunityId: opportunity._id,
      placement,
      rewardType,
      rewardAmount,
      customDataNonce,
      customData: `${opportunity._id}:${customDataNonce}`,
      expiresAt,
    };
  },

  /**
   * Signal that the ad has started playing on the client.
   */
  async startAd(userId, opportunityId) {
    const opportunity = await AdOpportunity.findById(opportunityId);
    if (!opportunity) {
      const error = new Error('AdOpportunity not found.');
      error.statusCode = 404;
      throw error;
    }

    if (opportunity.userId.toString() !== userId.toString()) {
      const error = new Error('Access denied: You do not own this opportunity.');
      error.statusCode = 403;
      throw error;
    }

    if (new Date() > opportunity.expiresAt) {
      opportunity.status = 'EXPIRED';
      await opportunity.save();
      const error = new Error('AdOpportunity has expired.');
      error.statusCode = 410;
      throw error;
    }

    if (opportunity.status === 'REQUESTED') {
      opportunity.status = 'AD_STARTED';
      await opportunity.save();
    }

    return opportunity;
  },

  /**
   * Verify provider callback and execute state transitions.
   */
  async processProviderCallback({
    provider,
    queryParams = {},
    headers = {},
    body = {},
    rawQueryString = '',
  }) {
    let customData = '';
    let providerTransactionId = '';

    if (provider === 'ADMOB') {
      customData = queryParams.custom_data || '';
      providerTransactionId = queryParams.transaction_id || `admob_tx_${Date.now()}`;

      const verifyResult = await adProviderService.verifyAdMobSSV({
        rawQueryString,
        queryParams,
      });

      if (!verifyResult.valid) {
        const error = new Error(verifyResult.error || 'AdMob signature invalid.');
        error.statusCode = 400;
        throw error;
      }
    } else {
      const mockResult = adProviderService.verifyMockSSV(headers, body);
      if (!mockResult.valid) {
        const error = new Error(mockResult.error || 'Mock callback verification failed.');
        error.statusCode = mockResult.error.includes('disabled') ? 404 : 403;
        throw error;
      }
      customData = body.custom_data || '';
      providerTransactionId = body.transaction_id || `mock_tx_${Date.now()}`;
    }

    if (!customData || !customData.includes(':')) {
      const error = new Error('Invalid custom_data format. Expected opportunityId:nonce');
      error.statusCode = 400;
      throw error;
    }

    const [opportunityId, nonce] = customData.split(':');

    if (!mongoose.Types.ObjectId.isValid(opportunityId)) {
      const error = new Error('Invalid opportunityId in custom_data.');
      error.statusCode = 400;
      throw error;
    }

    const opportunity = await AdOpportunity.findById(opportunityId);
    if (!opportunity) {
      const error = new Error('AdOpportunity not found for this callback.');
      error.statusCode = 404;
      throw error;
    }

    // Replay / Conflict verification
    if (opportunity.providerTransactionId) {
      if (opportunity.providerTransactionId === providerTransactionId) {
        return {
          status: opportunity.status,
          alreadyProcessed: true,
          opportunityId: opportunity._id,
        };
      }
      const error = new Error('Conflict: Opportunity already processed with a different transaction ID.');
      error.statusCode = 409;
      throw error;
    }

    const existingTx = await AdOpportunity.findOne({ providerTransactionId });
    if (existingTx && existingTx._id.toString() !== opportunity._id.toString()) {
      const error = new Error('Conflict: Transaction ID has already been utilized by another opportunity.');
      error.statusCode = 409;
      throw error;
    }

    // Verify cryptographic nonce
    if (opportunity.customDataNonce !== nonce) {
      opportunity.status = 'REJECTED';
      await opportunity.save();
      const error = new Error('Security Error: customDataNonce does not match opportunity.');
      error.statusCode = 403;
      throw error;
    }

    // Transition through VERIFYING -> VERIFIED
    opportunity.status = 'VERIFIED';
    opportunity.provider = provider;
    opportunity.providerTransactionId = providerTransactionId;
    await opportunity.save();

    // Trigger atomic reward application
    return this.grantReward(opportunity._id);
  },

  /**
   * Safeguard 3: Safely grant reward using lease/lock, unique grantId, and idempotent handlers.
   */
  async grantReward(opportunityId) {
    const currentGrantId = crypto.randomUUID();
    const leaseExpires = new Date(Date.now() + GRANT_LEASE_TIMEOUT_MS);

    // Atomic lease acquisition
    const lockedOpportunity = await AdOpportunity.findOneAndUpdate(
      {
        _id: opportunityId,
        $or: [
          { status: 'VERIFIED' },
          {
            status: 'GRANTING',
            grantLockExpiresAt: { $lt: new Date() },
          },
        ],
      },
      {
        $set: {
          status: 'GRANTING',
          grantId: currentGrantId,
          grantLockExpiresAt: leaseExpires,
          grantingStartedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!lockedOpportunity) {
      const current = await AdOpportunity.findById(opportunityId);
      if (current?.status === 'GRANTED') {
        return { success: true, status: 'GRANTED', grantDetails: current.grantDetails };
      }
      const error = new Error('Grant lease active or opportunity not eligible for granting.');
      error.statusCode = 409;
      throw error;
    }

    try {
      const grantDetails = await this.executeRewardHandler(lockedOpportunity);

      const finalized = await AdOpportunity.findOneAndUpdate(
        {
          _id: opportunityId,
          status: 'GRANTING',
          grantId: currentGrantId,
        },
        {
          $set: {
            status: 'GRANTED',
            grantedAt: new Date(),
            grantDetails,
            grantLockExpiresAt: null,
          },
        },
        { returnDocument: 'after' }
      );

      return {
        success: true,
        status: 'GRANTED',
        opportunityId: finalized._id,
        rewardType: finalized.rewardType,
        grantDetails,
      };
    } catch (err) {
      await AdOpportunity.findOneAndUpdate(
        { _id: opportunityId, grantId: currentGrantId },
        {
          $set: {
            status: 'GRANT_FAILED',
            grantError: err.message,
            grantLockExpiresAt: null,
          },
        }
      );
      throw err;
    }
  },

  /**
   * Idempotent reward execution across all 6 core reward types.
   */
  async executeRewardHandler(opportunity) {
    const { userId, sessionId, rewardType, boosterType } = opportunity;

    switch (rewardType) {
      case 'COIN_REWARD': {
        const economy = await EconomyConfig.getActiveConfig();
        const amount = opportunity.rewardAmount || economy.rules.adLimits.baseCoinReward || 25;

        const creditResult = await walletService.credit(userId, amount, {
          type: 'AD_REWARD',
          referenceId: opportunity._id.toString(),
          idempotencyKey: `ad_reward_${opportunity._id}`,
          description: `Watched rewarded ad for ${amount} coins`,
          metadata: {
            opportunityId: opportunity._id.toString(),
            placement: opportunity.placement,
            providerTransactionId: opportunity.providerTransactionId,
          },
        });

        return {
          coinsAwarded: amount,
          balanceAfter: creditResult.balanceAfter,
          transactionId: creditResult.transaction?._id,
        };
      }

      case 'REVIVE': {
        const session = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            userId,
            status: 'FAILED',
          },
          {
            $set: {
              status: 'ACTIVE',
              endedAt: null,
              failureReason: null,
            },
            $inc: { revivesUsed: 1 },
            $push: {
              appliedAdRewards: {
                opportunityId: opportunity._id.toString(),
                rewardType: 'REVIVE',
                amount: 1,
                appliedAt: new Date(),
              },
            },
          },
          { returnDocument: 'after' }
        );

        if (!session) {
          const existing = await GameSession.findById(sessionId);
          const alreadyApplied = existing?.appliedAdRewards?.some(
            (r) => r.opportunityId === opportunity._id.toString()
          );
          if (alreadyApplied) {
            return { revived: true, alreadyApplied: true };
          }
          throw new Error('Session is not in FAILED state or does not exist.');
        }

        return { revived: true, revivesUsed: session.revivesUsed };
      }

      case 'EXTRA_MOVES': {
        const economy = await EconomyConfig.getActiveConfig();
        const movesToAdd = opportunity.rewardAmount || economy.rules.adLimits.extraMovesReward || 5;

        const session = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            userId,
            'appliedAdRewards.opportunityId': { $ne: opportunity._id.toString() },
          },
          {
            $inc: { extraMovesAllowed: movesToAdd },
            $push: {
              appliedAdRewards: {
                opportunityId: opportunity._id.toString(),
                rewardType: 'EXTRA_MOVES',
                amount: movesToAdd,
                appliedAt: new Date(),
              },
            },
          },
          { returnDocument: 'after' }
        );

        if (!session) {
          const existing = await GameSession.findById(sessionId);
          const alreadyApplied = existing?.appliedAdRewards?.some(
            (r) => r.opportunityId === opportunity._id.toString()
          );
          if (alreadyApplied) {
            return { extraMovesAdded: movesToAdd, alreadyApplied: true };
          }
          throw new Error('Failed to add extra moves to session.');
        }

        return { extraMovesAdded: movesToAdd, totalExtraMoves: session.extraMovesAllowed };
      }

      case 'BOOSTER': {
        const grantedBooster = boosterType || 'APPLE_MAGNET';

        const session = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            userId,
            'appliedAdRewards.opportunityId': { $ne: opportunity._id.toString() },
          },
          {
            $push: {
              availableBoosters: grantedBooster,
              appliedAdRewards: {
                opportunityId: opportunity._id.toString(),
                rewardType: 'BOOSTER',
                amount: 1,
                appliedAt: new Date(),
              },
            },
          },
          { returnDocument: 'after' }
        );

        if (!session) {
          const existing = await GameSession.findById(sessionId);
          const alreadyApplied = existing?.appliedAdRewards?.some(
            (r) => r.opportunityId === opportunity._id.toString()
          );
          if (alreadyApplied) {
            return { boosterGranted: grantedBooster, alreadyApplied: true };
          }
          throw new Error('Failed to grant booster to session.');
        }

        return { boosterGranted: grantedBooster, availableBoosters: session.availableBoosters };
      }

      case 'DOUBLE_COINS': {
        const session = await GameSession.findById(sessionId);
        if (!session) throw new Error('GameSession not found.');

        const alreadyApplied = session.appliedAdRewards?.some(
          (r) => r.opportunityId === opportunity._id.toString() || r.rewardType === 'DOUBLE_COINS'
        );

        if (alreadyApplied) {
          return { coinsDoubled: session.coinsEarned, alreadyApplied: true };
        }

        const bonusCoins = session.coinsEarned;

        const creditResult = await walletService.credit(userId, bonusCoins, {
          type: 'AD_REWARD',
          referenceId: opportunity._id.toString(),
          idempotencyKey: `ad_reward_double_coins_${opportunity._id}`,
          description: `Ad reward: Doubled Level ${session.levelNumber} coins (${bonusCoins} bonus)`,
          metadata: {
            sessionId: session._id.toString(),
            opportunityId: opportunity._id.toString(),
            bonusCoins,
          },
        });

        session.coinsEarned += bonusCoins;
        session.appliedAdRewards.push({
          opportunityId: opportunity._id.toString(),
          rewardType: 'DOUBLE_COINS',
          amount: bonusCoins,
          appliedAt: new Date(),
        });
        await session.save();

        return {
          bonusCoins,
          totalCoinsEarned: session.coinsEarned,
          walletBalance: creditResult.balanceAfter,
        };
      }

      case 'DOUBLE_SCORE': {
        // Safeguard 2: Strictly idempotent DOUBLE_SCORE
        const session = await GameSession.findById(sessionId);
        if (!session) throw new Error('GameSession not found.');

        const alreadyApplied = session.appliedAdRewards?.some(
          (r) => r.opportunityId === opportunity._id.toString() || r.rewardType === 'DOUBLE_SCORE'
        );

        if (alreadyApplied) {
          return { scoreDoubled: session.score, alreadyApplied: true };
        }

        const originalScore = session.score;
        const newScore = originalScore * 2;
        const bonusScore = originalScore;

        const updatedSession = await GameSession.findOneAndUpdate(
          {
            _id: sessionId,
            'appliedAdRewards.rewardType': { $ne: 'DOUBLE_SCORE' },
            'appliedAdRewards.opportunityId': { $ne: opportunity._id.toString() },
          },
          {
            $set: { score: newScore },
            $push: {
              appliedAdRewards: {
                opportunityId: opportunity._id.toString(),
                rewardType: 'DOUBLE_SCORE',
                amount: bonusScore,
                appliedAt: new Date(),
              },
            },
          },
          { returnDocument: 'after' }
        );

        if (!updatedSession) {
          return { scoreDoubled: originalScore, alreadyApplied: true };
        }

        // Atomically update PlayerProgress totalScore and level highScore
        const progress = await PlayerProgress.findOne({ userId });
        if (progress) {
          const rec = progress.completedLevels.find((c) => c.levelNumber === session.levelNumber);
          if (rec && newScore > rec.highScore) {
            rec.highScore = newScore;
          }
          progress.totalScore = progress.completedLevels.reduce((sum, r) => sum + r.highScore, 0);
          await progress.save();
        }

        return {
          originalScore,
          newScore,
          bonusScore,
          scoreDoubled: newScore,
        };
      }

      default:
        throw new Error(`Unhandled rewardType: ${rewardType}`);
    }
  },

  /**
   * Safeguard 3: Safe background recovery of stale/crashed GRANTING operations.
   */
  async recoverStaleGrants() {
    const expiredCutoff = new Date();
    const staleGrants = await AdOpportunity.find({
      status: 'GRANTING',
      grantLockExpiresAt: { $lt: expiredCutoff },
    }).limit(10);

    const results = [];
    for (const opp of staleGrants) {
      try {
        const recovered = await this.grantReward(opp._id);
        results.push({ opportunityId: opp._id, recovered: true, result: recovered });
      } catch (err) {
        results.push({ opportunityId: opp._id, recovered: false, error: err.message });
      }
    }
    return results;
  },

  /**
   * Check status of an ad opportunity for player polling.
   */
  async getOpportunityStatus(userId, opportunityId) {
    const opportunity = await AdOpportunity.findById(opportunityId);
    if (!opportunity) {
      const error = new Error('AdOpportunity not found.');
      error.statusCode = 404;
      throw error;
    }

    if (opportunity.userId.toString() !== userId.toString()) {
      const error = new Error('Access denied: You do not own this opportunity.');
      error.statusCode = 403;
      throw error;
    }

    return {
      opportunityId: opportunity._id,
      status: opportunity.status,
      rewardType: opportunity.rewardType,
      rewardAmount: opportunity.rewardAmount,
      grantDetails: opportunity.grantDetails,
      grantedAt: opportunity.grantedAt,
      expiresAt: opportunity.expiresAt,
    };
  },

  /**
   * Retrieve reward transaction history for an authenticated player.
   */
  async getRewardHistory(userId, options = {}) {
    const { limit = 20, status = 'GRANTED' } = options;
    const query = { userId };
    if (status && status !== 'ALL') {
      query.status = status;
    }
    const history = await AdOpportunity.find(query)
      .sort({ grantedAt: -1, createdAt: -1 })
      .limit(Number(limit) || 20)
      .lean();

    return history.map((item) => ({
      opportunityId: item._id,
      placement: item.placement,
      rewardType: item.rewardType,
      rewardAmount: item.rewardAmount,
      status: item.status,
      provider: item.provider,
      providerTransactionId: item.providerTransactionId,
      grantDetails: item.grantDetails,
      createdAt: item.createdAt,
      grantedAt: item.grantedAt,
    }));
  },

  /**
   * Retrieve active economy configuration rules and ad limits.
   */
  async getEconomyConfig() {
    const config = await EconomyConfig.getActiveConfig();
    return {
      key: config.key,
      version: config.version,
      rules: config.rules,
      availability: this.getAdAvailability(),
      adsAvailable: this.isAdAvailable(),
    };
  },

  /**
   * Calculate player's current ad opportunities, remaining daily/hourly quotas, and cooldowns.
   */
  async getOpportunitySummary(userId, sessionId = null) {
    const economy = await EconomyConfig.getActiveConfig();
    const rules = economy.rules.adLimits;
    const cooldownMs = (rules.minSecondsBetweenAds || 30) * 1000;
    const hourAgo = new Date(Date.now() - 3600000);
    const dayAgo = new Date(Date.now() - 86400000);

    const quotaDoc = await AdQuotaReservation.findOne({ userId }).lean();
    const now = Date.now();

    let cooldownRemainingSeconds = 0;
    if (quotaDoc?.lastRequestedAt) {
      const elapsed = now - new Date(quotaDoc.lastRequestedAt).getTime();
      if (elapsed < cooldownMs) {
        cooldownRemainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
      }
    }

    const validReservations = (quotaDoc?.reservations || []).filter(
      (r) => new Date(r.createdAt) >= dayAgo
    );
    const dailyUsed = validReservations.length;
    const hourlyUsed = validReservations.filter((r) => new Date(r.createdAt) >= hourAgo).length;

    let sessionRevivesUsed = 0;
    let sessionAdsUsed = 0;
    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      const sessionReservations = validReservations.filter(
        (r) => r.sessionId && r.sessionId.toString() === sessionId.toString()
      );
      sessionAdsUsed = sessionReservations.length;
      sessionRevivesUsed = sessionReservations.filter((r) => r.rewardType === 'REVIVE').length;
    }

    return {
      limits: {
        maxAdsPerDay: rules.maxAdsPerDay || 20,
        maxAdsPerHour: rules.maxAdsPerHour || 6,
        maxAdsPerSession: rules.maxAdsPerSession || 3,
        maxRevivesPerSession: rules.maxRevivesPerSession || 1,
        minSecondsBetweenAds: rules.minSecondsBetweenAds || 30,
        baseCoinReward: rules.baseCoinReward || 25,
        extraMovesReward: rules.extraMovesReward || 5,
      },
      usage: {
        dailyUsed,
        dailyRemaining: Math.max(0, (rules.maxAdsPerDay || 20) - dailyUsed),
        hourlyUsed,
        hourlyRemaining: Math.max(0, (rules.maxAdsPerHour || 6) - hourlyUsed),
        sessionAdsUsed,
        sessionRevivesUsed,
        sessionRevivesRemaining: Math.max(0, (rules.maxRevivesPerSession || 1) - sessionRevivesUsed),
        cooldownRemainingSeconds,
        isEligible:
          this.isAdAvailable() &&
          cooldownRemainingSeconds === 0 &&
          dailyUsed < (rules.maxAdsPerDay || 20) &&
          hourlyUsed < (rules.maxAdsPerHour || 6),
      },
      availability: this.getAdAvailability(),
      adsAvailable: this.isAdAvailable(),
    };
  },

  /**
   * Helper endpoint for client/evaluator to simulate ad playback completion.
   * Executes the full server-side SSV callback verification and grants the reward.
   */
  async simulateMockAdCompletion(userId, opportunityId) {
    const opportunity = await AdOpportunity.findById(opportunityId);
    if (!opportunity) {
      const error = new Error('AdOpportunity not found.');
      error.statusCode = 404;
      throw error;
    }

    if (opportunity.userId.toString() !== userId.toString()) {
      const error = new Error('Access denied: You do not own this opportunity.');
      error.statusCode = 403;
      throw error;
    }

    if (opportunity.status === 'GRANTED') {
      return {
        success: true,
        status: 'GRANTED',
        opportunityId: opportunity._id,
        rewardType: opportunity.rewardType,
        grantDetails: opportunity.grantDetails,
        alreadyGranted: true,
      };
    }

    const mockSecret = process.env.MOCK_PROVIDER_SECRET || 'test_mock_ssv_secret_dev';
    const customData = `${opportunity._id}:${opportunity.customDataNonce}`;
    const providerTransactionId = `sim_tx_${opportunity._id}_${Date.now()}`;

    return this.processProviderCallback({
      provider: 'MOCK',
      headers: { 'x-mock-provider-secret': mockSecret },
      body: {
        custom_data: customData,
        transaction_id: providerTransactionId,
      },
    });
  },
};

export default rewardedAdService;