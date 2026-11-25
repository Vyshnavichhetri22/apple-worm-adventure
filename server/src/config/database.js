import mongoose from "mongoose";

/**
 * Cached connection promise across serverless invocations.
 * Prevents concurrent connection attempts during cold starts.
 */
let cachedPromise = null;

const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Sanitizes error messages to prevent leaking connection strings, credentials, or hosts.
 *
 * @param {string} message - Raw error message.
 * @returns {string} Sanitized message safe for logs and client responses.
 */
export const sanitizeErrorMessage = (message) => {
  if (typeof message !== 'string') return 'Unknown database error';
  return message.replace(/mongodb(\+srv)?:\/\/[^\s"'`]+/gi, (matched) => {
    try {
      const parsed = new URL(matched);
      return `${parsed.protocol}//***:***@${parsed.host}${parsed.pathname}`;
    } catch {
      return 'mongodb://[REDACTED]';
    }
  });
};

/**
 * Returns safe, high-level status of the database connection without exposing secrets.
 *
 * @returns {{ connected: boolean, readyState: number, state: string }}
 */
export const getDatabaseStatus = () => {
  const readyState = mongoose.connection ? mongoose.connection.readyState : 0;
  return {
    connected: readyState === 1,
    readyState,
    state: DB_STATES[readyState] || 'unknown',
  };
};

/**
 * Clears the cached connection promise (useful for tests or handling fatal disconnects).
 */
export const resetConnectionCache = () => {
  cachedPromise = null;
};

/**
 * Disconnects from MongoDB and clears the cached promise cleanly.
 */
export const disconnectDB = async () => {
  cachedPromise = null;
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

// Reset cached promise if Mongoose disconnects unexpectedly
if (mongoose.connection) {
  mongoose.connection.on('disconnected', () => {
    cachedPromise = null;
  });
  mongoose.connection.on('error', (err) => {
    cachedPromise = null;
    console.error('[DATABASE] Mongoose connection error event:', sanitizeErrorMessage(err?.message));
  });
}

/**
 * Establishes or reuses a Mongoose connection to MongoDB.
 *
 * Serverless-safe:
 *  1. Reuses an existing open connection (readyState === 1).
 *  2. Reuses an in-progress connection promise during concurrent cold-start requests.
 *  3. Resets cachedPromise on failure so subsequent requests can retry.
 *  4. Does NOT call process.exit(1), allowing Express error handling in serverless lambdas.
 *  5. Preserves staging safety checks against accidental production targeting.
 *
 * @param {Object} [options={}] - Optional overrides for testing or specific timeouts.
 * @param {string} [options.uri] - Explicit MongoDB URI override (defaults to process.env.MONGODB_URI).
 * @param {number} [options.serverSelectionTimeoutMS] - Timeout for server selection in ms (default: 5000).
 * @param {number} [options.maxPoolSize] - Connection pool size (default: 10 for serverless).
 * @param {Object} [options.mongooseOptions] - Additional Mongoose connection options.
 * @returns {Promise<typeof mongoose>}
 */
export const connectDB = async (options = {}) => {
  // 1. Reuse existing open connection
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  // 2. Reuse in-progress connection promise to guard against concurrent cold-start races
  if (cachedPromise) {
    return cachedPromise;
  }

  // 3. Initiate connection and cache the promise
  cachedPromise = (async () => {
    try {
      const mongoUri = options.uri || process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI is not defined.');
      }

      // Safety gate: If running in staging, strictly fail closed against production
      if (process.env.NODE_ENV === 'staging') {
        if (!mongoUri.includes('/apple_worm_staging')) {
          throw new Error('SAFETY REFUSAL: NODE_ENV is staging, but target database in MONGODB_URI is not "apple_worm_staging"!');
        }
        if (mongoUri.includes('apple_worm_adventure')) {
          throw new Error('SAFETY REFUSAL: Production database detected while running in staging mode!');
        }
      }

      const connectionOpts = {
        serverSelectionTimeoutMS: options.serverSelectionTimeoutMS || 5000,
        maxPoolSize: options.maxPoolSize || 10,
        socketTimeoutMS: options.socketTimeoutMS || 45000,
        ...options.mongooseOptions,
      };

      await mongoose.connect(mongoUri, connectionOpts);

      const dbName = mongoose.connection.name || 'default';
      console.log(`[DATABASE] MongoDB connected successfully to database: "${dbName}"`);

      return mongoose;
    } catch (error) {
      // Clear cached promise on failure so subsequent requests can retry
      cachedPromise = null;
      console.error('[DATABASE] Connection attempt failed:', sanitizeErrorMessage(error.message));
      throw error;
    }
  })();

  return cachedPromise;
};

export default connectDB;
