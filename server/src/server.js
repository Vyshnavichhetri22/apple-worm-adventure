import dns from 'node:dns';

// DNS workaround: Force Google and Cloudflare DNS to resolve Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Explicit environment loading: if ENV_FILE is set or NODE_ENV === 'staging', load explicit staging config
const explicitEnv = process.env.ENV_FILE || (process.env.NODE_ENV === 'staging' ? '.env.staging' : null);
if (explicitEnv) {
  const envPath = path.resolve(process.cwd(), explicitEnv);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
    console.log(`[CONFIG] Loaded explicit environment from: ${explicitEnv}`);
  } else {
    console.error(`[CONFIG] Refusing to start: Explicit environment file not found: ${envPath}`);
    process.exit(1);
  }
} else {
  dotenv.config();
}

import app from './app.js';
import databaseConnection from './config/database.js';
import {
  startScheduledRecovery,
  stopScheduledRecovery,
  drainAndStopRecovery,
  resetRecoveryState,
  isSchedulerActive,
} from './services/walletRecoveryService.js';

const PORT = process.env.PORT || 5000;
const GAME_NAME = process.env.GAME_NAME || 'APPLE WORM ADVENTURE';

let server = null;
let isStarted = false;
let isShuttingDown = false;

/**
 * Gracefully shuts down the HTTP server, recovery scheduler, and database connection.
 * Safe against repeated or concurrent invocations.
 * 
 * @param {string} [signal='SIGTERM']
 * @param {Object} [options={}]
 * @param {number} [options.recoveryTimeoutMs=10000] - Bounded timeout for draining active recovery
 * @returns {Promise<Object>} Shutdown summary
 */
export const gracefulShutdown = async (signal = 'SIGTERM', options = {}) => {
  const { recoveryTimeoutMs = 10000 } = options;
  if (isShuttingDown) {
    return { alreadyShuttingDown: true };
  }
  isShuttingDown = true;
  console.log(`[${GAME_NAME}] Received ${signal}. Starting graceful shutdown...`);

  let recoveryDrainResult = { stopped: false, drained: false, timedOut: false };

  // 1. Drain and stop background wallet recovery scheduler cleanly
  try {
    recoveryDrainResult = await drainAndStopRecovery(recoveryTimeoutMs);
    if (recoveryDrainResult.timedOut) {
      console.warn(
        `[${GAME_NAME}] Wallet recovery drain timed out after ${recoveryDrainResult.durationMs}ms.`
      );
    } else {
      console.log(
        `[${GAME_NAME}] Wallet recovery drained and stopped cleanly in ${recoveryDrainResult.durationMs}ms.`
      );
    }
  } catch (err) {
    console.error(`[${GAME_NAME}] Error draining recovery scheduler:`, err.message);
  }

  // 2. Close HTTP server if listening
  if (server && server.listening) {
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error(`[${GAME_NAME}] Error closing HTTP server:`, err.message);
        } else {
          console.log(`[${GAME_NAME}] HTTP server closed.`);
        }
        resolve();
      });
    });
  }

  // 3. Close MongoDB database connection
  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log(`[${GAME_NAME}] MongoDB connection closed.`);
    }
  } catch (err) {
    console.error(`[${GAME_NAME}] Error closing MongoDB connection:`, err.message);
  }

  isStarted = false;
  isShuttingDown = false;
  resetRecoveryState();
  console.log(`[${GAME_NAME}] Graceful shutdown completed.`);
  return {
    stopped: true,
    schedulerStopped: recoveryDrainResult.stopped,
    recoveryDrained: recoveryDrainResult.drained,
    recoveryTimedOut: recoveryDrainResult.timedOut,
  };
};

/**
 * Connect to MongoDB first, start listening for HTTP requests,
 * and start the background recovery scheduler once the database connection is ready.
 * 
 * @param {Object} [options={}]
 * @param {boolean} [options.startScheduler] - Explicit control over scheduler startup
 * @returns {Promise<http.Server>} Active HTTP server instance
 */
export const startServer = async (options = {}) => {
  const { startScheduler = process.env.NODE_ENV !== 'test' } = options;

  if (isStarted && server) {
    return server;
  }

  try {
    // 1. Establish database connection
    if (typeof databaseConnection === 'function') {
      await databaseConnection();
    } else if (databaseConnection && typeof databaseConnection.connectDB === 'function') {
      await databaseConnection.connectDB();
    }

    // 2. Start listening for HTTP requests
    server = app.listen(PORT, () => {
      console.log(`[${GAME_NAME}] Server listening on port ${PORT}`);
    });

    isStarted = true;

    // 3. Start background wallet recovery scheduler (only after DB connection ready)
    if (startScheduler) {
      const scheduleResult = startScheduledRecovery();
      if (scheduleResult.started) {
        console.log(
          `[${GAME_NAME}] Scheduled wallet recovery worker started (interval: ${scheduleResult.intervalMs}ms, batchSize: ${scheduleResult.batchSize}).`
        );
      }
    }

    return server;
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

/**
 * Returns the current running state of the server.
 */
export const getServerState = () => ({
  isStarted,
  isShuttingDown,
  isListening: Boolean(server && server.listening),
  isSchedulerActive: isSchedulerActive(),
});

/**
 * Resets the server running state (for test isolation).
 */
export const resetServerState = () => {
  server = null;
  isStarted = false;
  isShuttingDown = false;
};

// Determine if executed directly as application entry point
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));

if (isMainModule && process.env.NODE_ENV !== 'test') {
  // Register graceful shutdown listeners
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM').then(() => process.exit(0)));
  process.once('SIGINT', () => gracefulShutdown('SIGINT').then(() => process.exit(0)));

  startServer();
}

export default app;
