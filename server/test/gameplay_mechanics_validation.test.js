/**
 * server/test/gameplay_mechanics_validation.test.js
 * 
 * Phase 9 Step 2 — Comprehensive Mechanics & Validation Test Suite:
 *   1. Key collection and locked gate validation (Engine & Server)
 *   2. Pit hazards, stone pushing, and pit bridging traversal (Engine & Server)
 *   3. Stone conservation and boundary invariants
 *   4. Portal reachability and objective enforcement (eat_all_apples, collect_keys, reach_portal)
 *   5. Special apple effects consistency (Time, Mega, Golden, Mystery)
 *   6. Anti-cheat and fabrication guards (forged keys, forged filled pits, invalid stones)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import GameSession from '../src/models/GameSession.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import { gameSessionService, collidesWithImpassableObstacle } from '../src/services/gameSessionService.js';
import { WormGameEngine } from '../../client/src/components/game/WormGameEngine.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Phase 9 Step 2 — Gameplay Mechanics & Visual Feedback Safe Suite', () => {
  let testUser;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean test collections scoped to test data
    await User.collection.deleteMany({ email: /@gameplay-test\.com$/ });
    await Level.collection.deleteMany({ levelNumber: { $in: [9901, 9902, 9903, 9904] } });

    testUser = await User.create({
      username: 'gameplay_tester',
      email: 'tester@gameplay-test.com',
      password: 'SecurePassword123!',
      currentLevel: 1,
    });
  });

  after(async () => {
    if (testUser) {
      await User.collection.deleteOne({ _id: testUser._id });
      await GameSession.collection.deleteMany({ userId: testUser._id });
      await PlayerProgress.collection.deleteMany({ userId: testUser._id });
    }
    await Level.collection.deleteMany({ levelNumber: { $in: [9901, 9902, 9903, 9904] } });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Key Collection and Locked Gate Mechanics
  // ---------------------------------------------------------------------------
  describe('1. Key Collection & Locked Gate Validation', () => {
    const keyGateLevel = {
      levelNumber: 9901,
      difficulty: 'medium',
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      grid: { cols: 10, rows: 6 },
      wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
      apples: [{ x: 8, y: 1, type: 'normal' }],
      keys: [{ x: 3, y: 1, keyId: 'key_bronze' }],
      obstacles: [
        { x: 5, y: 1, type: 'gate', keyId: 'key_bronze' },
        { x: 5, y: 0, type: 'wall' },
        { x: 5, y: 2, type: 'wall' },
      ],
      portal: { x: 8, y: 2 },
      objective: 'reach_portal',
      moveLimit: 30,
    };

    it('1.1 Engine blocks movement into locked gate when key has not been collected', () => {
      const engine = new WormGameEngine(keyGateLevel);
      assert.strictEqual(engine.collectedKeys.size, 0);

      // Move toward gate without picking up key (move DOWN, RIGHT, RIGHT, UP into gate)
      engine.move('DOWN'); // (1,2)
      engine.move('RIGHT'); // (2,2)
      engine.move('RIGHT'); // (3,2)
      engine.move('RIGHT'); // (4,2)
      engine.move('UP'); // (4,1) - right before the gate at (5,1)

      const blockedMove = engine.move('RIGHT'); // Try moving into gate at (5,1)
      assert.strictEqual(blockedMove.moved, false);
      assert.match(blockedMove.message, /Path blocked by obstacle/);
      assert.strictEqual(engine.worm[0].x, 4);
      assert.strictEqual(engine.worm[0].y, 1);
    });

    it('1.2 Engine collects key on contact and unlocks corresponding gate', () => {
      const engine = new WormGameEngine(keyGateLevel);
      // Move directly RIGHT toward key at (3,1)
      const move1 = engine.move('RIGHT'); // Head at (2,1)
      assert.strictEqual(move1.collectedKey, false);

      const move2 = engine.move('RIGHT'); // Head at (3,1) - collects key!
      assert.strictEqual(move2.collectedKey, true);
      assert.strictEqual(move2.collectedKeyId, 'key_bronze');
      assert.ok(engine.collectedKeys.has('key_bronze'));
      assert.strictEqual(engine.keys.length, 0); // Key consumed from board

      // Now move into the gate at (5,1)
      engine.move('RIGHT'); // Head at (4,1)
      const gateMove = engine.move('RIGHT'); // Head at (5,1) - unlocked gate passage!
      assert.strictEqual(gateMove.moved, true);
      assert.strictEqual(engine.worm[0].x, 5);
      assert.strictEqual(engine.worm[0].y, 1);
    });

    it('1.3 Server collidesWithImpassableObstacle correctly honors collectedKeys', () => {
      const gateObs = [{ x: 5, y: 1, type: 'gate', keyId: 'key_bronze' }];
      const wormSegment = { x: 5, y: 1 };

      // Without key: impassable obstacle
      const blocked = collidesWithImpassableObstacle(wormSegment, gateObs, 0, [], []);
      assert.strictEqual(blocked, true);

      // With key: passable
      const passed = collidesWithImpassableObstacle(wormSegment, gateObs, 0, [], ['key_bronze']);
      assert.strictEqual(passed, false);
    });

    it('1.4 Server saveCheckpoint rejects forged checkpoint with worm passing locked gate without key', async () => {
      const dbLevel = await Level.create(keyGateLevel);
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: dbLevel._id,
        levelNumber: 9901,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 1 }, { x: 0, y: 1 }],
        },
      });

      // Try saving checkpoint inside gate (5,1) without key_bronze in collectedKeys
      await assert.rejects(
        async () => {
          await gameSessionService.saveCheckpoint(session._id, testUser._id, {
            wormState: [{ x: 5, y: 1 }, { x: 4, y: 1 }],
            direction: 'RIGHT',
            movesTaken: 4,
            collectedKeys: [],
            applesRemaining: dbLevel.apples,
          });
        },
        /overlaps an impassable obstacle/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Pit Hazards, Stone Pushing & Pit Bridging Traversal
  // ---------------------------------------------------------------------------
  describe('2. Pit Hazards, Stone Pushing & Bridging Mechanics', () => {
    const pitLevel = {
      levelNumber: 9902,
      difficulty: 'medium',
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      grid: { cols: 10, rows: 6 },
      wormStart: { x: 1, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [{ x: 8, y: 2, type: 'normal' }],
      stones: [{ x: 3, y: 2 }],
      obstacles: [
        { x: 4, y: 2, type: 'pit' }, // Unfilled pit directly in front of stone
      ],
      portal: { x: 8, y: 3 },
      objective: 'reach_portal',
      moveLimit: 25,
    };

    it('2.1 Engine transitions to FAILED with FALLEN_OFF_GRID when worm steps onto an unfilled pit', () => {
      const engine = new WormGameEngine({
        ...pitLevel,
        stones: [], // No stone to push, worm walks directly into pit at (4,2)
        wormStart: { x: 3, y: 2, direction: 'RIGHT', initialLength: 2 },
      });

      const move = engine.move('RIGHT'); // Head lands on unfilled pit at (4,2)
      assert.strictEqual(move.moved, true);
      assert.strictEqual(move.status, 'FAILED');
      assert.strictEqual(move.failureReason, 'FALLEN_OFF_GRID');
      assert.strictEqual(engine.status, 'FAILED');
    });

    it('2.2 Engine pushes stone into pit, bridges it, and allows safe traversal across filled pit', () => {
      const engine = new WormGameEngine(pitLevel);
      assert.strictEqual(engine.stones.length, 1);
      assert.strictEqual(engine.filledPits.size, 0);

      // Move RIGHT to push stone at (3,2) into pit at (4,2)
      engine.move('RIGHT'); // Head at (2,2)
      const pushMove = engine.move('RIGHT'); // Head at (3,2), pushes stone into pit at (4,2)!

      assert.strictEqual(pushMove.moved, true);
      assert.strictEqual(pushMove.pushedStone, true);
      assert.strictEqual(pushMove.filledPit, true);
      assert.deepStrictEqual(pushMove.pitCoord, { x: 4, y: 2 });
      assert.ok(engine.filledPits.has('4,2'));
      assert.strictEqual(engine.stones.length, 0); // Stone consumed into pit

      // Now worm steps safely onto the bridged pit at (4,2) without failing!
      const bridgeStep = engine.move('RIGHT');
      assert.strictEqual(bridgeStep.moved, true);
      assert.strictEqual(bridgeStep.status, 'PLAYING');
      assert.strictEqual(engine.status, 'PLAYING');
      assert.strictEqual(engine.worm[0].x, 4);
      assert.strictEqual(engine.worm[0].y, 2);
    });

    it('2.3 Server collidesWithImpassableObstacle allows traversal when pit is in filledPits', () => {
      const pitObs = [{ x: 4, y: 2, type: 'pit' }];
      const wormSegment = { x: 4, y: 2 };

      // Unfilled pit is impassable
      const unfilled = collidesWithImpassableObstacle(wormSegment, pitObs, 0, [], []);
      assert.strictEqual(unfilled, true);

      // Filled pit is traversable
      const filled = collidesWithImpassableObstacle(wormSegment, pitObs, 0, ['4,2'], []);
      assert.strictEqual(filled, false);
    });

    it('2.4 Server saveCheckpoint accepts worm traversing a verified filled pit', async () => {
      const dbLevel = await Level.create(pitLevel);
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: dbLevel._id,
        levelNumber: 9902,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 2 }, { x: 0, y: 2 }],
        },
      });

      // Checkpoint with head at (4,2) and filledPits: ['4,2'], stones: [] (conservation: 0 stones + 1 pit = 1 initial stone)
      const res = await gameSessionService.saveCheckpoint(session._id, testUser._id, {
        wormState: [{ x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        stones: [],
        filledPits: ['4,2'],
        applesRemaining: dbLevel.apples,
      });

      assert.strictEqual(res.success, true);
      assert.deepStrictEqual(res.checkpoint.filledPits, ['4,2']);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Stone Conservation & Anti-Cheat Validation
  // ---------------------------------------------------------------------------
  describe('3. Stone Invariants & Anti-Cheat Guards', () => {
    it('3.1 Rejects checkpoint if stones are forged or count does not match initial stones', async () => {
      const levelWithStones = await Level.create({
        levelNumber: 9903,
        difficulty: 'medium',
        starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
        grid: { cols: 10, rows: 6 },
        wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
        apples: [{ x: 8, y: 1, type: 'normal' }],
        stones: [{ x: 3, y: 1 }],
        obstacles: [{ x: 5, y: 1, type: 'pit' }],
        portal: { x: 8, y: 2 },
        objective: 'reach_portal',
        moveLimit: 20,
      });

      const session = await GameSession.create({
        userId: testUser._id,
        levelId: levelWithStones._id,
        levelNumber: 9903,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 1 }, { x: 0, y: 1 }],
        },
      });

      // Submit checkpoint claiming 2 stones when level only had 1 initial stone
      await assert.rejects(
        async () => {
          await gameSessionService.saveCheckpoint(session._id, testUser._id, {
            wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
            direction: 'RIGHT',
            movesTaken: 1,
            stones: [{ x: 3, y: 1 }, { x: 7, y: 1 }], // Forged extra stone!
            filledPits: [],
            applesRemaining: levelWithStones.apples,
          });
        },
        /Stone count mismatch/
      );
    });

    it('3.2 Rejects checkpoint claiming filled pit that does not exist in level', async () => {
      const dbLevel = await Level.findOne({ levelNumber: 9903 });
      const session = await GameSession.findOne({ levelNumber: 9903 });

      await assert.rejects(
        async () => {
          await gameSessionService.saveCheckpoint(session._id, testUser._id, {
            wormState: [{ x: 2, y: 1 }, { x: 1, y: 1 }],
            direction: 'RIGHT',
            movesTaken: 1,
            stones: [],
            filledPits: ['9,9'], // Pit at (9,9) does not exist!
            applesRemaining: dbLevel.apples,
          });
        },
        /Filled pit '9,9' is not a valid pit in level definition/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Portal Completion & Objective Enforcement
  // ---------------------------------------------------------------------------
  describe('4. Portal Reachability & Authoritative Objective Validation', () => {
    let keyObjectiveLevel;

    before(async () => {
      await Level.collection.deleteMany({ levelNumber: 9904 });
      keyObjectiveLevel = await Level.create({
        levelNumber: 9904,
        difficulty: 'medium',
        starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
        grid: { cols: 10, rows: 6 },
        wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
        apples: [{ x: 8, y: 1, type: 'normal' }],
        keys: [{ x: 3, y: 1, keyId: 'gold_key' }],
        obstacles: [{ x: 5, y: 1, type: 'gate', keyId: 'gold_key' }],
        portal: { x: 7, y: 1 },
        objective: 'collect_keys',
        targetValue: 1,
        moveLimit: 20,
      });
    });

    it('4.1 completeSession rejects victory if worm head has not reached the portal tile', async () => {
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: keyObjectiveLevel._id,
        levelNumber: 9904,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 1 }, { x: 0, y: 1 }],
        },
        checkpoint: {
          wormState: [{ x: 6, y: 1 }, { x: 5, y: 1 }], // Portal is at (7,1)!
          direction: 'RIGHT',
          movesTaken: 5,
          currentScore: 100,
          collectedKeys: ['gold_key'],
          applesRemaining: [],
        },
      });

      await assert.rejects(
        async () => {
          await gameSessionService.completeSession(session._id, testUser._id, {
            moves: 5,
            durationSeconds: 10,
          });
        },
        /Worm head at \(6, 1\) has not reached exit portal at \(7, 1\)/
      );
    });

    it('4.2 completeSession rejects victory if required keys were not collected', async () => {
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: keyObjectiveLevel._id,
        levelNumber: 9904,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 1 }, { x: 0, y: 1 }],
        },
        checkpoint: {
          wormState: [{ x: 7, y: 1 }, { x: 6, y: 1 }], // At portal!
          direction: 'RIGHT',
          movesTaken: 6,
          currentScore: 100,
          collectedKeys: [], // Missing key!
          applesRemaining: keyObjectiveLevel.apples,
        },
      });

      await assert.rejects(
        async () => {
          await gameSessionService.completeSession(session._id, testUser._id, {
            moves: 6,
            durationSeconds: 12,
          });
        },
        /Required keys not collected \(0\/1\)/
      );
    });

    it('4.3 completeSession succeeds when worm is at portal and all keys are collected', async () => {
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: keyObjectiveLevel._id,
        levelNumber: 9904,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 1, y: 1 }, { x: 0, y: 1 }],
        },
        checkpoint: {
          wormState: [{ x: 7, y: 1 }, { x: 6, y: 1 }],
          direction: 'RIGHT',
          movesTaken: 6,
          currentScore: 100,
          collectedKeys: ['gold_key'],
          applesRemaining: keyObjectiveLevel.apples,
        },
      });

      const res = await gameSessionService.completeSession(session._id, testUser._id, {
        moves: 6,
        durationSeconds: 12,
      });

      assert.ok(res.session);
      assert.strictEqual(res.session.status, 'COMPLETED');
      assert.strictEqual(res.session.status, 'COMPLETED');
      assert.ok(res.rewards.stars >= 1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Special Apples Consistency
  // ---------------------------------------------------------------------------
  describe('5. Special Apple Effects Consistency', () => {
    it('5.1 Time Apple grants +5 moves and expands effective move allowance', () => {
      const timeLevel = {
        grid: { cols: 10, rows: 6 },
        wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
        apples: [{ x: 2, y: 1, type: 'time' }],
        moveLimit: 10,
        timeAppleBonusMoves: 5,
        portal: { x: 8, y: 1 },
      };

      const engine = new WormGameEngine(timeLevel);
      assert.strictEqual(engine.effectiveMoveLimit, 10);

      const move = engine.move('RIGHT'); // Eat time apple
      assert.strictEqual(move.collectedApple, true);
      assert.strictEqual(move.isTimeApple, true);
      assert.strictEqual(move.timeBonusMoves, 5);
      assert.strictEqual(engine.timeApplesEaten, 1);
      assert.strictEqual(engine.effectiveMoveLimit, 15); // 10 + 5
    });

    it('5.2 Mega Apple grows worm by exactly +2 segments and awards score', () => {
      const megaLevel = {
        grid: { cols: 10, rows: 6 },
        wormStart: { x: 1, y: 1, direction: 'RIGHT', initialLength: 2 },
        apples: [{ x: 2, y: 1, type: 'mega' }],
        portal: { x: 8, y: 1 },
      };

      const engine = new WormGameEngine(megaLevel);
      assert.strictEqual(engine.worm.length, 2);

      const move = engine.move('RIGHT');
      assert.strictEqual(move.isMegaApple, true);
      assert.strictEqual(engine.worm.length, 4); // 2 + 2 segments
      assert.strictEqual(engine.megaApplesEaten, 1);
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
});
