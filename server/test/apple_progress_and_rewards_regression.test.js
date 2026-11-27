/**
 * server/test/apple_progress_and_rewards_regression.test.js
 * 
 * Regression Test Suite for Apple Progress HUD, GameControls status bar,
 * special apple indicators, and Victory reward mapping.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import GameSession from '../src/models/GameSession.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import Wallet from '../src/models/Wallet.js';
import { gameSessionService } from '../src/services/gameSessionService.js';
import { WormGameEngine } from '../../client/src/components/game/WormGameEngine.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

function resolvePath(relativePath) {
  const p1 = path.resolve(process.cwd(), relativePath);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(__dirname, '../../', relativePath);
  if (fs.existsSync(p2)) return p2;
  const p3 = path.resolve(__dirname, '../', relativePath);
  if (fs.existsSync(p3)) return p3;
  return p1;
}

describe('Apple Progress HUD, Controls & Victory Reward Regression Suite', () => {
  let testUser;
  let testLevel;
  let testLevel8802;
  let testLevel8803;
  let testLevel8804;
  let testLevel8805;
  let testLevel8806;
  let testLevel8807;
  let testLevel8808;

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean fixtures scoped to this regression suite
    await User.collection.deleteMany({ email: /@apple-regression\.com$/ });
    await Level.collection.deleteMany({ levelNumber: { $in: [8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808] } });

    testUser = await User.create({
      username: 'apple_hud_tester',
      email: 'hud_tester@apple-regression.com',
      password: 'SecurePassword123!',
      currentLevel: 1,
    });

    testLevel = await Level.create({
      levelNumber: 8801,
      difficulty: 'medium',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'normal' },
        { x: 4, y: 2, type: 'mega' },
        { x: 5, y: 2, type: 'golden' },
        { x: 6, y: 2, type: 'time' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 7, y: 2 },
      moveLimit: 25,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8802 = await Level.create({
      levelNumber: 8802,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'normal' },
        { x: 4, y: 2, type: 'normal' },
        { x: 5, y: 2, type: 'normal' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 6, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8803 = await Level.create({
      levelNumber: 8803,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'normal' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8804 = await Level.create({
      levelNumber: 8804,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'normal' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8805 = await Level.create({
      levelNumber: 8805,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'mystery', mysteryEffect: { type: 'BONUS_SCORE', value: 200 } },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8806 = await Level.create({
      levelNumber: 8806,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'golden' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8807 = await Level.create({
      levelNumber: 8807,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'mega' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });

    testLevel8808 = await Level.create({
      levelNumber: 8808,
      difficulty: 'easy',
      grid: { rows: 8, cols: 12 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [
        { x: 3, y: 2, type: 'time' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 5, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      isActive: true,
    });
  });

  after(async () => {
    await User.collection.deleteMany({ email: /@apple-regression\.com$/ });
    await Level.collection.deleteMany({ levelNumber: { $in: [8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808] } });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  describe('1. Engine Apple Tracking & HUD Progress Formatting', () => {
    it('1.1 Initial state displays 0/total progress ratio', () => {
      const engine = new WormGameEngine(testLevel);
      assert.equal(engine.totalApplesCount, 4, 'Total apples count should match level configuration');
      assert.equal(engine.applesEaten, 0, 'Apples eaten initially should be 0');

      // The HUD format rule: engine.applesEaten / engine.totalApplesCount
      const hudDisplay = `${engine.applesEaten} / ${engine.totalApplesCount}`;
      assert.equal(hudDisplay, '0 / 4', 'HUD apple progress should read 0 / 4 at puzzle start');
    });

    it('1.2 Apple collection increments applesEaten and updates progress ratio immediately', () => {
      const engine = new WormGameEngine(testLevel);
      const moveRes = engine.move('RIGHT'); // Steps onto (3, 2), normal apple
      assert.equal(moveRes.moved, true);
      assert.equal(moveRes.collectedApple, true);
      assert.equal(engine.applesEaten, 1);
      assert.equal(`${engine.applesEaten} / ${engine.totalApplesCount}`, '1 / 4');
    });

    it('1.3 Mega Apple increments applesEaten, megaApplesEaten, and worm grows by 2 segments', () => {
      const engine = new WormGameEngine(testLevel);
      engine.move('RIGHT'); // Normal apple at (3,2)
      assert.equal(engine.worm.length, 3);

      const megaMove = engine.move('RIGHT'); // Mega apple at (4,2)
      assert.equal(megaMove.isMegaApple, true);
      assert.equal(engine.applesEaten, 2);
      assert.equal(engine.megaApplesEaten, 1);
      assert.equal(engine.worm.length, 5, 'Mega apple grants +2 segment growth (total 5)');
      assert.equal(`${engine.applesEaten} / ${engine.totalApplesCount}`, '2 / 4');
    });

    it('1.4 Undo correctly restores both total applesEaten and special apple counters', () => {
      const engine = new WormGameEngine(testLevel);
      engine.move('RIGHT'); // Normal apple at (3,2) -> applesEaten = 1
      engine.move('RIGHT'); // Mega apple at (4,2)   -> applesEaten = 2, megaApplesEaten = 1
      engine.move('RIGHT'); // Golden apple at (5,2) -> applesEaten = 3, goldenApplesEaten = 1

      assert.equal(engine.applesEaten, 3);
      assert.equal(engine.goldenApplesEaten, 1);
      assert.equal(engine.megaApplesEaten, 1);

      // Undo golden apple step
      const undo1 = engine.undo();
      assert.equal(undo1, true);
      assert.equal(engine.applesEaten, 2);
      assert.equal(engine.goldenApplesEaten, 0);
      assert.equal(engine.megaApplesEaten, 1);
      assert.equal(`${engine.applesEaten} / ${engine.totalApplesCount}`, '2 / 4');

      // Undo mega apple step
      const undo2 = engine.undo();
      assert.equal(undo2, true);
      assert.equal(engine.applesEaten, 1);
      assert.equal(engine.megaApplesEaten, 0);
      assert.equal(engine.worm.length, 3);
      assert.equal(`${engine.applesEaten} / ${engine.totalApplesCount}`, '1 / 4');

      // Undo normal apple step
      const undo3 = engine.undo();
      assert.equal(undo3, true);
      assert.equal(engine.applesEaten, 0);
      assert.equal(engine.worm.length, 2);
      assert.equal(`${engine.applesEaten} / ${engine.totalApplesCount}`, '0 / 4');
    });
  });

  describe('2. Frontend Code Integrity: HUD, GameControls & Dialogs', () => {
    it('2.1 GamePlayPage.jsx renders collected / total apples format in HUD', () => {
      const filePath = resolvePath('client/src/pages/GamePlayPage.jsx');
      assert.ok(fs.existsSync(filePath), 'GamePlayPage.jsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');

      // Verify collected / total format
      assert.ok(
        content.includes('{engine.applesEaten} / {engine.totalApplesCount}'),
        'HUD must display {engine.applesEaten} / {engine.totalApplesCount}'
      );
      assert.ok(
        content.includes('className="hud-stat-pill stat-apples"'),
        'HUD must preserve stat-apples pill styling'
      );
    });

    it('2.2 GamePlayPage.jsx includes Mega Apple indicator alongside Golden, Time, and Mystery', () => {
      const filePath = resolvePath('client/src/pages/GamePlayPage.jsx');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.ok(
        content.includes('Boolean(engine.megaApplesEaten)'),
        'Must check Boolean(engine.megaApplesEaten)'
      );
      assert.ok(
        content.includes('className="hud-stat-pill stat-mega"'),
        'Must render stat-mega pill'
      );
      assert.ok(
        content.includes('{engine.megaApplesEaten} 🌟'),
        'Must display mega apple count with star emoji'
      );
      assert.ok(content.includes('Boolean(engine.goldenApplesEaten)'), 'Preserves golden indicator');
      assert.ok(content.includes('Boolean(engine.timeApplesEaten)'), 'Preserves time indicator');
      assert.ok(content.includes('Boolean(engine.mysteryApplesEaten)'), 'Preserves mystery indicator');
    });

    it('2.3 GamePlayPage.jsx passes apple progress props to GameControls', () => {
      const filePath = resolvePath('client/src/pages/GamePlayPage.jsx');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.ok(
        content.includes('totalApples={engine.totalApplesCount || 0}'),
        'Must pass totalApples prop'
      );
      assert.ok(
        content.includes('applesEaten={engine.applesEaten || 0}') ||
        content.includes('collectedApplesCount={engine.applesEaten || 0}'),
        'Must pass applesEaten or collectedApplesCount prop'
      );
    });

    it('2.4 GameControls.jsx renders compact 🍎 collected/total chip only when totalApples > 0', () => {
      const filePath = resolvePath('client/src/components/game/GameControls.jsx');
      assert.ok(fs.existsSync(filePath), 'GameControls.jsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.ok(
        content.includes('totalApples > 0'),
        'Apple chip must only render when totalApples > 0'
      );
      assert.ok(
        content.includes('controls-status-chip chip-apples'),
        'Must use controls-status-chip chip-apples class'
      );
      assert.ok(
        content.includes('{currentApplesEaten}/{totalApples}') || content.includes('{applesEaten}/{totalApples}'),
        'Must render collected/total format'
      );
      assert.ok(content.includes('🍎'), 'Must include apple emoji');

      // Verify preservation of existing chips
      assert.ok(content.includes('chip-wallet'), 'Preserves wallet chip');
      assert.ok(content.includes('chip-keys'), 'Preserves keys chip');
      assert.ok(content.includes('chip-moves'), 'Preserves moves chip');
    });

    it('2.5 App.css defines styling for chip-apples and stat-mega', () => {
      const filePath = resolvePath('client/src/App.css');
      assert.ok(fs.existsSync(filePath), 'App.css must exist');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.ok(content.includes('.chip-apples'), 'App.css must define .chip-apples');
      assert.ok(content.includes('.stat-mega'), 'App.css must define .stat-mega');
      assert.ok(content.includes('.stat-pill-val.magenta-text'), 'App.css must define .stat-pill-val.magenta-text');
    });

    it('2.6 GameDialogs.jsx renders special apple rewards when data is available', () => {
      const filePath = resolvePath('client/src/components/game/GameDialogs.jsx');
      assert.ok(fs.existsSync(filePath), 'GameDialogs.jsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.ok(
        content.includes('backendRewards.goldenCoins') || content.includes('backendRewards.goldenApples'),
        'VictoryDialog must check for golden apple rewards'
      );
      assert.ok(
        content.includes('backendRewards.megaApples'),
        'VictoryDialog must check for mega apple rewards'
      );
      assert.ok(
        content.includes('backendRewards.timeApples'),
        'VictoryDialog must check for time apple rewards'
      );
      assert.ok(
        content.includes('backendRewards.mysteryApples'),
        'VictoryDialog must check for mystery apple rewards'
      );
    });
  });

  describe('3. Server Completion & Client Reward Data Mapping', () => {
    it('3.1 Server completeSession returns special apple reward breakdown', async () => {
      const session = await GameSession.create({
        userId: testUser._id,
        levelId: testLevel._id,
        levelNumber: testLevel.levelNumber,
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }],
        },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 5,
          applesEaten: 4,
          goldenApplesEaten: 1,
          megaApplesEaten: 1,
          timeApplesEaten: 1,
          mysteryApplesEaten: 0,
          currentScore: 850,
          applesRemaining: [],
          keysRemaining: [],
          stones: [],
          collectedKeys: [],
          filledPits: [],
        },
      });

      const completionResult = await gameSessionService.completeSession(session._id, testUser._id, {
        moves: 5,
        durationSeconds: 15,
        applesCollected: 4,
      });

      assert.ok(completionResult && completionResult.rewards, 'Completion result contains rewards');
      const rew = completionResult.rewards;
      assert.equal(rew.goldenApples, 1, 'Server should report 1 golden apple');
      assert.equal(rew.goldenCoins, 10, 'Server should credit 10 golden apple bonus coins');
      assert.equal(rew.megaApples, 1, 'Server should report 1 mega apple');
      assert.equal(rew.timeApples, 1, 'Server should report 1 time apple');
      assert.ok(rew.coins >= 35, 'Total coins includes base completion + golden apple bonus');
    });

    it('3.2 GamePlayPage handleCompleteSession and fetchAndApplyServerRewards preserve all special apple fields', () => {
      const filePath = resolvePath('client/src/pages/GamePlayPage.jsx');
      const content = fs.readFileSync(filePath, 'utf8');

      // Check handleCompleteSession reward mapping
      assert.ok(
        content.includes('goldenApples = rew.goldenApples ?? sess.goldenApplesCollected'),
        'handleCompleteSession maps goldenApples'
      );
      assert.ok(
        content.includes('megaApples = rew.megaApples ?? sess.megaApplesCollected'),
        'handleCompleteSession maps megaApples'
      );
      assert.ok(
        content.includes('timeApples = rew.timeApples ?? sess.timeApplesCollected'),
        'handleCompleteSession maps timeApples'
      );
      assert.ok(
        content.includes('mysteryApples = rew.mysteryApples ?? sess.mysteryApplesCollected'),
        'handleCompleteSession maps mysteryApples'
      );

      // Check fetchAndApplyServerRewards mapping
      assert.ok(
        content.includes('sess.goldenApplesCollected ?? sess.rewardBreakdown?.goldenApplesCount'),
        'fetchAndApplyServerRewards maps goldenApples'
      );
      assert.ok(
        content.includes('sess.megaApplesCollected ?? sess.rewardBreakdown?.megaApplesCount'),
        'fetchAndApplyServerRewards maps megaApples'
      );
      assert.ok(
        content.includes('sess.timeApplesCollected ?? sess.rewardBreakdown?.timeApplesCount'),
        'fetchAndApplyServerRewards maps timeApples'
      );
      assert.ok(
        content.includes('sess.mysteryApplesCollected ?? sess.rewardBreakdown?.mysteryApplesCount'),
        'fetchAndApplyServerRewards maps mysteryApples'
      );
    });
  });

  describe('4. Authoritative Lifetime Apple Projection & Synchronization Suite', () => {
    let u1;

    before(async () => {
      u1 = await User.create({
        username: 'apple_proj_u1',
        email: 'proj_u1@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u1._id,
        currentLevel: 8803,
        highestUnlockedLevel: 8803,
        totalApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u1._id, balance: 100 });
    });

    it('4.1 First Campaign completion increments lifetime total from authoritative session data', async () => {
      const session = await gameSessionService.startSession(u1._id, 8803);
      await gameSessionService.saveCheckpoint(session._id, u1._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const compRes = await gameSessionService.completeSession(session._id, u1._id);
      assert.equal(compRes.session.status, 'COMPLETED');

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 1, 'First campaign clear should set totalApplesEaten to 1');
    });

    it('4.2 Multi-apple Campaign completion adds all consumed apples to projection', async () => {
      const session = await gameSessionService.startSession(u1._id, 8802);
      await gameSessionService.saveCheckpoint(session._id, u1._id, {
        checkpointIndex: 1,
        wormState: [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 4,
        applesRemaining: [],
      });

      const compRes = await gameSessionService.completeSession(session._id, u1._id);
      assert.equal(compRes.session.status, 'COMPLETED');

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 4, 'Multi-apple level (3 apples) should project total to 4 (1 + 3)');
    });

    it('4.3 Campaign replay contributes additional apples to lifetime counter', async () => {
      // Replay level 8803 (1 apple)
      const session = await gameSessionService.startSession(u1._id, 8803);
      await gameSessionService.saveCheckpoint(session._id, u1._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const compRes = await gameSessionService.completeSession(session._id, u1._id);
      assert.equal(compRes.session.status, 'COMPLETED');

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 5, 'Replaying level 8803 should increase lifetime apples to 5');
      assert.equal(progress.completedLevels.length, 2, 'Distinct level count remains 2 (8803 and 8802)');
    });

    it('4.4 Daily Challenge completion contributes to authoritative lifetime apples', async () => {
      const session = await GameSession.create({
        userId: u1._id,
        levelId: testLevel8802._id,
        levelNumber: 8802,
        isDailyChallenge: true,
        challengeDate: '2026-11-27',
        status: 'ACTIVE',
        initialState: {
          worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }],
        },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 4,
          applesEaten: 3,
          currentScore: 800,
          applesRemaining: [],
          keysRemaining: [],
          stones: [],
          collectedKeys: [],
          filledPits: [],
        },
      });

      const compRes = await gameSessionService.completeSession(session._id, u1._id);
      assert.equal(compRes.session.status, 'COMPLETED');

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 8, 'Daily Challenge (3 apples) should project total to 8 (5 + 3)');
    });

    it('4.5 Sequential duplicate completion does not double-count apples', async () => {
      // Find the last completed Daily Challenge session and complete it again
      const lastSession = await GameSession.findOne({ userId: u1._id, isDailyChallenge: true, status: 'COMPLETED' });
      assert.ok(lastSession, 'Completed daily session exists');

      const dupRes = await gameSessionService.completeSession(lastSession._id, u1._id);
      assert.equal(dupRes.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 8, 'Duplicate completion must leave totalApplesEaten at 8');
    });

    it('4.6 Concurrent duplicate completion requests do not double-count', async () => {
      const session = await gameSessionService.startSession(u1._id, 8803);
      await gameSessionService.saveCheckpoint(session._id, u1._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const [res1, res2] = await Promise.allSettled([
        gameSessionService.completeSession(session._id, u1._id),
        gameSessionService.completeSession(session._id, u1._id),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one concurrent completion must succeed');
      assert.equal(rejected.length, 1, 'Exactly one concurrent completion must be rejected with 409 conflict');
      assert.equal(rejected[0].reason?.statusCode, 409);

      const progress = await PlayerProgress.findOne({ userId: u1._id });
      assert.equal(progress.totalApplesEaten, 9, 'Total apples should increment by exactly 1 (to 9)');
    });

    it('4.7 Concurrent distinct session completions preserve correct projection', async () => {
      const u2 = await User.create({
        username: 'apple_proj_u2',
        email: 'proj_u2@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u2._id,
        currentLevel: 8803,
        highestUnlockedLevel: 8804,
        totalApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u2._id, balance: 100 });

      const sessA = await gameSessionService.startSession(u2._id, 8804);
      await gameSessionService.saveCheckpoint(sessA._id, u2._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const sessB = await gameSessionService.startSession(u2._id, 8803);
      await gameSessionService.saveCheckpoint(sessB._id, u2._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      await Promise.all([
        gameSessionService.completeSession(sessA._id, u2._id),
        gameSessionService.completeSession(sessB._id, u2._id),
      ]);

      const progress = await PlayerProgress.findOne({ userId: u2._id });
      assert.equal(progress.totalApplesEaten, 2, 'Concurrent distinct sessions (1 + 1) should project to 2');
    });

    it('4.8 Recovery with needsReconciliation === true restores level and lifetime apples', async () => {
      const u3 = await User.create({
        username: 'apple_proj_u3',
        email: 'proj_u3@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u3._id, balance: 100 });

      // Create an interrupted completed session (simulating crash before PlayerProgress update)
      const interruptedSession = await GameSession.create({
        userId: u3._id,
        levelId: testLevel8802._id,
        levelNumber: 8802,
        status: 'COMPLETED',
        moves: 4,
        durationSeconds: 10,
        score: 600,
        applesCollected: 3,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 4,
          applesRemaining: [],
          currentScore: 600,
        },
      });

      // Retry completeSession on the interrupted session
      const recRes = await gameSessionService.completeSession(interruptedSession._id, u3._id);
      assert.equal(recRes.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u3._id });
      assert.ok(progress.completedLevels.some((l) => l.levelNumber === 8802), 'Level record must be recovered');
      assert.equal(progress.totalApplesEaten, 3, 'Apples must be projected accurately upon recovery');
    });

    it('4.9 Recovery with needsReconciliation === false restores lifetime apples on replay', async () => {
      const u3 = await User.findOne({ email: 'proj_u3@apple-regression.com' });

      // User u3 already has level 8802 with 3 stars and 600 score.
      // Simulate an interrupted replay with equal or lower score (so needsReconciliation is false)
      const interruptedReplay = await GameSession.create({
        userId: u3._id,
        levelId: testLevel8802._id,
        levelNumber: 8802,
        status: 'COMPLETED',
        moves: 5,
        durationSeconds: 12,
        score: 550, // lower than 600
        applesCollected: 3,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 5,
          applesRemaining: [],
          currentScore: 550,
        },
      });

      // Call completeSession on the replay
      const repRes = await gameSessionService.completeSession(interruptedReplay._id, u3._id);
      assert.equal(repRes.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u3._id });
      assert.equal(progress.totalApplesEaten, 6, 'Replay apples must be synchronized even when needsReconciliation is false (3 + 3 = 6)');
    });

    it('4.10 Interrupted completion followed by duplicate recovery recovers projection', async () => {
      const u4 = await User.create({
        username: 'apple_proj_u4',
        email: 'proj_u4@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u4._id, balance: 100 });

      const sess = await GameSession.create({
        userId: u4._id,
        levelId: testLevel8803._id,
        levelNumber: 8803,
        status: 'COMPLETED',
        moves: 3,
        durationSeconds: 5,
        score: 300,
        applesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 3,
          applesRemaining: [],
          currentScore: 300,
        },
      });

      const res = await gameSessionService.completeSession(sess._id, u4._id);
      assert.equal(res.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u4._id });
      assert.equal(progress.totalApplesEaten, 1, 'Interrupted session apples recovered');
    });

    it('4.11 Daily Challenge completed-session recovery synchronizes projection', async () => {
      const u5 = await User.create({
        username: 'apple_proj_u5',
        email: 'proj_u5@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u5._id, balance: 100 });

      const dcSess = await GameSession.create({
        userId: u5._id,
        levelId: testLevel8802._id,
        levelNumber: 8802,
        isDailyChallenge: true,
        challengeDate: '2026-11-27',
        status: 'COMPLETED',
        moves: 4,
        durationSeconds: 8,
        score: 500,
        applesCollected: 3,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 4,
          applesRemaining: [],
          currentScore: 500,
        },
      });

      const res = await gameSessionService.completeSession(dcSess._id, u5._id);
      assert.equal(res.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u5._id });
      assert.equal(progress.totalApplesEaten, 3, 'Daily Challenge completed session recovery synchronizes apples to 3');
    });

    it('4.12 Failed sessions are excluded from authoritative projection', async () => {
      const u6 = await User.create({
        username: 'apple_proj_u6',
        email: 'proj_u6@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u6._id,
        currentLevel: 8803,
        highestUnlockedLevel: 8803,
        totalApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u6._id, balance: 100 });

      const sess = await gameSessionService.startSession(u6._id, 8803);
      await gameSessionService.failSession(sess._id, u6._id, { failureReason: 'OUT_OF_MOVES' });

      const failedDoc = await GameSession.findById(sess._id);
      assert.equal(failedDoc.status, 'FAILED');
      assert.equal(failedDoc.applesCollected, 0);

      const total = await gameSessionService.syncPlayerApples(u6._id);
      assert.equal(total, 0, 'Failed sessions must not contribute to authoritative apples');

      const progress = await PlayerProgress.findOne({ userId: u6._id });
      assert.equal(progress.totalApplesEaten, 0);
    });

    it('4.13 Abandoned sessions are excluded from authoritative projection', async () => {
      const u7 = await User.create({
        username: 'apple_proj_u7',
        email: 'proj_u7@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u7._id,
        currentLevel: 8803,
        highestUnlockedLevel: 8803,
        totalApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u7._id, balance: 100 });

      const sess = await gameSessionService.startSession(u7._id, 8803);
      await gameSessionService.abandonSession(sess._id, u7._id);

      const abandonedDoc = await GameSession.findById(sess._id);
      assert.equal(abandonedDoc.status, 'ABANDONED');
      assert.equal(abandonedDoc.applesCollected, 0);

      const total = await gameSessionService.syncPlayerApples(u7._id);
      assert.equal(total, 0, 'Abandoned sessions must not contribute to authoritative apples');

      const progress = await PlayerProgress.findOne({ userId: u7._id });
      assert.equal(progress.totalApplesEaten, 0);
    });

    it('4.14 Missing PlayerProgress document is auto-created and synchronized', async () => {
      const u8 = await User.create({
        username: 'apple_proj_u8',
        email: 'proj_u8@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u8._id, balance: 100 });

      // Ensure no progress exists
      await PlayerProgress.deleteMany({ userId: u8._id });
      const before = await PlayerProgress.findOne({ userId: u8._id });
      assert.equal(before, null);

      // Create a completed session
      await GameSession.create({
        userId: u8._id,
        levelId: testLevel8803._id,
        levelNumber: 8803,
        status: 'COMPLETED',
        moves: 3,
        applesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      const total = await gameSessionService.syncPlayerApples(u8._id);
      assert.equal(total, 1);

      const after = await PlayerProgress.findOne({ userId: u8._id });
      assert.ok(after, 'PlayerProgress must be created');
      assert.equal(after.totalApplesEaten, 1);
    });

    it('4.15 An existing inflated total is not lowered by $max (monotonic ratchet behavior documented)', async () => {
      const u9 = await User.create({
        username: 'apple_proj_u9',
        email: 'proj_u9@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u9._id, balance: 100 });

      // Create 1 completed session (1 apple)
      await GameSession.create({
        userId: u9._id,
        levelId: testLevel8803._id,
        levelNumber: 8803,
        status: 'COMPLETED',
        moves: 3,
        applesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      // Artificially inflate totalApplesEaten to 99 in PlayerProgress
      await PlayerProgress.create({
        userId: u9._id,
        currentLevel: 1,
        highestUnlockedLevel: 1,
        totalApplesEaten: 99,
      });

      // Synchronize
      const synced = await gameSessionService.syncPlayerApples(u9._id);
      assert.equal(synced, 1, 'Authoritative session sum is 1');

      const progress = await PlayerProgress.findOne({ userId: u9._id });
      assert.equal(
        progress.totalApplesEaten,
        99,
        'MongoDB $max prevents downward correction, preserving inflated 99 as documented'
      );
    });
  });

  describe('5. Authoritative Special Apple Lifetime Projection & Cross-Mode Suite', () => {
    it('5.1 Daily Challenge Golden Apples followed by campaign completion', async () => {
      const u = await User.create({
        username: 'sp_proj_u1',
        email: 'sp_u1@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Daily Challenge on level 8806 (1 golden apple)
      const dcSess = await gameSessionService.startSession(u._id, 8806, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(dcSess._id, u._id);

      let progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1, 'Golden apple from Daily Challenge recorded');

      // Campaign on level 8803 (0 golden apples, 1 normal apple)
      const campSess = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(campSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(campSess._id, u._id);

      progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(
        progress.totalGoldenApplesEaten,
        1,
        'Golden apple from Daily Challenge must be preserved after campaign completion (NOT wiped to 0)'
      );
      assert.equal(progress.totalApplesEaten, 2, 'Total ordinary apples should be 1 + 1 = 2');
    });

    it('5.2 Daily Challenge Mega Apples followed by campaign completion', async () => {
      const u = await User.create({
        username: 'sp_proj_u2',
        email: 'sp_u2@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8807,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalMegaApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Daily Challenge on level 8807 (1 mega apple: initial length 2, eats mega -> length 4)
      const dcSess = await gameSessionService.startSession(u._id, 8807, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(dcSess._id, u._id);

      let progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalMegaApplesEaten, 1);

      // Campaign on level 8803 (0 mega apples)
      const campSess = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(campSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(campSess._id, u._id);

      progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalMegaApplesEaten, 1, 'Mega apple preserved after campaign completion');
    });

    it('5.3 Daily Challenge Time Apples followed by campaign completion', async () => {
      const u = await User.create({
        username: 'sp_proj_u3',
        email: 'sp_u3@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8808,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalTimeApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Daily Challenge on level 8808 (1 time apple)
      const dcSess = await gameSessionService.startSession(u._id, 8808, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(dcSess._id, u._id);

      let progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalTimeApplesEaten, 1);

      // Campaign on level 8803 (0 time apples)
      const campSess = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(campSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(campSess._id, u._id);

      progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalTimeApplesEaten, 1, 'Time apple preserved after campaign completion');
    });

    it('5.4 Daily Challenge Mystery Apples followed by campaign completion', async () => {
      const u = await User.create({
        username: 'sp_proj_u4',
        email: 'sp_u4@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8805,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalMysteryApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Daily Challenge on level 8805 (1 mystery apple: initial length 2 + 1 growth = length 3)
      const dcSess = await gameSessionService.startSession(u._id, 8805, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(dcSess._id, u._id);

      let progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalMysteryApplesEaten, 1);

      // Campaign on level 8803 (0 mystery apples)
      const campSess = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(campSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(campSess._id, u._id);

      progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalMysteryApplesEaten, 1, 'Mystery apple preserved after campaign completion');
    });

    it('5.5 Campaign replay preserving lifetime Daily Challenge counters', async () => {
      const u = await User.create({
        username: 'sp_proj_u5',
        email: 'sp_u5@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Daily challenge with 1 golden apple
      const dcSess = await gameSessionService.startSession(u._id, 8806, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(dcSess._id, u._id);

      // Play campaign level 8803
      const camp1 = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(camp1._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(camp1._id, u._id);

      // Replay campaign level 8803
      const camp2 = await gameSessionService.startSession(u._id, 8803);
      await gameSessionService.saveCheckpoint(camp2._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(camp2._id, u._id);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1, 'Replay of campaign level does not reset daily golden apples');
      assert.equal(progress.totalApplesEaten, 3, 'Total apples: 1 daily + 1 campaign + 1 replay = 3');
    });

    it('5.6 Campaign replay consuming additional special apples where applicable, while coin rewards remain idempotent', async () => {
      const u = await User.create({
        username: 'sp_proj_u6',
        email: 'sp_u6@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // First clear of campaign 8806 (1 golden apple)
      const s1 = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.saveCheckpoint(s1._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      const res1 = await gameSessionService.completeSession(s1._id, u._id);
      assert.equal(res1.rewards.goldenCoins, 10, 'First completion awards 10 golden coins');

      const wallet1 = await Wallet.findOne({ userId: u._id });
      // 100 balance + 25 base + 20 star + 10 golden = 155
      assert.equal(wallet1.balance, 155);

      let progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1);

      // Replay of campaign 8806 (eating golden apple again)
      const s2 = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.saveCheckpoint(s2._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      const res2 = await gameSessionService.completeSession(s2._id, u._id);
      assert.equal(res2.rewards.goldenCoins, 0, 'Replay awards 0 additional golden coins');

      const wallet2 = await Wallet.findOne({ userId: u._id });
      assert.equal(wallet2.balance, 155, 'Wallet balance remains unchanged on replay');

      progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(
        progress.totalGoldenApplesEaten,
        2,
        'Lifetime totalGoldenApplesEaten projects across all completed sessions (1 + 1 = 2)'
      );
    });

    it('5.7 Duplicate campaign completion preserving all special apple totals', async () => {
      const u = await User.create({
        username: 'sp_proj_u7',
        email: 'sp_u7@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const s = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.saveCheckpoint(s._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(s._id, u._id);

      // Duplicate completion
      const dup = await gameSessionService.completeSession(s._id, u._id);
      assert.equal(dup.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1, 'Duplicate completion does not double-count golden apples');
    });

    it('5.8 Daily Challenge duplicate/recovery after interrupted synchronization', async () => {
      const u = await User.create({
        username: 'sp_proj_u8',
        email: 'sp_u8@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 1,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        totalMegaApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Simulate interrupted completed daily session
      const interrupted = await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        isDailyChallenge: true,
        challengeDate: '2026-11-28',
        status: 'COMPLETED',
        moves: 3,
        durationSeconds: 10,
        score: 300,
        applesCollected: 1,
        goldenApplesCollected: 1,
        megaApplesCollected: 0,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 3,
          applesRemaining: [],
          currentScore: 300,
        },
      });

      // Duplicate recovery call
      const rec = await gameSessionService.completeSession(interrupted._id, u._id);
      assert.equal(rec.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1, 'Golden apple recovered on duplicate recovery');
      assert.equal(progress.totalApplesEaten, 1);
    });

    it('5.9 Recovery with needsReconciliation === true', async () => {
      const u = await User.create({
        username: 'sp_proj_u9',
        email: 'sp_u9@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [], // missing 8806 so needsReconciliation is true
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const interrupted = await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        isDailyChallenge: false,
        status: 'COMPLETED',
        moves: 3,
        durationSeconds: 10,
        score: 300,
        applesCollected: 1,
        goldenApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 3,
          applesRemaining: [],
          currentScore: 300,
        },
      });

      const rec = await gameSessionService.completeSession(interrupted._id, u._id);
      assert.equal(rec.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.ok(progress.completedLevels.some((l) => l.levelNumber === 8806));
      assert.equal(progress.totalGoldenApplesEaten, 1);
    });

    it('5.10 Recovery with needsReconciliation === false', async () => {
      const u = await User.create({
        username: 'sp_proj_u10',
        email: 'sp_u10@apple-regression.com',
        password: 'SecurePassword123!',
      });
      // User has already recorded level 8806 with 3 stars and score 500
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 1,
        totalGoldenApplesEaten: 1,
        completedLevels: [
          {
            levelNumber: 8806,
            stars: 3,
            highScore: 500,
            leastMoves: 3,
            fastestTimeSeconds: 10,
            goldenApplesClaimed: 1,
          },
        ],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // First completed session
      await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        status: 'COMPLETED',
        moves: 3,
        score: 500,
        applesCollected: 1,
        goldenApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      // Second replay completed session with lower score (400 -> needsReconciliation = false)
      const replaySess = await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        status: 'COMPLETED',
        moves: 4,
        score: 400,
        applesCollected: 1,
        goldenApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        checkpoint: {
          checkpointIndex: 1,
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
          direction: 'RIGHT',
          movesTaken: 4,
          applesRemaining: [],
          currentScore: 400,
        },
      });

      const rec = await gameSessionService.completeSession(replaySess._id, u._id);
      assert.equal(rec.isDuplicate, true);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 2, 'Recovery with needsReconciliation === false syncs projection (1 + 1 = 2)');
    });

    it('5.11 Concurrent distinct campaign completions', async () => {
      const u = await User.create({
        username: 'sp_proj_u11',
        email: 'sp_u11@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        totalMegaApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const sessA = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.saveCheckpoint(sessA._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const sessB = await gameSessionService.startSession(u._id, 8807);
      await gameSessionService.saveCheckpoint(sessB._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      await Promise.all([
        gameSessionService.completeSession(sessA._id, u._id),
        gameSessionService.completeSession(sessB._id, u._id),
      ]);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1);
      assert.equal(progress.totalMegaApplesEaten, 1);
    });

    it('5.12 Concurrent campaign and Daily Challenge completions', async () => {
      const u = await User.create({
        username: 'sp_proj_u12',
        email: 'sp_u12@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        totalMegaApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const campSess = await gameSessionService.startSession(u._id, 8806, { isDailyChallenge: false });
      await gameSessionService.saveCheckpoint(campSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      const dcSess = await gameSessionService.startSession(u._id, 8807, { isDailyChallenge: true });
      await gameSessionService.saveCheckpoint(dcSess._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });

      await Promise.all([
        gameSessionService.completeSession(campSess._id, u._id),
        gameSessionService.completeSession(dcSess._id, u._id),
      ]);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1, 'Campaign golden apple preserved');
      assert.equal(progress.totalMegaApplesEaten, 1, 'Daily challenge mega apple preserved');
    });

    it('5.13 Failed sessions excluded', async () => {
      const u = await User.create({
        username: 'sp_proj_u13',
        email: 'sp_u13@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const sess = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.failSession(sess._id, u._id, { failureReason: 'OUT_OF_MOVES' });

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 0);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 0);
    });

    it('5.14 Abandoned sessions excluded', async () => {
      const u = await User.create({
        username: 'sp_proj_u14',
        email: 'sp_u14@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        totalApplesEaten: 0,
        totalGoldenApplesEaten: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const sess = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.abandonSession(sess._id, u._id);

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 0);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 0);
    });

    it('5.15 Missing PlayerProgress document', async () => {
      const u = await User.create({
        username: 'sp_proj_u15',
        email: 'sp_u15@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        status: 'COMPLETED',
        moves: 3,
        goldenApplesCollected: 2,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 2);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.ok(progress, 'PlayerProgress created');
      assert.equal(progress.totalGoldenApplesEaten, 2);
    });

    it('5.16 Previously inflated counters', async () => {
      const u = await User.create({
        username: 'sp_proj_u16',
        email: 'sp_u16@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u._id, balance: 100 });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 1,
        highestUnlockedLevel: 1,
        totalGoldenApplesEaten: 50,
        totalMegaApplesEaten: 50,
      });

      // Session with 1 golden apple
      await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        status: 'COMPLETED',
        moves: 3,
        goldenApplesCollected: 1,
        megaApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 50, 'Persisted 50 is returned due to $max ratcheting');

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 50, 'MongoDB $max preserves inflated 50');
      assert.equal(progress.totalMegaApplesEaten, 50);
    });

    it('5.17 Previously undercounted counters', async () => {
      const u = await User.create({
        username: 'sp_proj_u17',
        email: 'sp_u17@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u._id, balance: 100 });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 1,
        highestUnlockedLevel: 1,
        totalGoldenApplesEaten: 0, // undercounted from prior bug
      });

      // 3 completed sessions
      for (let i = 0; i < 3; i++) {
        await GameSession.create({
          userId: u._id,
          levelId: testLevel8806._id,
          levelNumber: 8806,
          status: 'COMPLETED',
          moves: 3,
          goldenApplesCollected: 1,
          starsEarned: 3,
          rewardClaimed: true,
          initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
        });
      }

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 3);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 3, 'Undercounted total corrected from 0 to 3');
    });

    it('5.18 All four counters simultaneously', async () => {
      const u = await User.create({
        username: 'sp_proj_u18',
        email: 'sp_u18@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 1,
        highestUnlockedLevel: 8808,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Session with golden, mega, time
      await GameSession.create({
        userId: u._id,
        levelId: testLevel._id,
        levelNumber: 8801,
        status: 'COMPLETED',
        moves: 4,
        goldenApplesCollected: 1,
        megaApplesCollected: 1,
        timeApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      // Session with mystery
      await GameSession.create({
        userId: u._id,
        levelId: testLevel8805._id,
        levelNumber: 8805,
        status: 'COMPLETED',
        moves: 3,
        mysteryApplesCollected: 1,
        starsEarned: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 1);
      assert.equal(totals.mega, 1);
      assert.equal(totals.time, 1);
      assert.equal(totals.mystery, 1);

      const progress = await PlayerProgress.findOne({ userId: u._id });
      assert.equal(progress.totalGoldenApplesEaten, 1);
      assert.equal(progress.totalMegaApplesEaten, 1);
      assert.equal(progress.totalTimeApplesEaten, 1);
      assert.equal(progress.totalMysteryApplesEaten, 1);
    });

    it('5.19 Session records with missing special apple fields', async () => {
      const u = await User.create({
        username: 'sp_proj_u19',
        email: 'sp_u19@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      // Session 1: goldenApplesCollected is missing, but rewardBreakdown has goldenApplesCount: 2
      await GameSession.create({
        userId: u._id,
        levelId: testLevel8806._id,
        levelNumber: 8806,
        status: 'COMPLETED',
        moves: 3,
        rewardClaimed: true,
        rewardBreakdown: {
          goldenApplesCount: 2,
          megaApplesCount: 1,
        },
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      // Session 2: completely blank session (no special apple fields at all)
      await GameSession.create({
        userId: u._id,
        levelId: testLevel8803._id,
        levelNumber: 8803,
        status: 'COMPLETED',
        moves: 3,
        rewardClaimed: true,
        initialState: { worm: [{ x: 2, y: 2 }, { x: 1, y: 2 }] },
      });

      const totals = await gameSessionService.syncPlayerSpecialApples(u._id);
      assert.equal(totals.golden, 2, 'Fallback to rewardBreakdown.goldenApplesCount');
      assert.equal(totals.mega, 1, 'Fallback to rewardBreakdown.megaApplesCount');
      assert.equal(totals.time, 0, 'Missing field evaluates to 0');
      assert.equal(totals.mystery, 0, 'Missing field evaluates to 0');
    });

    it('5.20 Wallet coin reward idempotency unaffected', async () => {
      const u = await User.create({
        username: 'sp_proj_u20',
        email: 'sp_u20@apple-regression.com',
        password: 'SecurePassword123!',
      });
      await PlayerProgress.create({
        userId: u._id,
        currentLevel: 8806,
        highestUnlockedLevel: 8808,
        completedLevels: [],
      });
      await Wallet.create({ userId: u._id, balance: 100 });

      const s = await gameSessionService.startSession(u._id, 8806);
      await gameSessionService.saveCheckpoint(s._id, u._id, {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesRemaining: [],
      });
      await gameSessionService.completeSession(s._id, u._id);

      const walletBefore = await Wallet.findOne({ userId: u._id });
      assert.equal(walletBefore.balance, 155); // 100 + 25 + 20 + 10

      // Call syncPlayerSpecialApples repeatedly
      await gameSessionService.syncPlayerSpecialApples(u._id);
      await gameSessionService.syncPlayerSpecialApples(u._id);

      const walletAfter = await Wallet.findOne({ userId: u._id });
      assert.equal(walletAfter.balance, 155, 'Repeated sync has zero effect on wallet balance');
    });
  });
});
