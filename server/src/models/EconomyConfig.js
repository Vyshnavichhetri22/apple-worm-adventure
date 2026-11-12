import mongoose from 'mongoose';

const economyConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'active_economy_config',
    },
    rules: {
      levelCompletionBase: {
        type: Number,
        default: 25,
        min: 0,
        validate: Number.isInteger,
      },
      goldenAppleReward: {
        type: Number,
        default: 10,
        min: 0,
        validate: Number.isInteger,
      },
      threeStarBonus: {
        type: Number,
        default: 20,
        min: 0,
        validate: Number.isInteger,
      },
      twoStarBonus: {
        type: Number,
        default: 10,
        min: 0,
        validate: Number.isInteger,
      },
      oneStarBonus: {
        type: Number,
        default: 5,
        min: 0,
        validate: Number.isInteger,
      },
      dailyChallengeReward: {
        type: Number,
        default: 100,
        min: 0,
        validate: Number.isInteger,
      },
      adReward: {
        type: Number,
        default: 50,
        min: 0,
        validate: Number.isInteger,
      },
      hintPurchaseCost: {
        type: Number,
        default: 50,
        min: 0,
        validate: Number.isInteger,
      },
      undoPurchaseCost: {
        type: Number,
        default: 40,
        min: 0,
        validate: Number.isInteger,
      },
      boosterPurchaseCost: {
        type: Number,
        default: 100,
        min: 0,
        validate: Number.isInteger,
      },
      cosmeticPurchaseCost: {
        type: Number,
        default: 500,
        min: 0,
        validate: Number.isInteger,
      },
      adLimits: {
        maxAdsPerSession: {
          type: Number,
          default: 3,
          min: 1,
          validate: Number.isInteger,
        },
        maxAdsPerHour: {
          type: Number,
          default: 6,
          min: 1,
          validate: Number.isInteger,
        },
        maxAdsPerDay: {
          type: Number,
          default: 20,
          min: 1,
          validate: Number.isInteger,
        },
        minSecondsBetweenAds: {
          type: Number,
          default: 30,
          min: 0,
          validate: Number.isInteger,
        },
        maxRevivesPerSession: {
          type: Number,
          default: 1,
          min: 1,
          validate: Number.isInteger,
        },
        maxCoinRewardCap: {
          type: Number,
          default: 100,
          min: 1,
          validate: Number.isInteger,
        },
        baseCoinReward: {
          type: Number,
          default: 25,
          min: 1,
          validate: Number.isInteger,
        },
        extraMovesReward: {
          type: Number,
          default: 5,
          min: 1,
          validate: Number.isInteger,
        },
      },
    },
    version: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Returns the active singleton economy configuration document, creating it with defaults if absent.
 */
economyConfigSchema.statics.getActiveConfig = async function () {
  let config = await this.findOne({ key: 'active_economy_config', isActive: true });
  if (!config) {
    config = await this.create({
      key: 'active_economy_config',
      version: 1,
      isActive: true,
      rules: {
        levelCompletionBase: 25,
        goldenAppleReward: 10,
        threeStarBonus: 20,
        twoStarBonus: 10,
        oneStarBonus: 5,
        dailyChallengeReward: 100,
        adReward: 50,
        hintPurchaseCost: 50,
        undoPurchaseCost: 40,
        boosterPurchaseCost: 100,
        cosmeticPurchaseCost: 500,
        adLimits: {
          maxAdsPerSession: 3,
          maxAdsPerHour: 6,
          maxAdsPerDay: 20,
          minSecondsBetweenAds: 30,
          maxRevivesPerSession: 1,
          maxCoinRewardCap: 100,
          baseCoinReward: 25,
          extraMovesReward: 5,
        },
      },
    });
  } else if (!config.rules.adLimits) {
    config.rules.adLimits = {
      maxAdsPerSession: 3,
      maxAdsPerHour: 6,
      maxAdsPerDay: 20,
      minSecondsBetweenAds: 30,
      maxRevivesPerSession: 1,
      maxCoinRewardCap: 100,
      baseCoinReward: 25,
      extraMovesReward: 5,
    };
    await config.save();
  }
  return config;
};

const EconomyConfig =
  mongoose.models.EconomyConfig || mongoose.model('EconomyConfig', economyConfigSchema);

export default EconomyConfig;