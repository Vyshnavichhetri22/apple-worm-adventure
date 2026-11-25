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

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_test';
    assertValidTestTarget(mongoUri);
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Clean fixtures scoped to this regression suite
    await User.collection.deleteMany({ email: /@apple-regression\.com$/ });
    await Level.collection.deleteMany({ levelNumber: 8801 });

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
  });

  after(async () => {
    if (testUser) {
      await User.collection.deleteOne({ _id: testUser._id });
      await GameSession.collection.deleteMany({ userId: testUser._id });
      await PlayerProgress.collection.deleteMany({ userId: testUser._id });
      await Wallet.collection.deleteMany({ userId: testUser._id });
    }
    await Level.collection.deleteMany({ levelNumber: 8801 });
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
});
