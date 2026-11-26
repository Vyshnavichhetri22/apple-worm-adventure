/**
 * server/test/serverless_database_connection.test.js
 *
 * Comprehensive Test Suite for Serverless-Safe MongoDB Connection Lifecycle:
 *  1. Successful connection establishment.
 *  2. Reusing existing open connection (readyState === 1).
 *  3. In-flight promise reuse during concurrent cold-start requests.
 *  4. Connection failure handling, cache invalidation, and retry ability.
 *  5. Missing MONGODB_URI handling (fail-closed without process.exit).
 *  6. Database middleware safety, error sanitization, and 503 response.
 *  7. Database-dependent route execution gating.
 *  8. Health check status reporting and non-misleading response.
 *  9. Sensitive credential redaction in logs and errors.
 * 10. Express application pipeline integration with ephemeral server.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

import {
  connectDB,
  disconnectDB,
  resetConnectionCache,
  getDatabaseStatus,
  sanitizeErrorMessage,
} from '../src/config/database.js';
import databaseMiddleware from '../src/middleware/databaseMiddleware.js';
import app from '../src/app.js';

describe('Serverless MongoDB Connection Lifecycle Suite', () => {
  const originalEnv = { ...process.env };
  let originalReadyStateDescriptor;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConnectionCache();
    originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    resetConnectionCache();
    if (originalReadyStateDescriptor) {
      Object.defineProperty(mongoose.connection, 'readyState', originalReadyStateDescriptor);
    } else {
      delete mongoose.connection.readyState;
    }
    mock.reset();
  });

  // =========================================================================
  // 1. Connection Establishment & Caching
  // =========================================================================
  describe('1. Connection Establishment & State Caching', () => {
    it('1.1. Connects successfully when MONGODB_URI is provided', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';

      const connectMock = mock.method(mongoose, 'connect', async () => {
        return mongoose;
      });

      const conn = await connectDB();
      assert.strictEqual(conn, mongoose);
      assert.strictEqual(connectMock.mock.calls.length, 1);
      assert.strictEqual(connectMock.mock.calls[0].arguments[0], 'mongodb://127.0.0.1:27017/apple_worm_test');
    });

    it('1.2. Reuses existing established connection when readyState === 1', async () => {
      // Simulate connection already established
      Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

      const connectMock = mock.method(mongoose, 'connect', async () => {
        assert.fail('mongoose.connect should not be called when readyState === 1');
      });

      const conn = await connectDB();
      assert.strictEqual(conn, mongoose);
      assert.strictEqual(connectMock.mock.calls.length, 0);
    });

    it('1.3. Reuses in-flight promise for concurrent requests (prevents cold-start race conditions)', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      let resolveConnection;
      const connectMock = mock.method(mongoose, 'connect', () => {
        return new Promise((resolve) => {
          resolveConnection = () => {
            Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
            resolve(mongoose);
          };
        });
      });

      // Fire 5 concurrent connection requests simultaneously
      const req1 = connectDB();
      const req2 = connectDB();
      const req3 = connectDB();
      const req4 = connectDB();
      const req5 = connectDB();

      // Only one mongoose.connect call should be in flight
      assert.strictEqual(connectMock.mock.calls.length, 1);

      // Resolve the single in-flight connection
      resolveConnection();

      const [res1, res2, res3, res4, res5] = await Promise.all([req1, req2, req3, req4, req5]);
      assert.strictEqual(res1, mongoose);
      assert.strictEqual(res2, mongoose);
      assert.strictEqual(res3, mongoose);
      assert.strictEqual(res4, mongoose);
      assert.strictEqual(res5, mongoose);
      assert.strictEqual(connectMock.mock.calls.length, 1);
    });
  });

  // =========================================================================
  // 2. Failure Handling, Cache Invalidation & Retries
  // =========================================================================
  describe('2. Failure Handling, Cache Invalidation & Retries', () => {
    it('2.1. Throws error and does NOT call process.exit when MONGODB_URI is missing', async () => {
      delete process.env.MONGODB_URI;

      const exitMock = mock.method(process, 'exit', () => {
        assert.fail('process.exit must never be called during serverless connection check');
      });

      await assert.rejects(
        async () => connectDB(),
        {
          name: 'Error',
          message: 'MONGODB_URI is not defined.',
        }
      );

      assert.strictEqual(exitMock.mock.calls.length, 0);
    });

    it('2.2. Resets cachedPromise after failure so subsequent requests can retry', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      let attempt = 0;
      mock.method(mongoose, 'connect', async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('Connection refused (temporary)');
        }
        Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
        return mongoose;
      });

      // First attempt fails
      await assert.rejects(
        async () => connectDB(),
        { message: 'Connection refused (temporary)' }
      );

      // Second attempt must NOT be stuck on the failed promise; it should retry
      const conn = await connectDB();
      assert.strictEqual(conn, mongoose);
      assert.strictEqual(attempt, 2);
    });

    it('2.3. Strictly enforces staging safety gate against production URI in staging mode', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_adventure';

      await assert.rejects(
        async () => connectDB(),
        /SAFETY REFUSAL: NODE_ENV is staging, but target database in MONGODB_URI is not "apple_worm_staging"/
      );
    });
  });

  // =========================================================================
  // 3. Database Middleware Safety & Gateway Protection
  // =========================================================================
  describe('3. Database Middleware Safety & Gateway Protection', () => {
    it('3.1. Calls next() when database connection succeeds', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

      let nextCalled = false;
      const req = { method: 'POST', originalUrl: '/api/auth/login' };
      const res = {};
      const next = () => { nextCalled = true; };

      await databaseMiddleware(req, res, next);
      assert.strictEqual(nextCalled, true);
    });

    it('3.2. Returns HTTP 503 and does not call next() when connection fails', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      mock.method(mongoose, 'connect', async () => {
        throw new Error('Atlas network timeout');
      });

      let nextCalled = false;
      let statusCode = null;
      let responseBody = null;

      const req = { method: 'POST', originalUrl: '/api/auth/login' };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        },
      };
      const next = () => { nextCalled = true; };

      await databaseMiddleware(req, res, next);

      assert.strictEqual(nextCalled, false, 'Route handler must never execute if connection fails');
      assert.strictEqual(statusCode, 503);
      assert.deepStrictEqual(responseBody, {
        success: false,
        message: 'Database service temporarily unavailable. Please try again shortly.',
      });
    });

    it('3.3. Sanitizes error messages to protect against credential leakage', () => {
      const mockUser = 'mock_admin_user';
      const mockPass = 'MockSecretPassword123';
      const mockHost = 'cluster0.mock-example.internal';
      const sensitiveMsg = `Failed to connect to mongodb+srv://${mockUser}:${mockPass}@${mockHost}/mock_db`;
      const sanitized = sanitizeErrorMessage(sensitiveMsg);

      assert.ok(!sanitized.includes(mockPass), 'Secret password must be redacted');
      assert.ok(!sanitized.includes(mockUser), 'Username must be redacted');
      assert.strictEqual(sanitized, `Failed to connect to mongodb+srv://***:***@${mockHost}/mock_db`);

      // Handles non-string safely
      assert.strictEqual(sanitizeErrorMessage(null), 'Unknown database error');
    });
  });

  // =========================================================================
  // 4. Status Reporting & Non-Misleading Health Status
  // =========================================================================
  describe('4. Status Reporting & Non-Misleading Health Status', () => {
    it('4.1. Reports disconnected state accurately when readyState === 0', () => {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
      const status = getDatabaseStatus();

      assert.strictEqual(status.connected, false);
      assert.strictEqual(status.readyState, 0);
      assert.strictEqual(status.state, 'disconnected');
    });

    it('4.2. Reports connected state accurately when readyState === 1', () => {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
      const status = getDatabaseStatus();

      assert.strictEqual(status.connected, true);
      assert.strictEqual(status.readyState, 1);
      assert.strictEqual(status.state, 'connected');
    });
  });

  // =========================================================================
  // 5. Express App Integration & Route Gating
  // =========================================================================
  describe('5. Express App Integration & Route Gating', () => {
    let testServer;
    let baseUrl;

    beforeEach(async () => {
      await new Promise((resolve) => {
        testServer = app.listen(0, '127.0.0.1', () => {
          const port = testServer.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (testServer && testServer.listening) {
        await new Promise((resolve) => testServer.close(resolve));
      }
    });

    it('5.1. Base health route GET /api/health succeeds without requiring database connection', async () => {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.status, 'degraded');
      assert.strictEqual(json.database.connected, false);
      assert.strictEqual(json.database.state, 'disconnected');
    });

    it('5.2. GET /api/health accurately reports healthy when database is connected', async () => {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });

      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.status, 'healthy');
      assert.strictEqual(json.database.connected, true);
      assert.strictEqual(json.database.state, 'connected');
    });

    it('5.3. Feature routes reject with 503 before executing if database connection fails', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      mock.method(mongoose, 'connect', async () => {
        throw new Error('Atlas network connection refused');
      });

      const res = await fetch(`${baseUrl}/api/levels`);
      assert.strictEqual(res.status, 503);

      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.message, 'Database service temporarily unavailable. Please try again shortly.');
    });

    it('5.4. Feature routes connect automatically on cold start when not yet connected', async () => {
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/apple_worm_test';
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

      let connectInvoked = false;
      mock.method(mongoose, 'connect', async () => {
        connectInvoked = true;
        Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
        return mongoose;
      });

      // GET /api/health?checkDb=true should invoke connectDB
      const res = await fetch(`${baseUrl}/api/health?checkDb=true`);
      assert.strictEqual(connectInvoked, true);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.database.connected, true);
    });
  });
});
