/**
 * @file test-level-api.js
 * @description Real HTTP integration test runner testing public and administrator Level API routes.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import connectDB from './src/config/database.js';
import Level from './src/models/Level.js';
import app from './src/app.js';

let passed = 0;
let failed = 0;

function report(testNum, description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${testNum}. ${description}`);
    if (details) console.log(`       └─ Info: ${details}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testNum}. ${description}`);
    console.error(`       └─ Reason: ${details || 'Condition failed'}`);
    failed++;
  }
}

async function runLevelApiTests() {
  console.log('=== Running Level Management API Integration Tests ===\n');

  let server = null;
  const TEST_LEVEL_NUM = 999;

  try {
    // 1. Connect to MongoDB Atlas
    if (typeof connectDB === 'function') {
      await connectDB();
    } else if (connectDB && typeof connectDB.connectDB === 'function') {
      await connectDB.connectDB();
    }

    // 2. Start ephemeral HTTP server on dynamically assigned free port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Helper: Dispatch genuine HTTP request through network stack
    const request = async (method, path, body = null, token = null) => {
      const headers = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const options = {
        method,
        headers,
      };
      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${path}`, options);
      const json = await response.json().catch(() => ({}));
      return {
        status: response.status,
        body: json,
        headers: response.headers,
      };
    };

    const secret = process.env.JWT_SECRET || 'test_jwt_secret';

    // Generate verified JWT credentials
    const adminId = new mongoose.Types.ObjectId().toString();
    const playerId = new mongoose.Types.ObjectId().toString();
    const adminToken = jwt.sign({ userId: adminId, role: 'admin' }, secret, { expiresIn: '1h' });
    const playerToken = jwt.sign({ userId: playerId, role: 'player' }, secret, { expiresIn: '1h' });

    // Ensure clean slate for test level
    await Level.deleteMany({ levelNumber: TEST_LEVEL_NUM });

    // -------------------------------------------------------------------------
    // TEST 1: Public list returns published levels
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', '/api/levels');
      report(
        1,
        'Public list returns published levels',
        res.status === 200 && Array.isArray(res.body.data) && res.body.success === true,
        `Status: ${res.status}, Count: ${res.body.count}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 2: Invalid level number returns 400
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', '/api/levels/abc');
      report(
        2,
        'Invalid level number returns 400',
        res.status === 400 && res.body.success === false,
        `Status: ${res.status}, Message: "${res.body.message}"`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 3: Missing level returns 404
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', `/api/levels/${TEST_LEVEL_NUM}`);
      report(
        3,
        'Missing level returns 404',
        res.status === 404 && res.body.success === false,
        `Status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 4: Unauthenticated creation returns 401
    // -------------------------------------------------------------------------
    {
      const res = await request('POST', '/api/levels', { levelNumber: TEST_LEVEL_NUM });
      report(
        4,
        'Unauthenticated creation returns 401',
        res.status === 401 && res.body.success === false,
        `Status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 5: Player creation returns 403
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'POST',
        '/api/levels',
        { levelNumber: TEST_LEVEL_NUM },
        playerToken
      );
      report(
        5,
        'Player creation returns 403',
        res.status === 403 && res.body.success === false,
        `Status: ${res.status}, Message: "${res.body.message}"`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 6: Admin creates a draft, with isActive: false enforced
    // -------------------------------------------------------------------------
    {
      const payload = {
        levelNumber: TEST_LEVEL_NUM,
        difficulty: 'easy',
        grid: { rows: 8, cols: 8 },
        wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
        apples: [{ x: 3, y: 1, type: 'normal' }],
        portal: { x: 6, y: 1 },
        moveLimit: 25,
        starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
        objective: 'reach_portal',
        isActive: true, // Malicious attempt to force active publication on create
      };
      const res = await request('POST', '/api/levels', payload, adminToken);
      report(
        6,
        'Admin creates a draft, with isActive: false enforced',
        res.status === 201 &&
          res.body.success === true &&
          res.body.data.isActive === false &&
          res.body.data.levelNumber === TEST_LEVEL_NUM,
        `Status: ${res.status}, Enforced isActive: ${res.body.data?.isActive}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 7: Public access cannot retrieve a draft
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', `/api/levels/${TEST_LEVEL_NUM}`);
      report(
        7,
        'Public access cannot retrieve a draft',
        res.status === 404 && res.body.success === false,
        `Status: ${res.status}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 8: Duplicate level number returns 409
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'POST',
        '/api/levels',
        { levelNumber: TEST_LEVEL_NUM },
        adminToken
      );
      report(
        8,
        'Duplicate level number returns 409',
        res.status === 409 && res.body.success === false,
        `Status: ${res.status}, Message: "${res.body.message}"`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 9: Level number cannot be changed
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'PUT',
        `/api/levels/${TEST_LEVEL_NUM}`,
        { levelNumber: 1000 },
        adminToken
      );
      report(
        9,
        'Level number cannot be changed',
        res.status === 400 &&
          res.body.success === false &&
          res.body.message.includes('levelNumber'),
        `Status: ${res.status}, Message: "${res.body.message}"`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 10: Draft fields can be updated
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'PUT',
        `/api/levels/${TEST_LEVEL_NUM}`,
        { moveLimit: 30 },
        adminToken
      );
      report(
        10,
        'Draft fields can be updated',
        res.status === 200 &&
          res.body.success === true &&
          res.body.data.moveLimit === 30,
        `moveLimit: ${res.body.data?.moveLimit}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 11: Unplayable level cannot be published (422)
    // -------------------------------------------------------------------------
    {
      // Enclose portal with wall barrier to make level unplayable
      await Level.updateOne(
        { levelNumber: TEST_LEVEL_NUM },
        {
          portal: { x: 7, y: 7 },
          obstacles: [
            { x: 6, y: 7, type: 'wall' },
            { x: 6, y: 6, type: 'wall' },
            { x: 7, y: 6, type: 'wall' },
          ],
        }
      );
      const res = await request(
        'POST',
        `/api/levels/${TEST_LEVEL_NUM}/publish`,
        {},
        adminToken
      );
      report(
        11,
        'Unplayable level cannot be published (422)',
        res.status === 422 &&
          res.body.success === false &&
          Array.isArray(res.body.errors) &&
          res.body.errors.length > 0,
        `Status: ${res.status}, Errors: ${res.body.errors?.join(' | ')}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 12: Playable level can be published
    // -------------------------------------------------------------------------
    {
      // Restore valid open path to portal
      await Level.updateOne(
        { levelNumber: TEST_LEVEL_NUM },
        { portal: { x: 6, y: 1 }, obstacles: [] }
      );
      const res = await request(
        'POST',
        `/api/levels/${TEST_LEVEL_NUM}/publish`,
        {},
        adminToken
      );
      report(
        12,
        'Playable level can be published',
        res.status === 200 &&
          res.body.success === true &&
          res.body.data.isActive === true,
        `Status: ${res.status}, isActive: ${res.body.data?.isActive}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 13: Published level is publicly accessible
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', `/api/levels/${TEST_LEVEL_NUM}`);
      report(
        13,
        'Published level is publicly accessible',
        res.status === 200 &&
          res.body.success === true &&
          res.body.data.levelNumber === TEST_LEVEL_NUM &&
          res.body.data.__v === undefined,
        `Status: ${res.status}, __v stripped: ${res.body.data?.__v === undefined}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 14: Published level cannot be edited before unpublishing
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'PUT',
        `/api/levels/${TEST_LEVEL_NUM}`,
        { moveLimit: 35 },
        adminToken
      );
      report(
        14,
        'Published level cannot be edited before unpublishing',
        res.status === 400 &&
          res.body.success === false &&
          res.body.message.includes('Unpublish the level before editing'),
        `Status: ${res.status}, Message: "${res.body.message}"`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 15: Admin can unpublish a level
    // -------------------------------------------------------------------------
    {
      const res = await request(
        'POST',
        `/api/levels/${TEST_LEVEL_NUM}/unpublish`,
        {},
        adminToken
      );
      report(
        15,
        'Admin can unpublish a level',
        res.status === 200 &&
          res.body.success === true &&
          res.body.data.isActive === false,
        `Status: ${res.status}, isActive: ${res.body.data?.isActive}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 16: Unpublished level is no longer publicly accessible
    // -------------------------------------------------------------------------
    {
      const res = await request('GET', `/api/levels/${TEST_LEVEL_NUM}`);
      report(
        16,
        'Unpublished level is no longer publicly accessible',
        res.status === 404 && res.body.success === false,
        `Status: ${res.status}`
      );
    }
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    // Deterministic Cleanup: Delete test data, close ephemeral server, close DB
    try {
      await Level.deleteMany({ levelNumber: TEST_LEVEL_NUM });
    } catch (e) {
      console.warn('Warning: Failed to clean up test level document:', e.message);
    }

    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }

  console.log('\n=============================================================');
  console.log(
    `Level API Integration Tests Completed: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`
  );
  console.log('=============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runLevelApiTests();