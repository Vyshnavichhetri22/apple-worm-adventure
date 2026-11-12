import mongoose from 'mongoose';

const reservationEntrySchema = new mongoose.Schema(
  {
    opportunityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    rewardType: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const adQuotaReservationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    lastRequestedAt: {
      type: Date,
      default: null,
      index: true,
    },
    reservations: {
      type: [reservationEntrySchema],
      default: [],
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Atomically reserve an ad quota slot using optimistic concurrency control (OCC).
 * Rejects if cooldown, hourly, daily, session, or revive limits are violated.
 */
adQuotaReservationSchema.statics.reserveQuota = async function ({
  userId,
  sessionId = null,
  rewardType,
  opportunityId,
  rules,
}) {
  const maxAttempts = 3;
  const cooldownMs = (rules.minSecondsBetweenAds || 30) * 1000;
  const hourAgo = new Date(Date.now() - 3600000);
  const dayAgo = new Date(Date.now() - 86400000);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let quotaDoc = await this.findOne({ userId });
    if (!quotaDoc) {
      try {
        quotaDoc = await this.create({
          userId,
          lastRequestedAt: null,
          reservations: [],
          version: 0,
        });
      } catch (err) {
        if (err.code === 11000) {
          quotaDoc = await this.findOne({ userId });
        } else {
          throw err;
        }
      }
    }

    const now = Date.now();

    // 1. Cooldown validation
    if (quotaDoc.lastRequestedAt) {
      const elapsed = now - new Date(quotaDoc.lastRequestedAt).getTime();
      if (elapsed < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
        const error = new Error(`Ad cooldown active. Please wait ${remainingSeconds}s before requesting another ad.`);
        error.statusCode = 429;
        throw error;
      }
    }

    // 2. Filter active sliding windows
    const validReservations = (quotaDoc.reservations || []).filter(
      (r) => new Date(r.createdAt) >= dayAgo
    );

    // 3. Hourly quota validation
    const hourlyCount = validReservations.filter((r) => new Date(r.createdAt) >= hourAgo).length;
    if (hourlyCount >= (rules.maxAdsPerHour || 6)) {
      const error = new Error(`Hourly ad limit reached (${rules.maxAdsPerHour || 6} per hour). Please try again later.`);
      error.statusCode = 429;
      throw error;
    }

    // 4. Daily quota validation
    const dailyCount = validReservations.length;
    if (dailyCount >= (rules.maxAdsPerDay || 20)) {
      const error = new Error(`Daily ad limit reached (${rules.maxAdsPerDay || 20} per day). Come back tomorrow!`);
      error.statusCode = 429;
      throw error;
    }

    // 5. Session quota validation
    if (sessionId) {
      const sessionCount = validReservations.filter(
        (r) => r.sessionId && r.sessionId.toString() === sessionId.toString()
      ).length;
      if (sessionCount >= (rules.maxAdsPerSession || 3)) {
        const error = new Error(`Session ad limit reached (${rules.maxAdsPerSession || 3} ads per session).`);
        error.statusCode = 429;
        throw error;
      }

      // 6. Revive cap per session
      if (rewardType === 'REVIVE') {
        const reviveCount = validReservations.filter(
          (r) =>
            r.sessionId &&
            r.sessionId.toString() === sessionId.toString() &&
            r.rewardType === 'REVIVE'
        ).length;
        if (reviveCount >= (rules.maxRevivesPerSession || 1)) {
          const error = new Error(`Revive limit reached for this session (${rules.maxRevivesPerSession || 1} max).`);
          error.statusCode = 400;
          throw error;
        }
      }
    }

    // 7. Atomic OCC update
    const filter = {
      userId,
      version: quotaDoc.version,
    };

    if (quotaDoc.lastRequestedAt) {
      filter.lastRequestedAt = { $lte: new Date(now - cooldownMs) };
    }

    const newReservation = {
      opportunityId,
      sessionId: sessionId || null,
      rewardType,
      createdAt: new Date(now),
    };

    const updated = await this.findOneAndUpdate(
      filter,
      {
        $set: {
          lastRequestedAt: new Date(now),
          reservations: validReservations.concat([newReservation]),
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' }
    );

    if (updated) {
      return updated;
    }
  }

  const error = new Error('Concurrent ad reservation conflict. Please try again.');
  error.statusCode = 429;
  throw error;
};

const AdQuotaReservation =
  mongoose.models.AdQuotaReservation ||
  mongoose.model('AdQuotaReservation', adQuotaReservationSchema);

export default AdQuotaReservation;