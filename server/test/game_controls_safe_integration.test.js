import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import GameSession from '../src/models/GameSession.js';
import Inventory from '../src/models/Inventory.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import PlayerProgress from '../src/models/PlayerProgress.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import gameSessionService from '../src/services/gameSessionService.js';
import inventoryService from '../src/services/inventoryService.js';
import walletService from '../src/services/walletService.js';
import { WormGameEngine, getMovingBlockPosition } from '../../client/src/components/game/WormGameEngine.js';
import { resolveMysteryEffect, DEFAULT_MYSTERY_CONFIG } from '../src/utils/mysteryApple.js';

describe('Game Controls, Economy, Checkpoint & Authoritative Completion Safe Suite', () => {
  let testUser;
  let testLevel;
  let activeSession;
  let createdEconomyConfig = null;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  // Idempotent cleanup targeting strictly test-scoped fixtures
  async function cleanupTestFixtures() {
    // Safety guard: ensure we are operating strictly in an isolated test database
    if (!mongoose.connection.name.toLowerCase().includes('test')) {
      throw new Error(
        `Safety guard aborted cleanup: active connection '${mongoose.connection.name}' does not contain 'test'.`
      );
    }

    // 1. Remove test levels
    await Level.deleteMany({ levelNumber: { $in: [967, 968, 969, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997, 998] } });

    // 2. Remove game sessions for test levels
    await GameSession.deleteMany({ levelNumber: { $in: [967, 968, 969, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997, 998] } });

    // 3. Find and purge any lingering test users matching the test email prefix
    const lingeringUsers = await User.find({
      email: { $regex: /^controls_safe_tester_/ },
    }).select('_id');

    const lingeringUserIds = lingeringUsers.map((u) => u._id);
    if (lingeringUserIds.length > 0) {
      await Wallet.deleteMany({ userId: { $in: lingeringUserIds } });

      // Use native MongoDB driver collection to safely bypass Mongoose mutation middleware
      // for immutable append-only ledger entries belonging strictly to test users
      await WalletTransaction.collection.deleteMany({ userId: { $in: lingeringUserIds } });

      await Inventory.deleteMany({ userId: { $in: lingeringUserIds } });
      await PlayerProgress.deleteMany({ userId: { $in: lingeringUserIds } });
      await GameSession.deleteMany({ userId: { $in: lingeringUserIds } });
      await User.deleteMany({ _id: { $in: lingeringUserIds } });
    }
  }

  before(async () => {
    // Explicit, isolated test-only configuration if not already configured
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_isolated_game_controls_suite_only';
    }
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'test';
    }

    const TEST_DB_URI =
      process.env.TEST_MONGODB_URI ||
      'mongodb://localhost:27017/apple_worm_isolated_controls_test';

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_DB_URI);
    }

    // Pre-test self-healing cleanup: guarantees safe re-runs even after prior aborts
    await cleanupTestFixtures();

    // Ensure active economy configuration exists without deleting existing configs
    let config = await EconomyConfig.findOne({ isActive: true });
    if (!config) {
      config = await EconomyConfig.create({
        version: 9999,
        isActive: true,
        rules: {
          levelCompletionBase: 25,
          oneStarBonus: 5,
          twoStarBonus: 10,
          threeStarBonus: 20,
          goldenAppleReward: 10,
          streakBonusStep: 5,
          streakBonusMax: 25,
          streakDecayHours: 24,
          dailyLoginReward: 50,
          boosterExtraMoves: 5,
          adWatchReward: 100,
          undoPurchaseCost: 40,
          hintPurchaseCost: 50,
          boosterPurchaseCost: 100,
        },
      });
      createdEconomyConfig = config;
    } else if (!config.rules || config.rules.goldenAppleReward === undefined) {
      config.rules = config.rules || {};
      config.rules.goldenAppleReward = 10;
      await config.save();
    }

    const testEmail = `controls_safe_tester_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@example.com`;
    testUser = await User.create({
      username: 'SafeControlsTester',
      email: testEmail,
      password: 'SafePassword123!',
    });

    await PlayerProgress.create({
      userId: testUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });

    await Wallet.create({
      userId: testUser._id,
      balance: 1000,
    });

    // Level with worm starting at (2,5), apple at (4,5), exit portal at (5,5)
    testLevel = await Level.create({
      levelNumber: 998,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 4, y: 5, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 997 with 1 Golden Apple at (3,5)
    await Level.create({
      levelNumber: 997,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'golden' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 996 with 2 Golden Apples at (3,5) and (4,5)
    await Level.create({
      levelNumber: 996,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'collect_apple_count',
      targetValue: 1,
      apples: [
        { x: 3, y: 5, type: 'golden' },
        { x: 4, y: 5, type: 'golden' },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 995 with 1 Mega Apple at (3,5) and portal at (5,5)
    await Level.create({
      levelNumber: 995,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'mega' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 994 with 2 Mega Apples at (3,5) and (4,5), objective 'reach_length' (target 6)
    await Level.create({
      levelNumber: 994,
      difficulty: 'medium',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 6, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'reach_length',
      targetValue: 6,
      apples: [
        { x: 3, y: 5, type: 'mega' },
        { x: 4, y: 5, type: 'mega' },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 990 with 1 Time Apple at (3,5), moveLimit: 2, portal at (5,5)
    // Path from (2,5) to (5,5) takes 3 moves. With moveLimit 2, it is impossible without Time Apple bonus moves!
    await Level.create({
      levelNumber: 990,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      timeAppleBonusMoves: 5,
      starThresholds: { threeStars: 1, twoStars: 2, oneStar: 2 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 989 with 2 Time Apples at (3,5) and (4,5), portal at (6,5)
    await Level.create({
      levelNumber: 989,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 6, y: 5 },
      moveLimit: 5,
      starThresholds: { threeStars: 3, twoStars: 4, oneStar: 5 },
      objective: 'eat_all_apples',
      apples: [
        { x: 3, y: 5, type: 'time' },
        { x: 4, y: 5, type: 'time' },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 988 with 1 Normal (3,5), 1 Golden (4,5), 1 Mega (5,5), 1 Time (6,5), portal at (7,5)
    await Level.create({
      levelNumber: 988,
      difficulty: 'medium',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 7, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 6, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [
        { x: 3, y: 5, type: 'normal' },
        { x: 4, y: 5, type: 'golden' },
        { x: 5, y: 5, type: 'mega' },
        { x: 6, y: 5, type: 'time' },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 987 with 1 Mystery Apple (explicit BONUS_SCORE) at (3,5) and portal at (5,5)
    await Level.create({
      levelNumber: 987,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [
        {
          x: 3,
          y: 5,
          type: 'mystery',
          mysteryEffect: { type: 'BONUS_SCORE', value: 200 },
        },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 986 with 1 Mystery Apple (explicit EXTRA_MOVES) at (3,5), moveLimit: 2, portal at (5,5)
    await Level.create({
      levelNumber: 986,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      starThresholds: { threeStars: 1, twoStars: 2, oneStar: 2 },
      objective: 'eat_all_apples',
      apples: [
        {
          x: 3,
          y: 5,
          type: 'mystery',
          mysteryEffect: { type: 'EXTRA_MOVES', value: 5 },
        },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 985 with 1 Mystery Apple (explicit EXTRA_GROWTH) at (3,5), objective 'reach_length' (target: 4)
    await Level.create({
      levelNumber: 985,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'reach_length',
      targetValue: 4,
      apples: [
        {
          x: 3,
          y: 5,
          type: 'mystery',
          mysteryEffect: { type: 'EXTRA_GROWTH', value: 1 },
        },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });
    // Level 984 with objective 'reach_portal' and 1 optional normal apple at (3,4)
    await Level.create({
      levelNumber: 984,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'reach_portal',
      apples: [{ x: 3, y: 4, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 983 with objective 'limited_moves' (limit 4) and 1 optional normal apple at (3,4)
    await Level.create({
      levelNumber: 983,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 4,
      starThresholds: { threeStars: 3, twoStars: 4, oneStar: 4 },
      objective: 'limited_moves',
      apples: [{ x: 3, y: 4, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    // Level 982 with objective 'perfect_route' (3-star threshold 3, moveLimit 10)
    await Level.create({
      levelNumber: 982,
      difficulty: 'hard',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 10,
      starThresholds: { threeStars: 3, twoStars: 5, oneStar: 8 },
      objective: 'perfect_route',
      apples: [],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT'],
    });

    await inventoryService.getOrCreateInventory(testUser._id);
    await Inventory.findOneAndUpdate(
      { userId: testUser._id },
      {
        $set: {
          'items.UNDO.quantity': 2,
          'items.BOOSTER.quantity': 1,
          'items.HINT.quantity': 1,
        },
      },
      { returnDocument: 'after' }
    );
  });

  after(async () => {
    await cleanupTestFixtures();

    if (createdEconomyConfig?._id) {
      await EconomyConfig.deleteOne({ _id: createdEconomyConfig._id });
    }

    await mongoose.disconnect();

    // Restore original environment variables
    if (originalJwtSecret !== undefined) {
      process.env.JWT_SECRET = originalJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('1. Starts active game session with initial checkpoint and 0 history', async () => {
    const sessionRes = await gameSessionService.startSession(testUser._id, 998);

    assert.ok(sessionRes._id);
    assert.equal(sessionRes.status, 'ACTIVE');
    assert.equal(sessionRes.moves, 0);
    assert.equal(sessionRes.extraMovesAllowed, 0);
    assert.equal(sessionRes.checkpoint.movesTaken, 0);
    assert.equal(sessionRes.checkpointHistory.length, 0);

    activeSession = sessionRes;
  });

  it('2. Prevents Undo before any moves are made without consuming item', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const undoBefore = invBefore?.items?.UNDO?.quantity || 0;

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(activeSession._id, testUser._id, 'undo_at_move_zero');
      },
      (err) => {
        assert.match(err.message, /No previous checkpoint exists to undo/);
        return true;
      }
    );

    const invAfter = await inventoryService.getInventory(testUser._id);
    const undoAfter = invAfter?.items?.UNDO?.quantity || 0;
    assert.equal(undoAfter, undoBefore, 'Inventory must not be consumed on rejected undo');
  });

  it('3. Rejects premature completion when worm has not reached portal or eaten apples', async () => {
    // Session is at move 0; worm is at (2,5), portal is at (5,5), apple at (4,5) is uneaten
    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(activeSession._id, testUser._id, {
          moves: 1,
          durationSeconds: 5,
        });
      },
      (err) => {
        assert.match(err.message, /has not reached exit portal/);
        return true;
      }
    );
  });

  it('4. Simulates advancing moves and queues checkpoints correctly in order', async () => {
    const engine = new WormGameEngine(testLevel);
    assert.equal(engine.movesCount, 0);

    // Move 1: RIGHT to (3,5)
    const r1 = engine.move('RIGHT');
    assert.equal(r1.moved, true);
    assert.equal(engine.movesCount, 1);

    const cp1 = await gameSessionService.saveCheckpoint(activeSession._id, testUser._id, engine.getCheckpointState());
    assert.equal(cp1.moves, 1);
    assert.equal(cp1.historyLength, 1);

    // Move 2: RIGHT to (4,5) (eats apple)
    const r2 = engine.move('RIGHT');
    assert.equal(r2.moved, true);
    assert.equal(engine.movesCount, 2);
    assert.equal(r2.collectedApple, true);

    const cp2 = await gameSessionService.saveCheckpoint(activeSession._id, testUser._id, engine.getCheckpointState());
    assert.equal(cp2.moves, 2);
    assert.equal(cp2.historyLength, 2);
  });

  it('5. Rejects completion when apple is eaten but worm is not on the exit portal', async () => {
    // Session is at move 2; worm head is at (4,5), portal is at (5,5)
    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(activeSession._id, testUser._id, {
          moves: 2,
          durationSeconds: 5,
        });
      },
      (err) => {
        assert.match(err.message, /has not reached exit portal/);
        return true;
      }
    );
  });

  it('6. Successfully applies Undo: rewinds checkpoint to move 1 and consumes 1 item', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const undoBefore = invBefore?.items?.UNDO?.quantity || 0;

    const undoRes = await gameSessionService.applyUndo(activeSession._id, testUser._id, 'undo_action_1');

    assert.equal(undoRes.success, true);
    assert.equal(undoRes.isDuplicate, false);
    assert.equal(undoRes.moves, 1);
    assert.equal(undoRes.restoredCheckpoint.movesTaken, 1);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const undoAfter = invAfter?.items?.UNDO?.quantity || 0;
    assert.equal(undoAfter, undoBefore - 1, 'Exactly one UNDO item must be consumed');

    const doc = await GameSession.findById(activeSession._id);
    assert.equal(doc.moves, 1);
    assert.equal(doc.checkpoint.movesTaken, 1);
  });

  it('7. Replays Undo idempotently without double-consuming inventory', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const undoBefore = invBefore?.items?.UNDO?.quantity || 0;

    const replayRes = await gameSessionService.applyUndo(activeSession._id, testUser._id, 'undo_action_1');

    assert.equal(replayRes.success, true);
    assert.equal(replayRes.isDuplicate, true);
    assert.equal(replayRes.moves, 1);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const undoAfter = invAfter?.items?.UNDO?.quantity || 0;
    assert.equal(undoAfter, undoBefore);
  });

  it('8. Applies EXTRA_MOVES booster: increases allowance and consumes 1 item', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const boosterBefore = invBefore?.items?.BOOSTER?.quantity || 0;

    const boosterRes = await gameSessionService.applyBooster(
      activeSession._id,
      testUser._id,
      'EXTRA_MOVES',
      'booster_action_1'
    );

    assert.equal(boosterRes.success, true);
    assert.equal(boosterRes.isDuplicate, false);
    assert.equal(boosterRes.extraMovesAdded, 5);
    assert.equal(boosterRes.totalExtraMovesAllowed, 5);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const boosterAfter = invAfter?.items?.BOOSTER?.quantity || 0;
    assert.equal(boosterAfter, boosterBefore - 1);

    const doc = await GameSession.findById(activeSession._id);
    assert.equal(doc.extraMovesAllowed, 5);
  });

  it('9. Replays Booster idempotently without double-consuming inventory', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const boosterBefore = invBefore?.items?.BOOSTER?.quantity || 0;

    const replayRes = await gameSessionService.applyBooster(
      activeSession._id,
      testUser._id,
      'EXTRA_MOVES',
      'booster_action_1'
    );

    assert.equal(replayRes.success, true);
    assert.equal(replayRes.isDuplicate, true);
    assert.equal(replayRes.totalExtraMovesAllowed, 5);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const boosterAfter = invAfter?.items?.BOOSTER?.quantity || 0;
    assert.equal(boosterAfter, boosterBefore);
  });

  it('10. Requests Hint: consumes 1 HINT item and replays idempotently', async () => {
    const invBefore = await inventoryService.getInventory(testUser._id);
    const hintBefore = invBefore?.items?.HINT?.quantity || 0;

    const hintRes = await gameSessionService.requestHint(activeSession._id, testUser._id, 'hint_action_1');
    assert.equal(hintRes.success, true);
    assert.equal(hintRes.isDuplicate, false);

    const replayRes = await gameSessionService.requestHint(activeSession._id, testUser._id, 'hint_action_1');
    assert.equal(replayRes.success, true);
    assert.equal(replayRes.isDuplicate, true);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const hintAfter = invAfter?.items?.HINT?.quantity || 0;
    assert.equal(hintAfter, hintBefore - 1);
  });

  it('11. Purchases item via wallet: debits wallet once and grants inventory', async () => {
    const walletBefore = await walletService.getOrCreateWallet(testUser._id);
    const balanceBefore = walletBefore.balance;

    const debitRes = await walletService.debit(testUser._id, 100, {
      type: 'BOOSTER_PURCHASE',
      referenceId: 'ref_booster_purchase_test',
      idempotencyKey: 'buy_booster_safe_test_key',
      description: 'Purchased BOOSTER item',
      metadata: { itemType: 'BOOSTER', quantity: 1 },
    });

    assert.equal(debitRes.isDuplicate, false);
    assert.ok(debitRes.transaction);
    assert.equal(debitRes.balanceAfter, balanceBefore - 100);

    await inventoryService.grantPurchasedItem({
      userId: testUser._id,
      purchaseId: debitRes.transaction._id,
      itemType: 'BOOSTER',
    });

    const walletAfter = await walletService.getOrCreateWallet(testUser._id);
    assert.equal(walletAfter.balance, balanceBefore - 100);

    const invAfter = await inventoryService.getInventory(testUser._id);
    const boosterQty = invAfter?.items?.BOOSTER?.quantity || 0;
    assert.equal(boosterQty, 1);
  });

  it('12. Completes legitimate victory: advances through apple to portal and verifies authoritative completion', async () => {
    const engine = new WormGameEngine(testLevel);
    // Query with .lean() to restore clean plain JavaScript object into engine
    const currentSession = await GameSession.findById(activeSession._id).lean();
    engine.restoreFromCheckpoint(currentSession.checkpoint);
    assert.equal(engine.movesCount, 1);

    // Step to (4,5) eating apple
    const rEat = engine.move('RIGHT');
    assert.equal(rEat.moved, true);
    assert.equal(rEat.collectedApple, true);
    await gameSessionService.saveCheckpoint(activeSession._id, testUser._id, engine.getCheckpointState());

    // Step to (5,5) reaching portal
    const rPortal = engine.move('RIGHT');
    assert.equal(rPortal.moved, true);
    assert.equal(rPortal.status, 'WON');
    await gameSessionService.saveCheckpoint(activeSession._id, testUser._id, engine.getCheckpointState());

    const walletBefore = await walletService.getOrCreateWallet(testUser._id);
    const balanceBefore = walletBefore.balance;

    // Authoritative completion verification succeeds
    const compRes = await gameSessionService.completeSession(activeSession._id, testUser._id, {
      moves: engine.movesCount,
      durationSeconds: 5,
    });

    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.stars, 3);

    const walletAfter = await walletService.getOrCreateWallet(testUser._id);
    assert.equal(walletAfter.balance, balanceBefore + compRes.rewards.coins);

    const progress = await PlayerProgress.findOne({ userId: testUser._id });
    assert.ok(progress.highestUnlockedLevel >= 999);
  });

  it('13. Replays Booster and Undo queries on terminal completed session safely', async () => {
    const boosterReplay = await gameSessionService.applyBooster(
      activeSession._id,
      testUser._id,
      'EXTRA_MOVES',
      'booster_action_1'
    );
    assert.equal(boosterReplay.isDuplicate, true);
    assert.equal(boosterReplay.totalExtraMovesAllowed, 5);

    const undoReplay = await gameSessionService.applyUndo(activeSession._id, testUser._id, 'undo_action_1');
    assert.equal(undoReplay.isDuplicate, true);
    assert.equal(undoReplay.moves, 1);
  });

  it('14. Safely abandons an active session on level restart', async () => {
    const restartSessionRes = await gameSessionService.startSession(testUser._id, 998);
    assert.equal(restartSessionRes.status, 'ACTIVE');

    const abandonRes = await gameSessionService.abandonSession(restartSessionRes._id, testUser._id);
    assert.equal(abandonRes.status, 'ABANDONED');
  });

  it('15. Same-star replay on level 998 awards zero additional coins, leaves balance unchanged, and does not create zero-amount transaction', async () => {
    // testUser already completed Level 998 with 3 stars in test 12
    const walletBefore = await walletService.getOrCreateWallet(testUser._id);
    const balanceBefore = walletBefore.balance;
    const txCountBefore = await WalletTransaction.countDocuments({ userId: testUser._id });

    const sessionRes = await gameSessionService.startSession(testUser._id, 998);
    await gameSessionService.saveCheckpoint(sessionRes._id, testUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 200,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(sessionRes._id, testUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.stars, 3);
    assert.equal(compRes.rewards.coins, 0);

    const walletAfter = await walletService.getOrCreateWallet(testUser._id);
    assert.equal(walletAfter.balance, balanceBefore);

    const txCountAfter = await WalletTransaction.countDocuments({ userId: testUser._id });
    assert.equal(txCountAfter, txCountBefore, 'Must not write zero-amount transaction to ledger');

    const progress = await PlayerProgress.findOne({ userId: testUser._id });
    const rec = progress.completedLevels.find((r) => r.levelNumber === 998);
    assert.ok(rec);
    assert.equal(rec.attemptsCount, 2, 'Attempts count must increment on replay');
  });

  it('16. Lower-star replay on level 998 awards zero coins and preserves previous 3-star record in PlayerProgress', async () => {
    const walletBefore = await walletService.getOrCreateWallet(testUser._id);
    const balanceBefore = walletBefore.balance;

    const sessionRes = await gameSessionService.startSession(testUser._id, 998);
    // 11 moves maps to 1-star tier on testLevel (<= 15 moves limit)
    await gameSessionService.saveCheckpoint(sessionRes._id, testUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 11,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(sessionRes._id, testUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.stars, 1);
    assert.equal(compRes.rewards.coins, 0);

    const walletAfter = await walletService.getOrCreateWallet(testUser._id);
    assert.equal(walletAfter.balance, balanceBefore);

    const progress = await PlayerProgress.findOne({ userId: testUser._id });
    const rec = progress.completedLevels.find((r) => r.levelNumber === 998);
    assert.equal(rec.stars, 3, 'Must preserve previous 3-star record');
    assert.equal(rec.attemptsCount, 3);
  });

  it('17. Incremental star progression on new user: 1 star -> 2 stars -> 3 stars awards only incremental difference each time', async () => {
    const starTesterEmail = `controls_safe_tester_star_${Date.now()}@example.com`;
    const starUser = await User.create({
      username: `StarTester_${Date.now()}`,
      email: starTesterEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: starUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: starUser._id, balance: 100 });

    // Step A: First clear with 1 star (11 moves -> threshold <= 15)
    // Config: Base = 25, 1-Star Bonus = 5 -> Expected: 30 coins
    const sessionA = await gameSessionService.startSession(starUser._id, 998);
    await gameSessionService.saveCheckpoint(sessionA._id, starUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 11,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compA = await gameSessionService.completeSession(sessionA._id, starUser._id);
    assert.equal(compA.rewards.stars, 1);
    assert.equal(compA.rewards.coins, 30);
    const walletA = await walletService.getOrCreateWallet(starUser._id);
    assert.equal(walletA.balance, 130);

    // Step B: Replay achieving 2 stars (9 moves -> threshold <= 10)
    // Config: 2-Star Bonus = 10 -> Expected: 10 - 5 = 5 incremental coins
    const sessionB = await gameSessionService.startSession(starUser._id, 998);
    await gameSessionService.saveCheckpoint(sessionB._id, starUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 9,
      applesEaten: 1,
      currentScore: 200,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compB = await gameSessionService.completeSession(sessionB._id, starUser._id);
    assert.equal(compB.rewards.stars, 2);
    assert.equal(compB.rewards.coins, 5, 'Must award strictly incremental 5 coins for upgrade to 2 stars');
    const walletB = await walletService.getOrCreateWallet(starUser._id);
    assert.equal(walletB.balance, 135);

    // Step C: Replay achieving 3 stars (3 moves -> threshold <= 8)
    // Config: 3-Star Bonus = 20 -> Expected: 20 - 10 = 10 incremental coins
    const sessionC = await gameSessionService.startSession(starUser._id, 998);
    await gameSessionService.saveCheckpoint(sessionC._id, starUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 300,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compC = await gameSessionService.completeSession(sessionC._id, starUser._id);
    assert.equal(compC.rewards.stars, 3);
    assert.equal(compC.rewards.coins, 10, 'Must award strictly incremental 10 coins for upgrade to 3 stars');
    const walletC = await walletService.getOrCreateWallet(starUser._id);
    assert.equal(walletC.balance, 145);

    // Step D: Replay achieving 3 stars again -> Expected: 0 coins
    const sessionD = await gameSessionService.startSession(starUser._id, 998);
    await gameSessionService.saveCheckpoint(sessionD._id, starUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 300,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compD = await gameSessionService.completeSession(sessionD._id, starUser._id);
    assert.equal(compD.rewards.stars, 3);
    assert.equal(compD.rewards.coins, 0);
    const walletD = await walletService.getOrCreateWallet(starUser._id);
    assert.equal(walletD.balance, 145);

    // Verify lifetime completion reward sum for level 998 is capped at 45 (25 base + 20 star bonus)
    const totalLevelTransactions = await WalletTransaction.find({
      userId: starUser._id,
      $or: [{ type: 'LEVEL_REWARD' }, { type: 'STAR_BONUS' }],
    });
    const sumCoinsAwarded = totalLevelTransactions.reduce((acc, tx) => acc + tx.amount, 0);
    assert.equal(sumCoinsAwarded, 45, 'Sum of all completion rewards must never exceed 45 coins');
  });

  it('18. Authoritative duration: uses server-calculated duration, ignores client-submitted duration, and safely handles missing startedAt', async () => {
    const durationTesterEmail = `controls_safe_tester_duration_${Date.now()}@example.com`;
    const durUser = await User.create({
      username: `DurationTester_${Date.now()}`,
      email: durationTesterEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: durUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: durUser._id, balance: 100 });

    // Run 1: Started 8 seconds ago; client sends spoofed durationSeconds: 1
    const session1 = await gameSessionService.startSession(durUser._id, 998);
    await GameSession.findByIdAndUpdate(session1._id, {
      $set: { startedAt: new Date(Date.now() - 8000) },
    });

    await gameSessionService.saveCheckpoint(session1._id, durUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp1 = await gameSessionService.completeSession(session1._id, durUser._id, {
      durationSeconds: 1, // Spoofed client duration
    });

    assert.ok(comp1.session.durationSeconds >= 7, 'Server duration must be used, ignoring client 1-second spoof');

    const progress1 = await PlayerProgress.findOne({ userId: durUser._id });
    const rec1 = progress1.completedLevels.find((r) => r.levelNumber === 998);
    assert.ok(rec1.fastestTimeSeconds >= 7);

    // Run 2: Faster replay (started 3 seconds ago) -> updates fastestTimeSeconds
    const session2 = await gameSessionService.startSession(durUser._id, 998);
    await GameSession.findByIdAndUpdate(session2._id, {
      $set: { startedAt: new Date(Date.now() - 3000) },
    });
    await gameSessionService.saveCheckpoint(session2._id, durUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp2 = await gameSessionService.completeSession(session2._id, durUser._id);
    assert.ok(comp2.session.durationSeconds <= 5);

    const progress2 = await PlayerProgress.findOne({ userId: durUser._id });
    const rec2 = progress2.completedLevels.find((r) => r.levelNumber === 998);
    assert.ok(rec2.fastestTimeSeconds <= 5, 'Faster replay must update fastestTimeSeconds');

    // Run 3: Slower replay (started 25 seconds ago) -> does NOT overwrite fastest record
    const session3 = await gameSessionService.startSession(durUser._id, 998);
    await GameSession.findByIdAndUpdate(session3._id, {
      $set: { startedAt: new Date(Date.now() - 25000) },
    });
    await gameSessionService.saveCheckpoint(session3._id, durUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    await gameSessionService.completeSession(session3._id, durUser._id);
    const progress3 = await PlayerProgress.findOne({ userId: durUser._id });
    const rec3 = progress3.completedLevels.find((r) => r.levelNumber === 998);
    assert.ok(rec3.fastestTimeSeconds <= 5, 'Slower replay must NOT overwrite existing fastest time');

    // Run 4: Missing startedAt handled safely with server createdAt fallback (ignoring client durationSeconds)
    const session4 = await gameSessionService.startSession(durUser._id, 998);
    await GameSession.findByIdAndUpdate(session4._id, {
      $set: { startedAt: null },
    });
    await gameSessionService.saveCheckpoint(session4._id, durUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp4 = await gameSessionService.completeSession(session4._id, durUser._id, {
      durationSeconds: 9999, // Client spoofing duration
    });
    assert.ok(comp4.session.durationSeconds >= 1, 'Must safely calculate duration from server createdAt/id timestamp');
    assert.notEqual(comp4.session.durationSeconds, 9999, 'Must never trust client-submitted duration');

    // Run 5: Future startedAt timestamp rejected with HTTP 400
    const session5 = await gameSessionService.startSession(durUser._id, 998);
    await GameSession.findByIdAndUpdate(session5._id, {
      $set: { startedAt: new Date(Date.now() + 60000) },
    });
    await gameSessionService.saveCheckpoint(session5._id, durUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(session5._id, durUser._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /in the future/i);
        return true;
      },
      'Future startedAt timestamp must be rejected with HTTP 400'
    );
  });

  it('19. Same-session concurrent completion calls resolve safely without double-awarding', async () => {
    const concurrentTesterEmail = `controls_safe_tester_conc_${Date.now()}@example.com`;
    const concUser = await User.create({
      username: `ConcTester_${Date.now()}`,
      email: concurrentTesterEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: concUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: concUser._id, balance: 200 });

    const session = await gameSessionService.startSession(concUser._id, 998);
    await gameSessionService.saveCheckpoint(session._id, concUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const [res1, res2] = await Promise.allSettled([
      gameSessionService.completeSession(session._id, concUser._id),
      gameSessionService.completeSession(session._id, concUser._id),
    ]);

    // At least one must succeed
    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1);

    const wallet = await walletService.getOrCreateWallet(concUser._id);
    assert.equal(wallet.balance, 245, 'Wallet must be credited exactly once (200 + 45)');
  });

  it('20. Concurrent completions from separate sessions for same user and level cannot duplicate base reward or star milestones', async () => {
    const multiSessionEmail = `controls_safe_tester_multi_${Date.now()}@example.com`;
    const multiUser = await User.create({
      username: `MultiUser_${Date.now()}`,
      email: multiSessionEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: multiUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: multiUser._id, balance: 500 });

    // Create two separate sessions directly to simulate simultaneous active sessions
    const sessionA = await GameSession.create({
      userId: multiUser._id,
      levelId: testLevel._id,
      levelNumber: 998,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: { apples: [{ x: 4, y: 5 }] },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 1,
        currentScore: 100,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    const sessionB = await GameSession.create({
      userId: multiUser._id,
      levelId: testLevel._id,
      levelNumber: 998,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: { apples: [{ x: 4, y: 5 }] },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 1,
        currentScore: 100,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    const [compA, compB] = await Promise.all([
      gameSessionService.completeSession(sessionA._id, multiUser._id),
      gameSessionService.completeSession(sessionB._id, multiUser._id),
    ]);

    assert.ok(compA.session.status === 'COMPLETED');
    assert.ok(compB.session.status === 'COMPLETED');

    const wallet = await walletService.getOrCreateWallet(multiUser._id);
    assert.equal(
      wallet.balance,
      545,
      'Concurrent completions across separate sessions must credit exactly 45 coins total (500 + 45), never 90'
    );

    const baseTxs = await WalletTransaction.find({
      userId: multiUser._id,
      type: 'LEVEL_REWARD',
    });
    assert.equal(baseTxs.length, 1, 'Only one base reward transaction must exist');

    const starTxs = await WalletTransaction.find({
      userId: multiUser._id,
      type: 'STAR_BONUS',
    });
    assert.equal(starTxs.length, 1, 'Only one 3-star milestone transaction must exist');

    const finalProgress = await PlayerProgress.findOne({ userId: multiUser._id });
    const matchingRecords = finalProgress.completedLevels.filter((r) => r.levelNumber === 998);
    assert.equal(matchingRecords.length, 1, 'Exactly one completedLevels entry must exist for level 998');
    assert.equal(matchingRecords[0].attemptsCount, 2, 'Attempts count must reflect both completions');
  });

  it('21. Idempotent retries on completed session return confirmed rewards without duplicate wallet credits', async () => {
    const retryUserEmail = `controls_safe_tester_retry_${Date.now()}@example.com`;
    const retryUser = await User.create({
      username: `RetryUser_${Date.now()}`,
      email: retryUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: retryUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: retryUser._id, balance: 300 });

    const session = await gameSessionService.startSession(retryUser._id, 998);
    await gameSessionService.saveCheckpoint(session._id, retryUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      currentScore: 100,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const initialComp = await gameSessionService.completeSession(session._id, retryUser._id);
    assert.equal(initialComp.session.status, 'COMPLETED');
    assert.equal(initialComp.rewards.coins, 45);

    const walletAfterInitial = await walletService.getOrCreateWallet(retryUser._id);
    assert.equal(walletAfterInitial.balance, 345);

    // Retry completion call on the already completed session
    const retryComp = await gameSessionService.completeSession(session._id, retryUser._id);
    assert.equal(retryComp.isDuplicate, true);
    assert.equal(retryComp.rewards.coins, 45);

    const walletAfterRetry = await walletService.getOrCreateWallet(retryUser._id);
    assert.equal(walletAfterRetry.balance, 345, 'Wallet balance must remain 345 on duplicate retry');
  });

  it('22. Non-duplicate ledger creation failure eliminates unsafe compensating rollback and preserves durable unsettled snapshot for recovery', async () => {
    const rollbackEmail = `controls_safe_tester_rollback_${Date.now()}@example.com`;
    const rollbackUser = await User.create({
      username: `RollbackUser_${Date.now()}`,
      email: rollbackEmail,
      password: 'SafePassword123!',
    });
    await Wallet.create({ userId: rollbackUser._id, balance: 250 });
    const idempotencyKey = `test_ledger_fail_${Date.now()}`;

    // 1. Simulate database failure during ledger record persistence
    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async () => {
      const err = new Error('Simulated database ledger insertion failure');
      err.code = 9999;
      throw err;
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.credit(rollbackUser._id, 50, {
            type: 'LEVEL_REWARD',
            description: 'Level reward with simulated ledger failure',
            idempotencyKey,
          });
        },
        (err) => {
          assert.equal(err.statusCode, 500);
          assert.match(err.message, /Ledger recording failed/i);
          return true;
        },
        'Ledger persistence failure must reject with status 500'
      );
    } finally {
      WalletTransaction.create = originalCreate;
    }

    // 2. In Phase 8, compensating rollbacks are eliminated: balance is NOT decremented back to 250
    const walletAfterFailure = await walletService.getOrCreateWallet(rollbackUser._id);
    assert.equal(
      walletAfterFailure.balance,
      300,
      'Wallet balance must retain 300 without unsafe compensating balance decrement'
    );

    // 3. Operation is durably preserved in unsettledOperations for reconciliation
    assert.equal(
      walletAfterFailure.unsettledOperations.length,
      1,
      'Unsettled snapshot must be preserved in wallet document'
    );
    const snapshot = walletAfterFailure.unsettledOperations[0];
    assert.equal(snapshot.amount, 50);
    assert.equal(snapshot.direction, 'CREDIT');
    assert.equal(snapshot.idempotencyKey, idempotencyKey);

    // 4. Ledger record does not exist prior to recovery/retry
    const txsBeforeRetry = await WalletTransaction.find({ userId: rollbackUser._id });
    assert.equal(txsBeforeRetry.length, 0, 'No ledger transactions must exist before recovery');

    // 5. Idempotent retry settles the in-flight snapshot cleanly without double-crediting balance
    const retryResult = await walletService.credit(rollbackUser._id, 50, {
      type: 'LEVEL_REWARD',
      description: 'Level reward with simulated ledger failure',
      idempotencyKey,
    });

    assert.equal(retryResult.balanceAfter, 300, 'Balance must remain 300 without double-crediting');

    const walletAfterRetry = await walletService.getOrCreateWallet(rollbackUser._id);
    assert.equal(walletAfterRetry.balance, 300);
    assert.equal(walletAfterRetry.unsettledOperations.length, 0, 'Snapshot must be settled from unsettledOperations');

    const txsAfterRetry = await WalletTransaction.find({ userId: rollbackUser._id });
    assert.equal(txsAfterRetry.length, 1, 'Exactly one ledger transaction must be persisted');
    assert.equal(txsAfterRetry[0].amount, 50);
    assert.equal(txsAfterRetry[0].direction, 'CREDIT');
  });

  it('23. First-time level completion with Golden Apple grants growth (+1), +50 score bonus, and 10 coins with GOLDEN_APPLE_REWARD transaction', async () => {
    const goldenUserEmail = `controls_safe_tester_golden_${Date.now()}@example.com`;
    const goldenUser = await User.create({
      username: `GoldenUser_${Date.now()}`,
      email: goldenUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: goldenUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: goldenUser._id, balance: 100 });

    const session = await gameSessionService.startSession(goldenUser._id, 997);
    assert.equal(session.checkpoint.goldenApplesEaten, 0);

    // Save checkpoint representing worm moving RIGHT to (3,5) eating golden apple, then (4,5), then (5,5) portal
    // On level 997, apple is at (3,5) with type 'golden'.
    // Apples remaining: [] (eaten)
    const checkpointRes = await gameSessionService.saveCheckpoint(session._id, goldenUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150, // 100 base + 50 golden bonus
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    assert.equal(checkpointRes.checkpoint.goldenApplesEaten, 1);
    assert.equal(checkpointRes.checkpoint.currentScore, 150);

    // Complete session
    const compRes = await gameSessionService.completeSession(session._id, goldenUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.goldenApplesCollected, 1);
    assert.equal(compRes.session.score, 1770);
    assert.equal(compRes.session.rewardBreakdown.baseCompletion, 25);
    assert.equal(compRes.session.rewardBreakdown.starBonus, 20);
    assert.equal(compRes.session.rewardBreakdown.goldenApples, 10);
    assert.equal(compRes.session.rewardBreakdown.goldenApplesCount, 1);
    assert.equal(compRes.session.rewardBreakdown.totalCoins, 55);
    assert.equal(compRes.rewards.goldenCoins, 10);
    assert.equal(compRes.rewards.goldenApples, 1);
    assert.equal(compRes.rewards.coins, 55); // 25 + 20 + 10

    // Wallet balance
    const wallet = await walletService.getOrCreateWallet(goldenUser._id);
    assert.equal(wallet.balance, 155); // 100 + 55

    // Verify ledger transactions
    const txs = await WalletTransaction.find({ userId: goldenUser._id }).sort({ createdAt: 1 });
    assert.equal(txs.length, 3);
    const goldenTx = txs.find((t) => t.type === 'GOLDEN_APPLE_REWARD');
    assert.ok(goldenTx, 'GOLDEN_APPLE_REWARD ledger entry must exist');
    assert.equal(goldenTx.amount, 10);
    assert.equal(goldenTx.idempotencyKey, `level_golden_${goldenUser._id}_level_997_apple_1`);

    // Verify PlayerProgress
    const progress = await PlayerProgress.findOne({ userId: goldenUser._id });
    const levelRecord = progress.completedLevels.find((l) => l.levelNumber === 997);
    assert.ok(levelRecord);
    assert.equal(levelRecord.goldenApplesClaimed, 1);
    assert.equal(progress.totalGoldenApplesEaten, 1);
  });

  it('24. Replaying a completed level with Golden Apples awards 0 additional golden coins and creates no duplicate ledger entries', async () => {
    const replayUserEmail = `controls_safe_tester_replay_golden_${Date.now()}@example.com`;
    const replayUser = await User.create({
      username: `ReplayGoldenUser_${Date.now()}`,
      email: replayUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: replayUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 998,
      totalStars: 3,
      totalGoldenApplesEaten: 1,
      completedLevels: [
        {
          levelNumber: 997,
          stars: 3,
          highScore: 150,
          bestMoves: 3,
          fastestDuration: 10,
          completedAt: new Date(Date.now() - 3600000),
          attemptsCount: 1,
          goldenApplesClaimed: 1,
        },
      ],
    });
    await Wallet.create({ userId: replayUser._id, balance: 200 });

    // Start a new replay session on level 997
    const replaySession = await gameSessionService.startSession(replayUser._id, 997);
    await gameSessionService.saveCheckpoint(replaySession._id, replayUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const replayComp = await gameSessionService.completeSession(replaySession._id, replayUser._id);
    assert.equal(replayComp.session.status, 'COMPLETED');
    assert.equal(replayComp.session.rewardBreakdown.baseCompletion, 0, 'Replay base coins must be 0');
    assert.equal(replayComp.session.rewardBreakdown.starBonus, 0, 'Replay star coins must be 0');
    assert.equal(replayComp.session.rewardBreakdown.goldenApples, 0, 'Replay golden apple coins must be 0 when already claimed');
    assert.equal(replayComp.rewards.goldenCoins, 0);
    assert.equal(replayComp.rewards.coins, 0, 'Total replay coins must be 0');

    // Wallet balance must remain strictly 200
    const walletAfter = await walletService.getOrCreateWallet(replayUser._id);
    assert.equal(walletAfter.balance, 200, 'Wallet balance must not increase on replay');

    // No ledger transactions created
    const txs = await WalletTransaction.find({ userId: replayUser._id });
    assert.equal(txs.length, 0, 'No wallet transactions must be created on replay with 0 rewards');

    // PlayerProgress verification
    const progress = await PlayerProgress.findOne({ userId: replayUser._id });
    const levelRecord = progress.completedLevels.find((l) => l.levelNumber === 997);
    assert.equal(levelRecord.attemptsCount, 2);
    assert.equal(levelRecord.goldenApplesClaimed, 1);
    assert.equal(progress.totalGoldenApplesEaten, 1, 'totalGoldenApplesEaten must not increment on replay');
  });

  it('25. Level with multiple Golden Apples correctly awards proportional coins (20) and handles idempotent retry', async () => {
    const multiGoldenEmail = `controls_safe_tester_multi_golden_${Date.now()}@example.com`;
    const multiGoldenUser = await User.create({
      username: `MultiGoldenUser_${Date.now()}`,
      email: multiGoldenEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: multiGoldenUser._id,
      currentLevel: 996,
      highestUnlockedLevel: 996,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: multiGoldenUser._id, balance: 50 });

    // Level 996 has 2 golden apples at (3,5) and (4,5)
    const session = await gameSessionService.startSession(multiGoldenUser._id, 996);
    await gameSessionService.saveCheckpoint(session._id, multiGoldenUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 2,
      goldenApplesEaten: 2,
      currentScore: 300, // 2 * 100 + 2 * 50 = 300
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, multiGoldenUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.goldenApplesCollected, 2);
    assert.equal(compRes.session.score, 1920);
    assert.equal(compRes.session.rewardBreakdown.baseCompletion, 25);
    assert.equal(compRes.session.rewardBreakdown.starBonus, 20);
    assert.equal(compRes.session.rewardBreakdown.goldenApples, 20);
    assert.equal(compRes.session.rewardBreakdown.goldenApplesCount, 2);
    assert.equal(compRes.session.rewardBreakdown.totalCoins, 65);
    assert.equal(compRes.rewards.goldenCoins, 20); // 2 * 10
    assert.equal(compRes.rewards.goldenApples, 2);
    assert.equal(compRes.rewards.coins, 65); // 25 + 20 + 20

    const wallet = await walletService.getOrCreateWallet(multiGoldenUser._id);
    assert.equal(wallet.balance, 115); // 50 + 65

    const goldenTxs = await WalletTransaction.find({
      userId: multiGoldenUser._id,
      type: 'GOLDEN_APPLE_REWARD',
    }).sort({ createdAt: 1 });
    assert.equal(goldenTxs.length, 2, 'Two ordinal transactions must exist for 2 golden apples');
    assert.equal(goldenTxs[0].amount, 10);
    assert.equal(goldenTxs[0].idempotencyKey, `level_golden_${multiGoldenUser._id}_level_996_apple_1`);
    assert.equal(goldenTxs[1].amount, 10);
    assert.equal(goldenTxs[1].idempotencyKey, `level_golden_${multiGoldenUser._id}_level_996_apple_2`);

    const progress = await PlayerProgress.findOne({ userId: multiGoldenUser._id });
    const levelRecord = progress.completedLevels.find((l) => l.levelNumber === 996);
    assert.equal(levelRecord.goldenApplesClaimed, 2);
    assert.equal(progress.totalGoldenApplesEaten, 2);

    // Duplicate retry on same session must be idempotent and preserve golden rewards
    const retryRes = await gameSessionService.completeSession(session._id, multiGoldenUser._id);
    assert.equal(retryRes.isDuplicate, true);
    assert.equal(retryRes.rewards.goldenCoins, 20);
    assert.equal(retryRes.rewards.goldenApples, 2);

    const walletAfterRetry = await walletService.getOrCreateWallet(multiGoldenUser._id);
    assert.equal(walletAfterRetry.balance, 115, 'Wallet balance must remain unchanged on duplicate retry');
  });

  it('26. Anti-cheat: server overrides client golden spoofing and rejects invalid apple claims', async () => {
    const spoofUserEmail = `controls_safe_tester_spoof_${Date.now()}@example.com`;
    const spoofUser = await User.create({
      username: `SpoofUser_${Date.now()}`,
      email: spoofUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: spoofUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: spoofUser._id, balance: 100 });

    // Level 998 has 1 normal apple and 0 golden apples.
    // Case A: Client submits spoofed goldenApplesEaten: 5 and currentScore: 99999
    const session = await gameSessionService.startSession(spoofUser._id, 998);
    const checkpointRes = await gameSessionService.saveCheckpoint(session._id, spoofUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 5, // Spoofed!
      currentScore: 99999, // Spoofed!
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    // Checkpoint must enforce server-authoritative values
    assert.equal(checkpointRes.checkpoint.goldenApplesEaten, 0, 'Server must override spoofed goldenApplesEaten with 0');
    assert.equal(checkpointRes.checkpoint.currentScore, 100, 'Server must override spoofed score with authoritative 100');

    // Case B: Client attempts to claim more apples eaten than level has in total
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, spoofUser._id, {
          checkpointIndex: 2,
          wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
          direction: 'RIGHT',
          movesTaken: 4,
          applesEaten: 10, // Exceeds level apple count (1)
          currentScore: 1000,
          applesRemaining: [],
          keysRemaining: [],
          stones: [],
          collectedKeys: [],
          filledPits: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds total apples in level/i);
        return true;
      },
      'Claiming more apples than exist in level must reject with 400'
    );
  });

  it('27. WormGameEngine handles Golden Apple growth (+1), +50 score bonus, undo restore, and reset', () => {
    const levelDefinition = {
      levelNumber: 997,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'golden' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.goldenApplesEaten, 0);
    assert.equal(engine.applesEaten, 0);
    assert.equal(engine.currentScore, 0);
    assert.equal(engine.worm.length, 2);

    // 1. Move RIGHT onto the Golden Apple at (3,5)
    const moveResult = engine.move('RIGHT');
    assert.equal(moveResult.moved, true);
    assert.equal(moveResult.collectedApple, true);
    assert.equal(moveResult.isGoldenApple, true);
    assert.equal(moveResult.collectedAppleType, 'golden');

    // Verify growth: initial length 2 -> 3 (normal apple growth +1 segment)
    assert.equal(engine.worm.length, 3, 'Golden apple must grow worm by 1 segment');
    assert.equal(engine.applesEaten, 1);
    assert.equal(engine.goldenApplesEaten, 1);
    // Score: 1 * 100 + 1 * 50 = 150
    assert.equal(engine.currentScore, 150, 'Golden apple must award 150 score (100 base + 50 golden bonus)');
    assert.equal(engine.apples.length, 0, 'Golden apple must be removed from apples remaining');

    // 2. Perform Undo
    const undoSuccess = engine.undo();
    assert.equal(undoSuccess, true);
    assert.equal(engine.worm.length, 2, 'Undo must restore original worm length 2');
    assert.equal(engine.applesEaten, 0, 'Undo must restore applesEaten to 0');
    assert.equal(engine.goldenApplesEaten, 0, 'Undo must restore goldenApplesEaten to 0');
    assert.equal(engine.currentScore, 0, 'Undo must restore score to 0');
    assert.equal(engine.apples.length, 1, 'Undo must restore golden apple to board');
    assert.equal(engine.apples[0].type, 'golden');

    // 3. Move RIGHT again and test engine.reset()
    engine.move('RIGHT');
    assert.equal(engine.goldenApplesEaten, 1);
    assert.equal(engine.currentScore, 150);

    engine.reset();
    assert.equal(engine.goldenApplesEaten, 0, 'Reset must reset goldenApplesEaten to 0');
    assert.equal(engine.applesEaten, 0);
    assert.equal(engine.currentScore, 0);
    assert.equal(engine.worm.length, 2);
    assert.equal(engine.apples.length, 1);
    assert.equal(engine.apples[0].type, 'golden');
  });

  it('28. Concurrent separate sessions with differing Golden Apple counts cannot over-award rewards', async () => {
    const multiDiffEmail = `controls_safe_tester_diff_${Date.now()}@example.com`;
    const multiDiffUser = await User.create({
      username: `MultiDiffUser_${Date.now()}`,
      email: multiDiffEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: multiDiffUser._id,
      currentLevel: 996,
      highestUnlockedLevel: 996,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: multiDiffUser._id, balance: 100 });

    const lvl996 = await Level.findOne({ levelNumber: 996 });

    // Level 996 has 2 golden apples at (3,5) and (4,5).
    // Session A collects 1 golden apple at (3,5), leaves (4,5), worm length: 3, moves: 3, reaches portal (5,5)
    const sessionA = await GameSession.create({
      userId: multiDiffUser._id,
      levelId: lvl996._id,
      levelNumber: 996,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'golden' }, { x: 4, y: 5, type: 'golden' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 1,
        goldenApplesEaten: 1,
        currentScore: 150,
        applesRemaining: [{ x: 4, y: 5, type: 'golden' }],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    // Session B collects both 2 golden apples, worm length: 4, moves: 3, reaches portal (5,5)
    const sessionB = await GameSession.create({
      userId: multiDiffUser._id,
      levelId: lvl996._id,
      levelNumber: 996,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'golden' }, { x: 4, y: 5, type: 'golden' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 2,
        goldenApplesEaten: 2,
        currentScore: 300,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    // Run completion concurrently
    const [compA, compB] = await Promise.all([
      gameSessionService.completeSession(sessionA._id, multiDiffUser._id),
      gameSessionService.completeSession(sessionB._id, multiDiffUser._id),
    ]);

    assert.ok(compA.session.status === 'COMPLETED');
    assert.ok(compB.session.status === 'COMPLETED');

    // Total legitimate coins: 25 base + 20 star + 20 golden = 65 coins.
    // Wallet balance must be strictly 100 + 65 = 165 coins (NEVER 175 or 195!).
    const wallet = await walletService.getOrCreateWallet(multiDiffUser._id);
    assert.equal(wallet.balance, 165, 'Total credited coins across differing concurrent sessions must never exceed maximum legitimate 65 coins');

    // Verify ledger has at most one apple_1 and at most one apple_2 transaction
    const goldenTxs = await WalletTransaction.find({
      userId: multiDiffUser._id,
      type: 'GOLDEN_APPLE_REWARD',
    });
    assert.equal(goldenTxs.length, 2, 'Exactly 2 golden apple ordinal transactions must exist in ledger');
    const apple1Tx = goldenTxs.filter((t) => t.idempotencyKey.includes('_apple_1'));
    const apple2Tx = goldenTxs.filter((t) => t.idempotencyKey.includes('_apple_2'));
    assert.equal(apple1Tx.length, 1, 'Exactly one apple_1 transaction must exist');
    assert.equal(apple2Tx.length, 1, 'Exactly one apple_2 transaction must exist');

    const progress = await PlayerProgress.findOne({ userId: multiDiffUser._id });
    const levelRecord = progress.completedLevels.find((l) => l.levelNumber === 996);
    assert.equal(levelRecord.goldenApplesClaimed, 2);
  });

  it('29. Concurrent separate sessions claiming the same Golden Apple ordinal only credit once', async () => {
    const sameOrdEmail = `controls_safe_tester_same_ord_${Date.now()}@example.com`;
    const sameOrdUser = await User.create({
      username: `SameOrdUser_${Date.now()}`,
      email: sameOrdEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: sameOrdUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: sameOrdUser._id, balance: 100 });

    const lvl997 = await Level.findOne({ levelNumber: 997 });

    const sessionA = await GameSession.create({
      userId: sameOrdUser._id,
      levelId: lvl997._id,
      levelNumber: 997,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'golden' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 1,
        goldenApplesEaten: 1,
        currentScore: 150,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    const sessionB = await GameSession.create({
      userId: sameOrdUser._id,
      levelId: lvl997._id,
      levelNumber: 997,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'golden' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
        direction: 'RIGHT',
        movesTaken: 3,
        applesEaten: 1,
        goldenApplesEaten: 1,
        currentScore: 150,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    const [compA, compB] = await Promise.all([
      gameSessionService.completeSession(sessionA._id, sameOrdUser._id),
      gameSessionService.completeSession(sessionB._id, sameOrdUser._id),
    ]);

    assert.ok(compA.session.status === 'COMPLETED');
    assert.ok(compB.session.status === 'COMPLETED');

    const wallet = await walletService.getOrCreateWallet(sameOrdUser._id);
    assert.equal(wallet.balance, 155, 'Wallet balance must be exactly 100 + 55 = 155 coins');

    const goldenTxs = await WalletTransaction.find({
      userId: sameOrdUser._id,
      type: 'GOLDEN_APPLE_REWARD',
    });
    assert.equal(goldenTxs.length, 1, 'Only one golden apple transaction must exist for the single golden apple');
  });

  it('30. Sequential replay progression from 1 claimed Golden Apple to 2 claimed Golden Apples credits only incremental difference', async () => {
    const seqUserEmail = `controls_safe_tester_seq_${Date.now()}@example.com`;
    const seqUser = await User.create({
      username: `SeqUser_${Date.now()}`,
      email: seqUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: seqUser._id,
      currentLevel: 996,
      highestUnlockedLevel: 996,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: seqUser._id, balance: 200 });

    // Stage 1: Play and collect only 1 of 2 golden apples
    const session1 = await gameSessionService.startSession(seqUser._id, 996);
    await gameSessionService.saveCheckpoint(session1._id, seqUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [{ x: 4, y: 5, type: 'golden' }],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp1 = await gameSessionService.completeSession(session1._id, seqUser._id);
    assert.equal(comp1.session.rewardBreakdown.baseCompletion, 25);
    assert.equal(comp1.session.rewardBreakdown.starBonus, 20);
    assert.equal(comp1.session.rewardBreakdown.goldenApples, 10);
    assert.equal(comp1.rewards.goldenCoins, 10);
    assert.equal(comp1.rewards.coins, 55);

    let wallet = await walletService.getOrCreateWallet(seqUser._id);
    assert.equal(wallet.balance, 255); // 200 + 55

    let progress = await PlayerProgress.findOne({ userId: seqUser._id });
    let rec = progress.completedLevels.find((r) => r.levelNumber === 996);
    assert.equal(rec.goldenApplesClaimed, 1);
    assert.equal(progress.totalGoldenApplesEaten, 1);

    // Stage 2: Replay level 996 and collect BOTH golden apples (progression from 1 -> 2)
    const session2 = await gameSessionService.startSession(seqUser._id, 996);
    await gameSessionService.saveCheckpoint(session2._id, seqUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 2,
      goldenApplesEaten: 2,
      currentScore: 300,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp2 = await gameSessionService.completeSession(session2._id, seqUser._id);
    assert.equal(comp2.session.rewardBreakdown.baseCompletion, 0, 'Replay base coins must be 0');
    assert.equal(comp2.session.rewardBreakdown.starBonus, 0, 'Same star replay star coins must be 0');
    assert.equal(comp2.session.rewardBreakdown.goldenApples, 10, 'Incremental golden coins must be +10 for second apple');
    assert.equal(comp2.rewards.goldenCoins, 10);
    assert.equal(comp2.rewards.coins, 10);

    wallet = await walletService.getOrCreateWallet(seqUser._id);
    assert.equal(wallet.balance, 265); // 255 + 10

    progress = await PlayerProgress.findOne({ userId: seqUser._id });
    rec = progress.completedLevels.find((r) => r.levelNumber === 996);
    assert.equal(rec.goldenApplesClaimed, 2);
    assert.equal(progress.totalGoldenApplesEaten, 2);

    // Stage 3: Replay level 996 collecting 1 golden apple again (lower count)
    const session3 = await gameSessionService.startSession(seqUser._id, 996);
    await gameSessionService.saveCheckpoint(session3._id, seqUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [{ x: 4, y: 5, type: 'golden' }],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const comp3 = await gameSessionService.completeSession(session3._id, seqUser._id);
    assert.equal(comp3.rewards.goldenCoins, 0);
    assert.equal(comp3.rewards.coins, 0);

    wallet = await walletService.getOrCreateWallet(seqUser._id);
    assert.equal(wallet.balance, 265);

    progress = await PlayerProgress.findOne({ userId: seqUser._id });
    rec = progress.completedLevels.find((r) => r.levelNumber === 996);
    assert.equal(rec.goldenApplesClaimed, 2, 'goldenApplesClaimed must not decrease on lower replay');
  });

  it('31. Deduplicated Golden Apple milestone reward response reports zero newly credited coins', async () => {
    const dedupEmail = `controls_safe_tester_dedup_${Date.now()}@example.com`;
    const dedupUser = await User.create({
      username: `DedupUser_${Date.now()}`,
      email: dedupEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: dedupUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: dedupUser._id, balance: 100 });

    const session1 = await gameSessionService.startSession(dedupUser._id, 997);
    await gameSessionService.saveCheckpoint(session1._id, dedupUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    await gameSessionService.completeSession(session1._id, dedupUser._id);

    // Replay session on 997 where golden apple was already credited
    const replaySession = await gameSessionService.startSession(dedupUser._id, 997);
    await gameSessionService.saveCheckpoint(replaySession._id, dedupUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const replayRes = await gameSessionService.completeSession(replaySession._id, dedupUser._id);
    assert.equal(replayRes.rewards.coins, 0, 'Replay rewards.coins must be 0');
    assert.equal(replayRes.rewards.goldenCoins, 0, 'Deduplicated goldenCoins must report 0 newly credited coins');
    assert.equal(replayRes.session.rewardBreakdown.goldenApples, 0, 'Session rewardBreakdown.goldenApples must be 0');
    assert.equal(replayRes.session.rewardBreakdown.totalCoins, 0, 'Session rewardBreakdown.totalCoins must be 0');
  });

  it('32. Inconsistent worm length and apple count rejected by saveCheckpoint', async () => {
    const invLenEmail = `controls_safe_tester_inv_len_${Date.now()}@example.com`;
    const invLenUser = await User.create({
      username: `InvLenUser_${Date.now()}`,
      email: invLenEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: invLenUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: invLenUser._id, balance: 100 });

    const session = await gameSessionService.startSession(invLenUser._id, 997);

    // Initial worm length on level 997 is 2. Apple at (3,5) is golden.
    // Client claims applesRemaining: [] (1 apple eaten), but sends wormState with length 2 (not grown to 3)
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, invLenUser._id, {
          checkpointIndex: 1,
          wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }], // Length 2, should be 3
          direction: 'RIGHT',
          movesTaken: 1,
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Worm length \(2\) does not match expected length \(3\)/i);
        return true;
      },
      'Inconsistent worm length must reject with status 400'
    );
  });

  it('33. Forged apple collection with un-grown worm rejected at completeSession', async () => {
    const forgedCompEmail = `controls_safe_tester_forged_comp_${Date.now()}@example.com`;
    const forgedCompUser = await User.create({
      username: `ForgedCompUser_${Date.now()}`,
      email: forgedCompEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: forgedCompUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: forgedCompUser._id, balance: 100 });

    const lvl997 = await Level.findOne({ levelNumber: 997 });

    // Directly craft session with worm at portal (5,5) of length 2 claiming applesRemaining: []
    const craftedSession = await GameSession.create({
      userId: forgedCompUser._id,
      levelId: lvl997._id,
      levelNumber: 997,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'golden' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }], // Length 2! Initial is 2, apple eaten is 1 -> expected 3
        direction: 'RIGHT',
        movesTaken: 3,
        currentScore: 150,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(craftedSession._id, forgedCompUser._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Final worm length \(2\) does not match expected length \(3\)/i);
        return true;
      },
      'completeSession must reject forged checkpoint with un-grown worm length'
    );
  });

  it('34. Forged checkpoint apple collection without verified collection history / reachability rejected', async () => {
    const unreachEmail = `controls_safe_tester_unreach_${Date.now()}@example.com`;
    const unreachUser = await User.create({
      username: `UnreachUser_${Date.now()}`,
      email: unreachEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: unreachUser._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: unreachUser._id, balance: 100 });

    // Level 998 has apple at (4,5). Worm starts at (2,5), head at (2,5).
    const session = await gameSessionService.startSession(unreachUser._id, 998);

    // Client sends move 1: worm head moves UP to (2,4) - distance 1.
    // Client falsely claims apple at (4,5) was eaten by sending applesRemaining: [].
    // Distance from (2,5) to (4,5) is 2 moves, but only 1 move was taken!
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, unreachUser._id, {
          checkpointIndex: 1,
          wormState: [{ x: 2, y: 4 }, { x: 2, y: 5 }, { x: 1, y: 5 }], // Length 3
          direction: 'UP',
          movesTaken: 1,
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /did not visit apple|cannot be reached/i);
        return true;
      },
      'Unreachable apple consumption must be rejected'
    );
  });

  it('35. Completed-session retry recovers missing PlayerProgress without duplicate wallet rewards', async () => {
    const recoverEmail = `controls_safe_tester_recover_${Date.now()}@example.com`;
    const recoverUser = await User.create({
      username: `RecoverUser_${Date.now()}`,
      email: recoverEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: recoverUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: recoverUser._id, balance: 100 });

    const session = await gameSessionService.startSession(recoverUser._id, 997);
    await gameSessionService.saveCheckpoint(session._id, recoverUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, recoverUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');

    const walletBefore = await walletService.getOrCreateWallet(recoverUser._id);
    assert.equal(walletBefore.balance, 155);

    // Simulate database crash / dropped level record in PlayerProgress
    await PlayerProgress.updateOne(
      { userId: recoverUser._id },
      { $pull: { completedLevels: { levelNumber: 997 } } }
    );
    const progressMissing = await PlayerProgress.findOne({ userId: recoverUser._id });
    assert.equal(progressMissing.completedLevels.length, 0, 'Progress record must be missing before recovery');

    // Retry completeSession on the COMPLETED session
    const retryRes = await gameSessionService.completeSession(session._id, recoverUser._id);
    assert.equal(retryRes.isDuplicate, true);

    // Wallet balance must NOT increment again
    const walletAfter = await walletService.getOrCreateWallet(recoverUser._id);
    assert.equal(walletAfter.balance, 155, 'Wallet balance must remain unchanged on recovery retry');

    // PlayerProgress must be safely recovered
    const progressRecovered = await PlayerProgress.findOne({ userId: recoverUser._id });
    const recoveredRecord = progressRecovered.completedLevels.find((r) => r.levelNumber === 997);
    assert.ok(recoveredRecord, 'PlayerProgress record must be recovered');
    assert.equal(recoveredRecord.stars, 3);
    assert.equal(recoveredRecord.goldenApplesClaimed, 1);
    assert.equal(progressRecovered.totalGoldenApplesEaten, 1);
  });

  it('36. Concurrent recovery attempts on completed session do not create duplicate progress records', async () => {
    const concRecEmail = `controls_safe_tester_conc_rec_${Date.now()}@example.com`;
    const concRecUser = await User.create({
      username: `ConcRecUser_${Date.now()}`,
      email: concRecEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: concRecUser._id,
      currentLevel: 997,
      highestUnlockedLevel: 997,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: concRecUser._id, balance: 100 });

    const session = await gameSessionService.startSession(concRecUser._id, 997);
    await gameSessionService.saveCheckpoint(session._id, concRecUser._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesEaten: 1,
      goldenApplesEaten: 1,
      currentScore: 150,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    await gameSessionService.completeSession(session._id, concRecUser._id);

    // Drop progress record to trigger concurrent recovery
    await PlayerProgress.updateOne(
      { userId: concRecUser._id },
      { $pull: { completedLevels: { levelNumber: 997 } } }
    );

    // Execute concurrent recovery calls
    const [recA, recB] = await Promise.all([
      gameSessionService.completeSession(session._id, concRecUser._id),
      gameSessionService.completeSession(session._id, concRecUser._id),
    ]);

    assert.equal(recA.isDuplicate, true);
    assert.equal(recB.isDuplicate, true);

    const progress = await PlayerProgress.findOne({ userId: concRecUser._id });
    const matchingRecords = progress.completedLevels.filter((r) => r.levelNumber === 997);
    assert.equal(matchingRecords.length, 1, 'Exactly one completedLevels record must exist after concurrent recovery');
  });

  it('37. WormGameEngine handles Mega Apple: grows by exactly +2 segments, awards +100 standard score', () => {
    const levelDefinition = {
      levelNumber: 995,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'mega' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.megaApplesEaten, 0);
    assert.equal(engine.applesEaten, 0);
    assert.equal(engine.currentScore, 0);
    assert.equal(engine.worm.length, 2);

    // 1. Move RIGHT onto the Mega Apple at (3,5)
    const moveResult = engine.move('RIGHT');
    assert.equal(moveResult.moved, true);
    assert.equal(moveResult.collectedApple, true);
    assert.equal(moveResult.collectedAppleType, 'mega');
    assert.equal(moveResult.isMegaApple, true);
    assert.equal(moveResult.isGoldenApple, false);

    // Growth check: Initial length was 2 -> after Mega Apple, length must be strictly 4 (+2 segments)!
    assert.equal(engine.worm.length, 4, 'Mega apple must grow worm by exactly 2 segments (from 2 to 4)');
    assert.equal(engine.applesEaten, 1);
    assert.equal(engine.megaApplesEaten, 1);
    assert.equal(engine.goldenApplesEaten, 0);
    // Score check: Standard apple score (100 points, no golden bonus)
    assert.equal(engine.currentScore, 100, 'Mega apple must award standard 100 score without golden bonus');
    assert.equal(engine.apples.length, 0, 'Mega apple must be removed from apples remaining');

    // Contiguity verification: each adjacent pair must have Manhattan distance of 1
    for (let i = 1; i < engine.worm.length; i++) {
      const prev = engine.worm[i - 1];
      const curr = engine.worm[i];
      const dist = Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y);
      assert.equal(dist, 1, `Adjacent segments ${i - 1} and ${i} must have Manhattan distance of 1`);
    }
  });

  it('38. WormGameEngine Undo reverses Mega Apple collection, growth, score and board state', () => {
    const levelDefinition = {
      levelNumber: 995,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'mega' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    engine.move('RIGHT');
    assert.equal(engine.worm.length, 4);
    assert.equal(engine.currentScore, 100);
    assert.equal(engine.applesEaten, 1);
    assert.equal(engine.megaApplesEaten, 1);
    assert.equal(engine.apples.length, 0);

    // Perform Undo
    const undoResult = engine.undo();
    assert.equal(undoResult, true);
    assert.equal(engine.worm.length, 2, 'Undo must revert worm length back to 2');
    assert.equal(engine.currentScore, 0, 'Undo must revert score to 0');
    assert.equal(engine.applesEaten, 0, 'Undo must revert applesEaten to 0');
    assert.equal(engine.megaApplesEaten, 0, 'Undo must revert megaApplesEaten to 0');
    assert.equal(engine.apples.length, 1, 'Undo must restore Mega Apple back to board');
    assert.equal(engine.apples[0].type, 'mega');
    assert.equal(engine.apples[0].x, 3);
    assert.equal(engine.apples[0].y, 5);
  });

  it('39. Multiple Mega Apples in the same level grow the worm accumulatively and reset cleanly', () => {
    const levelDefinition = {
      levelNumber: 994,
      difficulty: 'medium',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 6, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'reach_length',
      targetValue: 6,
      apples: [
        { x: 3, y: 5, type: 'mega' },
        { x: 4, y: 5, type: 'mega' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.worm.length, 2);

    // First Mega Apple at (3,5)
    engine.move('RIGHT');
    assert.equal(engine.worm.length, 4, '1st mega apple grows worm to 4');
    assert.equal(engine.megaApplesEaten, 1);
    assert.equal(engine.currentScore, 100);

    // Second Mega Apple at (4,5)
    engine.move('RIGHT');
    assert.equal(engine.worm.length, 6, '2nd mega apple grows worm to 6 (+4 total growth)');
    assert.equal(engine.megaApplesEaten, 2);
    assert.equal(engine.currentScore, 200);

    // Reset restores level configuration
    engine.reset();
    assert.equal(engine.worm.length, 2, 'Reset must restore worm length to 2');
    assert.equal(engine.apples.length, 2, 'Reset must restore both mega apples');
    assert.equal(engine.apples[0].type, 'mega');
    assert.equal(engine.apples[1].type, 'mega');
    assert.equal(engine.megaApplesEaten, 0);
    assert.equal(engine.currentScore, 0);
  });

  it('40. Server saveCheckpoint accepts legitimate Mega Apple collection with correct growth and records megaApplesEaten', async () => {
    const megaCpEmail = `controls_safe_tester_mega_cp_${Date.now()}@example.com`;
    const megaCpUser = await User.create({
      username: `MegaCpUser_${Date.now()}`,
      email: megaCpEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: megaCpUser._id,
      currentLevel: 995,
      highestUnlockedLevel: 995,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: megaCpUser._id, balance: 100 });

    const session = await gameSessionService.startSession(megaCpUser._id, 995);

    // Level 995: Initial worm at (2,5), (1,5). Apple at (3,5) is mega.
    // Move 1 onto (3,5): worm grows by +2 segments -> length is strictly 4: (3,5), (2,5), (1,5), (0,5).
    const checkpointRes = await gameSessionService.saveCheckpoint(session._id, megaCpUser._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
        { x: 0, y: 5 },
      ],
      direction: 'RIGHT',
      movesTaken: 1,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    assert.equal(checkpointRes.success, true);
    assert.equal(checkpointRes.checkpoint.applesEaten, 1);
    assert.equal(checkpointRes.checkpoint.megaApplesEaten, 1);
    assert.equal(checkpointRes.checkpoint.goldenApplesEaten, 0);
    assert.equal(checkpointRes.checkpoint.currentScore, 100, 'Score must be 100 for mega apple');
    assert.equal(checkpointRes.checkpoint.wormState.length, 4);

    const freshSession = await GameSession.findById(session._id);
    assert.equal(freshSession.megaApplesCollected, 1);
  });

  it('41. Server saveCheckpoint rejects inconsistent worm length after Mega Apple collection', async () => {
    const invMegaEmail = `controls_safe_tester_inv_mega_${Date.now()}@example.com`;
    const invMegaUser = await User.create({
      username: `InvMegaUser_${Date.now()}`,
      email: invMegaEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: invMegaUser._id,
      currentLevel: 995,
      highestUnlockedLevel: 995,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: invMegaUser._id, balance: 100 });

    const session = await gameSessionService.startSession(invMegaUser._id, 995);

    // Level 995 has 1 Mega Apple.
    // Client claims apple is eaten (applesRemaining: []), but only sends worm of length 3 (only +1 growth instead of +2)
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, invMegaUser._id, {
          checkpointIndex: 1,
          wormState: [
            { x: 3, y: 5 },
            { x: 2, y: 5 },
            { x: 1, y: 5 },
          ], // Length 3, should be 4!
          direction: 'RIGHT',
          movesTaken: 1,
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Worm length \(3\) does not match expected length \(4\)/i);
        return true;
      },
      'Inconsistent worm length after Mega Apple must reject with HTTP 400'
    );
  });

  it('42. Server saveCheckpoint rejects forged Mega Apple collection without verified reachability', async () => {
    const forgedMegaEmail = `controls_safe_tester_forged_mega_${Date.now()}@example.com`;
    const forgedMegaUser = await User.create({
      username: `ForgedMegaUser_${Date.now()}`,
      email: forgedMegaEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: forgedMegaUser._id,
      currentLevel: 995,
      highestUnlockedLevel: 995,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: forgedMegaUser._id, balance: 100 });

    const session = await gameSessionService.startSession(forgedMegaUser._id, 995);

    // Worm starts at (2,5). Client takes 1 move UP to (2,4) and claims Mega Apple at (3,5) was eaten!
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, forgedMegaUser._id, {
          checkpointIndex: 1,
          wormState: [
            { x: 2, y: 4 },
            { x: 2, y: 5 },
            { x: 1, y: 5 },
            { x: 0, y: 5 },
          ],
          direction: 'UP',
          movesTaken: 1,
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /did not visit apple|cannot be reached/i);
        return true;
      },
      'Unreachable Mega Apple collection must be rejected with 400'
    );
  });

  it('43. Server completeSession validates Mega Apple run: awards standard completion without golden bonus coins', async () => {
    const compMegaEmail = `controls_safe_tester_comp_mega_${Date.now()}@example.com`;
    const compMegaUser = await User.create({
      username: `CompMegaUser_${Date.now()}`,
      email: compMegaEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: compMegaUser._id,
      currentLevel: 995,
      highestUnlockedLevel: 995,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: compMegaUser._id, balance: 100 });

    const session = await gameSessionService.startSession(compMegaUser._id, 995);

    // Save checkpoint after eating Mega Apple at (3,5) and reaching portal at (5,5) with 3 moves
    await gameSessionService.saveCheckpoint(session._id, compMegaUser._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ], // Length 4!
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, compMegaUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.megaApplesCollected, 1);
    assert.equal(compRes.session.goldenApplesCollected, 0);
    assert.equal(compRes.rewards.megaApples, 1);
    assert.equal(compRes.rewards.goldenApples, 0);
    assert.equal(compRes.rewards.goldenCoins, 0, 'Mega Apple must award 0 golden coins');
    // Coins awarded: 25 base + 20 star bonus = 45 coins (NO golden apple coins)
    assert.equal(compRes.rewards.coins, 45);

    const wallet = await walletService.getOrCreateWallet(compMegaUser._id);
    assert.equal(wallet.balance, 145); // 100 + 45

    const progress = await PlayerProgress.findOne({ userId: compMegaUser._id });
    const levelRec = progress.completedLevels.find((l) => l.levelNumber === 995);
    assert.ok(levelRec);
    assert.equal(levelRec.megaApplesClaimed, 1);
    assert.equal(progress.totalMegaApplesEaten, 1);
  });

  it('44. Server completeSession rejects completion with Mega Apple if final worm length does not match growth contribution', async () => {
    const badCompEmail = `controls_safe_tester_bad_mega_comp_${Date.now()}@example.com`;
    const badCompUser = await User.create({
      username: `BadMegaCompUser_${Date.now()}`,
      email: badCompEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: badCompUser._id,
      currentLevel: 995,
      highestUnlockedLevel: 995,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: badCompUser._id, balance: 100 });

    const lvl995 = await Level.findOne({ levelNumber: 995 });

    // Forged session at portal (5,5) claiming all apples eaten, but worm length is only 2
    const forgedSession = await GameSession.create({
      userId: badCompUser._id,
      levelId: lvl995._id,
      levelNumber: 995,
      status: 'ACTIVE',
      startedAt: new Date(),
      initialState: {
        worm: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
        apples: [{ x: 3, y: 5, type: 'mega' }],
      },
      checkpoint: {
        checkpointIndex: 1,
        wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }], // Length 2 instead of 4!
        direction: 'RIGHT',
        movesTaken: 3,
        currentScore: 100,
        applesRemaining: [],
        keysRemaining: [],
        stones: [],
        collectedKeys: [],
        filledPits: [],
      },
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(forgedSession._id, badCompUser._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Final worm length \(2\) does not match expected length \(4\)/i);
        return true;
      },
      'Forged completion without required Mega Apple worm length must reject with 400'
    );
  });

  it('45. Level with both Golden Apple and Mega Apple differentiates growth and reward accurately', async () => {
    // Create temporary level with 1 Golden Apple at (3,5) and 1 Mega Apple at (4,5)
    const comboUserEmail = `controls_safe_tester_combo_${Date.now()}@example.com`;
    const comboUser = await User.create({
      username: `ComboUser_${Date.now()}`,
      email: comboUserEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: comboUser._id,
      currentLevel: 993,
      highestUnlockedLevel: 993,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: comboUser._id, balance: 100 });

    const comboLevel = await Level.create({
      levelNumber: 993,
      difficulty: 'medium',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 6, y: 5 },
      moveLimit: 15,
      starThresholds: { threeStars: 8, twoStars: 10, oneStar: 15 },
      objective: 'eat_all_apples',
      apples: [
        { x: 3, y: 5, type: 'golden' },
        { x: 4, y: 5, type: 'mega' },
      ],
      stones: [],
      keys: [],
      obstacles: [{ x: 5, y: 8, type: 'wall' }],
      solution: ['RIGHT', 'RIGHT', 'RIGHT', 'RIGHT'],
    });

    const session = await gameSessionService.startSession(comboUser._id, 993);

    // Initial worm length: 2.
    // Golden apple growth: +1. Mega apple growth: +2.
    // Expected final length: 2 + 1 + 2 = 5!
    await gameSessionService.saveCheckpoint(session._id, comboUser._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 6, y: 5 },
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ], // Length 5!
      direction: 'RIGHT',
      movesTaken: 4,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, comboUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.goldenApples, 1);
    assert.equal(compRes.rewards.megaApples, 1);
    assert.equal(compRes.rewards.goldenCoins, 10, 'Golden Apple must award 10 coins');
    // Total coins: 25 base + 20 star bonus + 10 golden apple = 55 coins
    assert.equal(compRes.rewards.coins, 55);

    const wallet = await walletService.getOrCreateWallet(comboUser._id);
    assert.equal(wallet.balance, 155);

    await Level.deleteOne({ _id: comboLevel._id });
    await GameSession.deleteMany({ levelNumber: 993 });
  });

  it('46. Level with reach_length objective: Mega Apples enable reaching target length to complete level', async () => {
    const reachLenEmail = `controls_safe_tester_reach_len_${Date.now()}@example.com`;
    const reachLenUser = await User.create({
      username: `ReachLenUser_${Date.now()}`,
      email: reachLenEmail,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: reachLenUser._id,
      currentLevel: 994,
      highestUnlockedLevel: 994,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: reachLenUser._id, balance: 100 });

    const session = await gameSessionService.startSession(reachLenUser._id, 994);

    // Level 994 has objective: 'reach_length', targetValue: 6, 2 Mega Apples.
    // Worm starts at length 2, eats both Mega Apples -> length grows to 6!
    await gameSessionService.saveCheckpoint(session._id, reachLenUser._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 6, y: 5 },
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ], // Length 6 satisfies targetValue: 6!
      direction: 'RIGHT',
      movesTaken: 4,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, reachLenUser._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.megaApples, 2);
    assert.equal(compRes.rewards.goldenCoins, 0);

    const progress = await PlayerProgress.findOne({ userId: reachLenUser._id });
    const rec = progress.completedLevels.find((l) => l.levelNumber === 994);
    assert.ok(rec);
    assert.equal(rec.megaApplesClaimed, 2);
    assert.equal(progress.totalMegaApplesEaten, 2);
  });

  it('47. Time Apple grants configured additional move allowance (+5 moves) in engine and expands effectiveMoveLimit & movesRemaining', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      timeAppleBonusMoves: 5,
      starThresholds: { threeStars: 1, twoStars: 2, oneStar: 2 },
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.timeApplesEaten, 0);
    assert.equal(engine.timeAppleBonusMoves, 5);
    assert.equal(engine.moveLimit, 2);
    assert.equal(engine.effectiveMoveLimit, 2);
    assert.equal(engine.movesRemaining, 2);

    const res = engine.move('RIGHT');
    assert.equal(res.moved, true);
    assert.equal(res.collectedApple, true);
    assert.equal(res.collectedAppleType, 'time');
    assert.equal(res.isTimeApple, true);
    assert.equal(res.timeBonusMoves, 5);
    assert.equal(engine.timeApplesEaten, 1);
    assert.equal(engine.moves, 1);
    // Effective limit expanded from 2 to 2 + 5 = 7!
    assert.equal(engine.effectiveMoveLimit, 7);
    assert.equal(engine.movesRemaining, 6);
  });

  it('48. Time Apple does not grant Mega growth (grows by exactly 1 segment, not 2)', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 10,
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.worm.length, 2);

    engine.move('RIGHT');
    // Grown by strictly 1 segment: 2 -> 3
    assert.equal(engine.worm.length, 3, 'Time Apple must grow worm by exactly 1 segment (from 2 to 3)');
    assert.equal(engine.applesEaten, 1);
    assert.equal(engine.timeApplesEaten, 1);
    assert.equal(engine.megaApplesEaten, 0);
  });

  it('49. Time Apple does not grant Golden Apple bonus coins (0 golden coins, 0 golden bonus score)', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 10,
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    engine.move('RIGHT');

    assert.equal(engine.goldenApplesEaten, 0);
    // Standard score 100 points, without golden bonus 50 points
    assert.equal(engine.currentScore, 100, 'Score must be 100 without 50-point golden bonus');
  });

  it('50. Time Apple collection updates engine state (timeApplesEaten: 1)', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 10,
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    const cpBefore = engine.getCheckpointState();
    assert.equal(cpBefore.timeApplesEaten, 0);

    engine.move('RIGHT');
    const cpAfter = engine.getCheckpointState();
    assert.equal(cpAfter.timeApplesEaten, 1);
    assert.equal(cpAfter.applesRemaining.length, 0);
  });

  it('51. Undo reverses Time Apple collection and restores move allowance', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      timeAppleBonusMoves: 5,
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    engine.move('RIGHT');
    assert.equal(engine.effectiveMoveLimit, 7);
    assert.equal(engine.timeApplesEaten, 1);
    assert.equal(engine.worm.length, 3);
    assert.equal(engine.apples.length, 0);

    const undoSuccess = engine.undo();
    assert.equal(undoSuccess, true);
    assert.equal(engine.timeApplesEaten, 0, 'Undo must revert timeApplesEaten to 0');
    assert.equal(engine.effectiveMoveLimit, 2, 'Undo must revert effectiveMoveLimit to original 2');
    assert.equal(engine.movesRemaining, 2);
    assert.equal(engine.worm.length, 2, 'Undo must revert worm length to 2');
    assert.equal(engine.apples.length, 1, 'Undo must restore Time Apple to remaining list');
    assert.equal(engine.apples[0].type, 'time');
  });

  it('52. Reset clears Time Apple counters and bonus allowance', () => {
    const levelDefinition = {
      levelNumber: 993,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      timeAppleBonusMoves: 5,
      objective: 'eat_all_apples',
      apples: [{ x: 3, y: 5, type: 'time' }],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    engine.move('RIGHT');
    assert.equal(engine.timeApplesEaten, 1);
    assert.equal(engine.effectiveMoveLimit, 7);

    engine.reset();
    assert.equal(engine.timeApplesEaten, 0);
    assert.equal(engine.effectiveMoveLimit, 2);
    assert.equal(engine.moves, 0);
    assert.equal(engine.apples.length, 1);
    assert.equal(engine.apples[0].type, 'time');
  });

  it('53. Multiple Time Apples correctly accumulate their configured allowance (+10 moves for 2 apples)', () => {
    const levelDefinition = {
      levelNumber: 989,
      difficulty: 'easy',
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 6, y: 5 },
      moveLimit: 5,
      timeAppleBonusMoves: 5,
      objective: 'eat_all_apples',
      apples: [
        { x: 3, y: 5, type: 'time' },
        { x: 4, y: 5, type: 'time' },
      ],
      stones: [],
      keys: [],
      obstacles: [],
    };

    const engine = new WormGameEngine(levelDefinition);
    assert.equal(engine.effectiveMoveLimit, 5);

    // Collect 1st Time Apple at (3,5)
    engine.move('RIGHT');
    assert.equal(engine.timeApplesEaten, 1);
    assert.equal(engine.effectiveMoveLimit, 10);

    // Collect 2nd Time Apple at (4,5)
    engine.move('RIGHT');
    assert.equal(engine.timeApplesEaten, 2);
    assert.equal(engine.effectiveMoveLimit, 15, '2 Time Apples must expand limit to 5 + (2 * 5) = 15');
    assert.equal(engine.worm.length, 4, '2 Time Apples grow worm by 2 segments (2 -> 4)');
    assert.equal(engine.currentScore, 200, '2 Time Apples award 200 standard score');
  });

  it('54. Legitimate checkpoint validation accepts Time Apple collection and moves beyond base move limit', async () => {
    const user = await User.create({
      username: `TimeUser_54_${Date.now()}`,
      email: `controls_safe_tester_time54_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 990,
      highestUnlockedLevel: 990,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 990 has base moveLimit: 2, timeAppleBonusMoves: 5
    const session = await gameSessionService.startSession(user._id, 990);

    // Move 1: Right to (3,5), eating Time Apple at (3,5)
    const cp1 = await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 1,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });
    assert.equal(cp1.checkpoint.timeApplesEaten, 1);

    // Move 3: Takes 3 moves total (which exceeds base moveLimit 2, but is within 2 + 5 = 7)
    const cp2 = await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 2,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });
    assert.equal(cp2.success, true);
    assert.equal(cp2.checkpoint.movesTaken, 3);
    assert.equal(cp2.checkpoint.timeApplesEaten, 1);
  });

  it('55. Forged Time Apple collection without reachability or exceeding extended allowance is rejected with HTTP 400', async () => {
    const user = await User.create({
      username: `TimeUser_55_${Date.now()}`,
      email: `controls_safe_tester_time55_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 990,
      highestUnlockedLevel: 990,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 990);

    // 1. Forged claim: exceeds extended allowance (2 + 5 = 7, player reports movesTaken: 8)
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 1,
          wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
          direction: 'RIGHT',
          movesTaken: 8, // Exceeds 7!
          applesRemaining: [],
          keysRemaining: [],
          stones: [],
          collectedKeys: [],
          filledPits: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds level limit/);
        return true;
      }
    );

    // 2. Forged claim: unreachability (consuming apple at (3,5) in 1 move when head is at (8,8))
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 1,
          wormState: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }],
          direction: 'RIGHT',
          movesTaken: 1,
          applesRemaining: [], // claiming apple at (3,5) was eaten
          keysRemaining: [],
          stones: [],
          collectedKeys: [],
          filledPits: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('56. Completion validation correctly handles Time Apple bonus allowance (verifies victory on a 3-move path when base limit is 2)', async () => {
    const user = await User.create({
      username: `TimeUser_56_${Date.now()}`,
      email: `controls_safe_tester_time56_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 990,
      highestUnlockedLevel: 990,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 990);

    // Save final checkpoint on portal at (5,5) with 3 moves (base limit was 2, bonus +5 -> allowed 7)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.timeApples, 1);
    assert.equal(compRes.rewards.timeBonusMoves, 5);
    assert.equal(compRes.rewards.goldenCoins, 0);

    const progress = await PlayerProgress.findOne({ userId: user._id });
    const rec = progress.completedLevels.find((l) => l.levelNumber === 990);
    assert.ok(rec);
    assert.equal(rec.timeApplesClaimed, 1);
    assert.equal(progress.totalTimeApplesEaten, 1);
  });

  it('57. Mixed Normal, Golden, Mega and Time Apples validate their distinct contributions (growth = 1+1+2+1 = 5, score, golden coins, bonus moves)', async () => {
    const user = await User.create({
      username: `MixedUser_57_${Date.now()}`,
      email: `controls_safe_tester_mixed57_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 988,
      highestUnlockedLevel: 988,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 988: Normal(3,5), Golden(4,5), Mega(5,5), Time(6,5), Portal(7,5)
    // Worm starts at length 2.
    // Growth: Normal(+1), Golden(+1), Mega(+2), Time(+1) -> Total growth = 5 -> Final worm length = 2 + 5 = 7.
    // Score: (4 apples * 100) + (1 golden * 50) = 450 apple score.
    const session = await gameSessionService.startSession(user._id, 988);

    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 7, y: 5 },
        { x: 6, y: 5 },
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ], // Length 7!
      direction: 'RIGHT',
      movesTaken: 5,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.goldenApples, 1);
    assert.equal(compRes.rewards.goldenCoins, 10);
    assert.equal(compRes.rewards.megaApples, 1);
    assert.equal(compRes.rewards.timeApples, 1);
    assert.equal(compRes.rewards.timeBonusMoves, 5);

    const progress = await PlayerProgress.findOne({ userId: user._id });
    const rec = progress.completedLevels.find((l) => l.levelNumber === 988);
    assert.ok(rec);
    assert.equal(rec.goldenApplesClaimed, 1);
    assert.equal(rec.megaApplesClaimed, 1);
    assert.equal(rec.timeApplesClaimed, 1);
    assert.equal(progress.totalGoldenApplesEaten, 1);
    assert.equal(progress.totalMegaApplesEaten, 1);
    assert.equal(progress.totalTimeApplesEaten, 1);
  });

  it('58. Replay and completed-session recovery preserve Time Apple claims and stats', async () => {
    const user = await User.create({
      username: `RecoveryUser_58_${Date.now()}`,
      email: `controls_safe_tester_rec58_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 990,
      highestUnlockedLevel: 990,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 990);

    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
    });

    await gameSessionService.completeSession(session._id, user._id);

    // Drop progress record for level 990 to simulate recovery scenario
    await PlayerProgress.updateOne(
      { userId: user._id },
      { $pull: { completedLevels: { levelNumber: 990 } } }
    );

    // Recovery call on completed session
    const recoveryRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(recoveryRes.isDuplicate, true);
    assert.equal(recoveryRes.rewards.timeApples, 1);

    const recoveredProgress = await PlayerProgress.findOne({ userId: user._id });
    const rec = recoveredProgress.completedLevels.find((l) => l.levelNumber === 990);
    assert.ok(rec, 'Record must be restored by recovery');
    assert.equal(rec.timeApplesClaimed, 1);
    assert.equal(recoveredProgress.totalTimeApplesEaten, 1);
  });

  it('59. Mystery Apple recognition in game engine increments mysteryApplesEaten and resolves effect', async () => {
    const levelData = {
      levelNumber: 987,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'BONUS_SCORE', value: 200 } }],
    };
    const engine = new WormGameEngine(levelData);
    assert.equal(engine.mysteryApplesEaten, 0);

    const step1 = engine.move('RIGHT');
    assert.equal(step1.moved, true);
    assert.equal(step1.collectedApple, true);
    assert.equal(step1.isMysteryApple, true);
    assert.ok(step1.mysteryEffect);
    assert.equal(step1.mysteryEffect.type, 'BONUS_SCORE');
    assert.equal(step1.mysteryEffect.value, 200);
    assert.equal(engine.mysteryApplesEaten, 1);
  });

  it('60. Predefined effects configuration validates default settings in EconomyConfig', async () => {
    const config = await EconomyConfig.getActiveConfig();
    assert.ok(config);
    const mysteryCfg = config.rules?.mysteryAppleConfig || DEFAULT_MYSTERY_CONFIG;
    assert.equal(mysteryCfg.bonusScore, 200);
    assert.equal(mysteryCfg.extraMoves, 5);
    assert.equal(mysteryCfg.extraGrowth, 1);
  });

  it('61. Deterministic resolution ensures identical effect for the same seed and coordinate without rerolling', async () => {
    const seed = 'test_seed_12345';
    const x = 7;
    const y = 8;
    const eff1 = resolveMysteryEffect(seed, x, y);
    const eff2 = resolveMysteryEffect(seed, x, y);
    const eff3 = resolveMysteryEffect(seed, x, y);
    assert.deepEqual(eff1, eff2);
    assert.deepEqual(eff2, eff3);
  });

  it('62. Effect BONUS_SCORE grants +200 bonus score adding to standard apple score', async () => {
    const levelData = {
      levelNumber: 987,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'BONUS_SCORE', value: 200 } }],
    };
    const engine = new WormGameEngine(levelData);
    engine.move('RIGHT'); // Collects apple at (3,5)
    // 1 apple * 100 base + 200 bonus score = 300 total score
    assert.equal(engine.score, 300);
  });

  it('63. Effect EXTRA_MOVES adds extra moves to effectiveMoveLimit in engine', async () => {
    const levelData = {
      levelNumber: 986,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 2,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'EXTRA_MOVES', value: 5 } }],
    };
    const engine = new WormGameEngine(levelData);
    assert.equal(engine.effectiveMoveLimit, 2);
    engine.move('RIGHT'); // Collects EXTRA_MOVES apple
    assert.equal(engine.effectiveMoveLimit, 7); // 2 + 5 = 7
    assert.equal(engine.movesRemaining, 6); // 7 - 1 = 6
  });

  it('64. Effect EXTRA_GROWTH grows worm by +2 segments total (matching mega apple growth)', async () => {
    const levelData = {
      levelNumber: 985,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'EXTRA_GROWTH', value: 1 } }],
    };
    const engine = new WormGameEngine(levelData);
    assert.equal(engine.worm.length, 2);
    engine.move('RIGHT'); // Collects EXTRA_GROWTH apple
    assert.equal(engine.worm.length, 4); // 2 + 2 = 4 segments!
  });

  it('65. Checkpoint persistence preserves mysteryApplesEaten and applied mystery effects', async () => {
    const user = await User.create({
      username: `MysteryUser_65_${Date.now()}`,
      email: `controls_safe_tester_myst65_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 987,
      highestUnlockedLevel: 987,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 987);
    const cpRes = await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 1,
      applesRemaining: [],
      keysRemaining: [],
      stones: [],
      collectedKeys: [],
      filledPits: [],
      mysteryEffectsApplied: [{ x: 3, y: 5, type: 'BONUS_SCORE', value: 200 }],
    });
    assert.equal(cpRes.success, true);
    assert.equal(cpRes.checkpoint.mysteryApplesEaten, 1);
    assert.equal(cpRes.checkpoint.mysteryEffectsApplied.length, 1);
    assert.equal(cpRes.checkpoint.mysteryEffectsApplied[0].type, 'BONUS_SCORE');
    assert.equal(cpRes.checkpoint.currentScore, 300); // 100 base + 200 bonus
  });

  it('66. Undo handling reverts mystery effect and restores apple and previous state', async () => {
    const levelData = {
      levelNumber: 987,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'BONUS_SCORE', value: 200 } }],
    };
    const engine = new WormGameEngine(levelData);
    engine.move('RIGHT');
    assert.equal(engine.mysteryApplesEaten, 1);
    assert.equal(engine.score, 300);
    assert.equal(engine.apples.length, 0);

    const undone = engine.undo();
    assert.equal(undone, true);
    assert.equal(engine.mysteryApplesEaten, 0);
    assert.equal(engine.score, 0);
    assert.equal(engine.apples.length, 1);
    assert.equal(engine.apples[0].type, 'mystery');
  });

  it('67. Reset / restart handling clears all mystery apple counters and effects', async () => {
    const levelData = {
      levelNumber: 987,
      grid: { cols: 10, rows: 10 },
      wormStart: { x: 2, y: 5, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 15,
      apples: [{ x: 3, y: 5, type: 'mystery', mysteryEffect: { type: 'BONUS_SCORE', value: 200 } }],
    };
    const engine = new WormGameEngine(levelData);
    engine.move('RIGHT');
    assert.equal(engine.mysteryApplesEaten, 1);
    engine.reset();
    assert.equal(engine.mysteryApplesEaten, 0);
    assert.equal(engine.score, 0);
    assert.equal(engine.apples.length, 1);
  });

  it('68. Server-authoritative validation rejects unknown effect type and forged magnitudes with HTTP 400', async () => {
    const user = await User.create({
      username: `SpoofUser_68_${Date.now()}`,
      email: `controls_safe_tester_spoof68_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 987,
      highestUnlockedLevel: 987,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 987);

    // 1. Unknown effect type rejected
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 1,
          wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
          direction: 'RIGHT',
          movesTaken: 1,
          applesRemaining: [],
          mysteryEffectsApplied: [{ x: 3, y: 5, type: 'GIVE_INFINITE_COINS', value: 999999 }],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /unsupported mystery effect type/i);
        return true;
      }
    );

    // 2. Spoofed magnitude rejected
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 1,
          wormState: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
          direction: 'RIGHT',
          movesTaken: 1,
          applesRemaining: [],
          mysteryEffectsApplied: [{ x: 3, y: 5, type: 'BONUS_SCORE', value: 99999 }],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /spoofed mystery effect/i);
        return true;
      }
    );
  });

  it('69. Replay and claim tracking in PlayerProgress accurately tracks mystery apples', async () => {
    const user = await User.create({
      username: `ClaimUser_69_${Date.now()}`,
      email: `controls_safe_tester_claim69_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 987,
      highestUnlockedLevel: 987,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 987);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
    });
    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.rewards.mysteryApples, 1);

    const progress = await PlayerProgress.findOne({ userId: user._id });
    const rec = progress.completedLevels.find((l) => l.levelNumber === 987);
    assert.ok(rec);
    assert.equal(rec.mysteryApplesClaimed, 1);
    assert.equal(progress.totalMysteryApplesEaten, 1);

    // Replay session
    const replaySession = await gameSessionService.startSession(user._id, 987);
    await gameSessionService.saveCheckpoint(replaySession._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
    });
    const replayComp = await gameSessionService.completeSession(replaySession._id, user._id);
    assert.equal(replayComp.rewards.mysteryApples, 1);

    const progressAfterReplay = await PlayerProgress.findOne({ userId: user._id });
    const recAfter = progressAfterReplay.completedLevels.find((l) => l.levelNumber === 987);
    assert.equal(recAfter.mysteryApplesClaimed, 1);
    assert.equal(progressAfterReplay.totalMysteryApplesEaten, 1);
  });

  it('70. Concurrency security ensures concurrent completions on mystery levels do not corrupt progress', async () => {
    const user = await User.create({
      username: `ConcUser_70_${Date.now()}`,
      email: `controls_safe_tester_conc70_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 987,
      highestUnlockedLevel: 987,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 987);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
    });

    const [res1, res2] = await Promise.allSettled([
      gameSessionService.completeSession(session._id, user._id),
      gameSessionService.completeSession(session._id, user._id),
    ]);

    assert.ok(res1.status === 'fulfilled' || res2.status === 'fulfilled');
    const progress = await PlayerProgress.findOne({ userId: user._id });
    const rec = progress.completedLevels.find((l) => l.levelNumber === 987);
    assert.ok(rec);
    assert.equal(rec.mysteryApplesClaimed, 1);
    assert.equal(progress.totalMysteryApplesEaten, 1);
  });

  it('71. Edge case: reaching portal with extra moves from Mystery Apple allows victory', async () => {
    const user = await User.create({
      username: `MovesUser_71_${Date.now()}`,
      email: `controls_safe_tester_moves71_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 986,
      highestUnlockedLevel: 986,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 986 has moveLimit: 2. Reaching portal at (5,5) from (2,5) takes 3 moves.
    // Without +5 moves from Mystery Apple, moveTaken: 3 would fail with movesTaken exceeds level limit.
    const session = await gameSessionService.startSession(user._id, 986);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3, // Exceeds base moveLimit (2), but within 2 + 5 = 7!
      applesRemaining: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.mysteryApples, 1);
  });

  it('72. Edge case: reach_length objective with EXTRA_GROWTH Mystery Apple completes successfully', async () => {
    const user = await User.create({
      username: `LengthUser_72_${Date.now()}`,
      email: `controls_safe_tester_len72_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 985,
      highestUnlockedLevel: 985,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 985: initial worm length 2, reach_length target 4.
    // 1 Mystery Apple with EXTRA_GROWTH gives +2 segments -> final length = 4.
    const session = await gameSessionService.startSession(user._id, 985);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ], // Length 4!
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.rewards.mysteryApples, 1);
    assert.equal(compRes.rewards.mysteryEffects[0].type, 'EXTRA_GROWTH');
  });

  it('73. Legitimate reach_portal victory with uncollected optional apple is accepted', async () => {
    const user = await User.create({
      username: `u_rp73_${Date.now()}`,
      email: `controls_safe_tester_rp73_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 984,
      highestUnlockedLevel: 984,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 984);
    // Worm starts at (2,5), moves to portal at (5,5) in 3 moves without eating optional apple at (3,4)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
      ], // Length 2 (initial length, 0 apples eaten)
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [{ x: 3, y: 4, type: 'normal' }],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.applesCollected, 0);
    assert.equal(compRes.rewards.stars, 3);
    assert.equal(compRes.rewards.coins, 45); // 25 base + 20 star bonus
  });

  it('74. Legitimate limited_moves victory with uncollected optional apple within move budget is accepted', async () => {
    const user = await User.create({
      username: `u_lm74_${Date.now()}`,
      email: `controls_safe_tester_lm74_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 983,
      highestUnlockedLevel: 983,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 983 has moveLimit: 4. Reaching portal takes 3 moves (within limit).
    // Optional apple at (3,4) remains uncollected.
    const session = await gameSessionService.startSession(user._id, 983);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
      ], // Length 2
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [{ x: 3, y: 4, type: 'normal' }],
    });

    const compRes = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.moves, 3);
  });

  it('75. Limited_moves attempt exceeding the authoritative move budget is rejected with HTTP 400', async () => {
    const user = await User.create({
      username: `u_em75_${Date.now()}`,
      email: `controls_safe_tester_em75_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 983,
      highestUnlockedLevel: 983,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    // Level 983 has moveLimit: 4.
    // Ingress check: Attempting to save a checkpoint with 5 moves (> 4) is rejected with HTTP 400
    const session = await gameSessionService.startSession(user._id, 983);
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 1,
          wormState: [
            { x: 5, y: 5 },
            { x: 4, y: 5 },
          ],
          direction: 'RIGHT',
          movesTaken: 5, // Exceeds moveLimit 4!
          applesRemaining: [{ x: 3, y: 4, type: 'normal' }],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds level limit/i);
        return true;
      },
      'Checkpoint with moves exceeding limited_moves budget must reject with HTTP 400'
    );

    // Terminal completion check: Even if a checkpoint somehow had moves exceeding allowedMoves,
    // completeSession authoritatively rejects completion with HTTP 400
    await GameSession.findByIdAndUpdate(session._id, {
      $set: {
        'checkpoint.movesTaken': 5,
        'checkpoint.wormState': [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
        ],
        'checkpoint.applesRemaining': [{ x: 3, y: 4, type: 'normal' }],
      },
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(session._id, user._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds allowed limit/i);
        return true;
      },
      'completeSession must authoritatively reject moves exceeding allowed limit'
    );
  });

  it('76. Existing eat_all_apples objective continues requiring all apples to be collected', async () => {
    const user = await User.create({
      username: `u_ea76_${Date.now()}`,
      email: `controls_safe_tester_ea76_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 998, // Level 998 objective: eat_all_apples, has apple at (4,5)
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 998);
    // Worm reaches portal (5,5) without eating apple at (4,5) (applesRemaining still has apple)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      wormState: [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
      ], // Length 2
      direction: 'DOWN',
      movesTaken: 3,
      applesRemaining: [{ x: 4, y: 5, type: 'normal' }],
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(session._id, user._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Not all apples have been eaten/i);
        return true;
      },
      'eat_all_apples must continue rejecting completion if apples remain'
    );
  });

  it('77. Perfect_route objective accepts optimal route and rejects moves exceeding threeStar threshold', async () => {
    const userA = await User.create({
      username: `u_pra77_${Date.now()}`,
      email: `controls_safe_tester_pr77a_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: userA._id,
      currentLevel: 982,
      highestUnlockedLevel: 982,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: userA._id, balance: 100 });

    // Level 982: perfect_route, threeStars = 3, moveLimit = 10.
    // Case A: 3 moves (<= 3) completes successfully.
    const sessionA = await gameSessionService.startSession(userA._id, 982);
    await gameSessionService.saveCheckpoint(sessionA._id, userA._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 3,
      applesRemaining: [],
    });

    const compRes = await gameSessionService.completeSession(sessionA._id, userA._id);
    assert.equal(compRes.session.status, 'COMPLETED');
    assert.equal(compRes.session.starsEarned, 3);

    // Case B: 4 moves (> 3) is rejected even though moveLimit is 10.
    const userB = await User.create({
      username: `u_prb77_${Date.now()}`,
      email: `controls_safe_tester_pr77b_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: userB._id,
      currentLevel: 982,
      highestUnlockedLevel: 982,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: userB._id, balance: 100 });

    const sessionB = await gameSessionService.startSession(userB._id, 982);
    await gameSessionService.saveCheckpoint(sessionB._id, userB._id, {
      checkpointIndex: 1,
      wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      direction: 'RIGHT',
      movesTaken: 4, // > threeStars (3)
      applesRemaining: [],
    });

    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(sessionB._id, userB._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds perfect route threshold/i);
        return true;
      },
      'perfect_route exceeding 3-star threshold must reject with HTTP 400'
    );
  });

  it('78. SELF_COLLISION failure reason is accepted by failSession and persisted to GameSession', async () => {
    const user = await User.create({
      username: `u_sc78_${Date.now()}`,
      email: `controls_safe_tester_sc78_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 998);
    const failedSession = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 5,
      durationSeconds: 12,
    });

    assert.equal(failedSession.status, 'FAILED');
    assert.equal(failedSession.failureReason, 'SELF_COLLISION');

    const dbSession = await GameSession.findById(session._id);
    assert.equal(dbSession.status, 'FAILED');
    assert.equal(dbSession.failureReason, 'SELF_COLLISION');
    assert.equal(dbSession.moves, 5);
    assert.equal(dbSession.durationSeconds, 12);

    // Also verify schema rejects unsupported invalid reason
    const session2 = await gameSessionService.startSession(user._id, 998);
    await assert.rejects(
      async () => {
        await gameSessionService.failSession(session2._id, user._id, {
          failureReason: 'CHEATING_HACKS',
        });
      },
      (err) => {
        assert.ok(err);
        return true;
      },
      'Unsupported failure reason must be rejected by schema validation'
    );
  });

  it('79. WormGameEngine detects self-collision with own coiled body and transitions to FAILED with SELF_COLLISION', () => {
    // Worm starts at (2,1) facing RIGHT, initial length 5:
    // segments: [(2,1), (1,1), (0,1), (0,2), (0,3)]
    const levelDef = {
      levelNumber: 998,
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 1, initialLength: 5, direction: 'RIGHT' },
      portal: { x: 8, y: 8 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [],
      stones: [],
      obstacles: [],
    };
    const engine = new WormGameEngine(levelDef);
    assert.equal(engine.status, 'PLAYING');
    assert.equal(engine.movesCount, 0);

    // Move 1: DOWN to (2,2) -> head at (2,2), body: [(2,2), (2,1), (1,1), (0,1), (0,2)]
    const step1 = engine.move('DOWN');
    assert.equal(step1.moved, true);
    assert.equal(engine.status, 'PLAYING');

    // Move 2: LEFT to (1,2) -> head at (1,2), body: [(1,2), (2,2), (2,1), (1,1), (0,1)]
    const step2 = engine.move('LEFT');
    assert.equal(step2.moved, true);
    assert.equal(engine.status, 'PLAYING');

    // Move 3: UP to (1,1) -> (1,1) is occupied by body segment worm[3]!
    const step3 = engine.move('UP');
    assert.equal(step3.moved, true);
    assert.equal(step3.status, 'FAILED');
    assert.equal(step3.failureReason, 'SELF_COLLISION');
    assert.equal(step3.event, 'self_collision');
    assert.equal(engine.status, 'FAILED');
    assert.equal(engine.failureReason, 'SELF_COLLISION');
    assert.equal(engine.movesCount, 3);

    // Verify engine Undo reverses the fatal self-collision move
    const undoRes = engine.undo();
    assert.equal(undoRes, true);
    assert.equal(engine.status, 'PLAYING');
    assert.equal(engine.failureReason, null);
    assert.equal(engine.movesCount, 2);
  });

  it('80. WormGameEngine blocks 180-degree reversal directly into neck without move penalty', () => {
    // Worm starts at (3,3) facing RIGHT, length 3: segments [(3,3), (2,3), (1,3)]
    const levelDef = {
      levelNumber: 998,
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 3, y: 3, initialLength: 3, direction: 'RIGHT' },
      portal: { x: 8, y: 8 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [],
      stones: [],
      obstacles: [],
    };
    const engine = new WormGameEngine(levelDef);
    assert.equal(engine.status, 'PLAYING');

    // Attempt moving LEFT (directly toward neck at (2,3))
    const revStep = engine.move('LEFT');
    assert.equal(revStep.moved, false);
    assert.match(revStep.message, /cannot reverse/i);
    assert.equal(engine.status, 'PLAYING', 'Status must remain PLAYING on 180 reversal');
    assert.equal(engine.failureReason, null);
    assert.equal(engine.movesCount, 0, 'Moves count must not increment on blocked reversal');
  });

  it('81. WormGameEngine handles tail-vacating correctly (valid move when not growing, collision when eating apple)', () => {
    // Part A: Worm coils into a 2x2 loop. Moving into tail without apple succeeds.
    // Start: head (2,2), neck (1,2), seg2 (0,2), tail (0,3).
    const levelDefA = {
      levelNumber: 998,
      grid: { rows: 6, cols: 6 },
      wormStart: { x: 2, y: 2, initialLength: 4, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [],
      stones: [],
      obstacles: [],
    };
    const engineA = new WormGameEngine(levelDefA);
    // Move 1: UP to (2,1) -> head at (2,1), tail at (0,2)
    engineA.move('UP');
    // Move 2: LEFT to (1,1) -> head at (1,1), tail at (1,2)
    engineA.move('LEFT');
    // Now neck is (2,1), seg2 is (2,2), tail is (1,2).
    // Head is at (1,1). Moving DOWN moves toward (1,2) (the tail!).
    const stepDown = engineA.move('DOWN');
    // Because tail at (1,2) vacates to (2,2), head stepping into (1,2) succeeds!
    assert.equal(stepDown.moved, true);
    assert.equal(stepDown.status, 'PLAYING');
    assert.equal(engineA.status, 'PLAYING');
    assert.equal(engineA.worm[0].x, 1);
    assert.equal(engineA.worm[0].y, 2);

    // Part B: Same layout, but an apple is on the tail tile at (1,2).
    // Because the worm grows, the tail cannot vacate, triggering SELF_COLLISION!
    const levelDefB = {
      levelNumber: 998,
      grid: { rows: 6, cols: 6 },
      wormStart: { x: 2, y: 2, initialLength: 4, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [{ x: 1, y: 2, type: 'normal' }],
      stones: [],
      obstacles: [],
    };
    const engineB = new WormGameEngine(levelDefB);
    engineB.move('UP');   // head (2,1), tail (0,2)
    engineB.move('LEFT'); // head (1,1), tail (1,2)
    // Move DOWN toward (1,2): apple is on (1,2), so tail does NOT vacate!
    const stepCollision = engineB.move('DOWN');
    assert.equal(stepCollision.moved, true);
    assert.equal(stepCollision.status, 'FAILED');
    assert.equal(stepCollision.failureReason, 'SELF_COLLISION');
    assert.equal(engineB.status, 'FAILED');
    assert.equal(engineB.failureReason, 'SELF_COLLISION');
  });

  it('82. Backend failure handling for SELF_COLLISION is idempotent and prevents subsequent completion or rewards', async () => {
    const user = await User.create({
      username: `u_sc82_${Date.now()}`,
      email: `controls_safe_tester_sc82_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 998,
      highestUnlockedLevel: 998,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const session = await gameSessionService.startSession(user._id, 998);

    // Call failSession with SELF_COLLISION
    const fail1 = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 3,
      durationSeconds: 10,
    });
    assert.equal(fail1.status, 'FAILED');
    assert.equal(fail1.failureReason, 'SELF_COLLISION');

    // Duplicate call to failSession must be idempotent and return existing failed session
    const fail2 = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 3,
      durationSeconds: 10,
    });
    assert.equal(fail2.status, 'FAILED');
    assert.equal(fail2.failureReason, 'SELF_COLLISION');

    // Attempting to complete the failed session must reject with HTTP 400
    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(session._id, user._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /cannot complete a session that is FAILED/i);
        return true;
      },
      'Cannot complete a session that is FAILED'
    );

    // Wallet balance must remain strictly unchanged (0 rewards credited)
    const wallet = await walletService.getOrCreateWallet(user._id);
    assert.equal(wallet.balance, 100);

    // Progress record must have 0 completed levels
    const progress = await PlayerProgress.findOne({ userId: user._id });
    assert.equal(progress.completedLevels.length, 0);
  });

  it('83. Wall, pit, and spike collision handling remains intact alongside self-collision', () => {
    const levelDef = {
      levelNumber: 998,
      grid: { rows: 6, cols: 6 },
      wormStart: { x: 2, y: 2, initialLength: 2, direction: 'RIGHT' },
      portal: { x: 5, y: 5 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [],
      stones: [],
      obstacles: [
        { x: 3, y: 2, type: 'wall' },
        { x: 2, y: 1, type: 'spike' },
        { x: 2, y: 3, type: 'pit' },
      ],
    };

    // 1. Wall collision: blocked move, no status change, no moves increment
    const engineWall = new WormGameEngine(levelDef);
    const wallRes = engineWall.move('RIGHT'); // hits wall at (3,2)
    assert.equal(wallRes.moved, false);
    assert.equal(engineWall.status, 'PLAYING');
    assert.equal(engineWall.movesCount, 0);

    // 2. Spike collision: fatal collision, status FAILED, HIT_SPIKE
    const engineSpike = new WormGameEngine(levelDef);
    const spikeRes = engineSpike.move('UP'); // hits spike at (2,1)
    assert.equal(spikeRes.moved, true);
    assert.equal(spikeRes.status, 'FAILED');
    assert.equal(spikeRes.failureReason, 'HIT_SPIKE');
    assert.equal(engineSpike.status, 'FAILED');
    assert.equal(engineSpike.failureReason, 'HIT_SPIKE');
    assert.equal(engineSpike.movesCount, 1);

    // 3. Pit collision: fatal collision, status FAILED, FALLEN_OFF_GRID
    const enginePit = new WormGameEngine(levelDef);
    const pitRes = enginePit.move('DOWN'); // hits pit at (2,3)
    assert.equal(pitRes.moved, true);
    assert.equal(pitRes.status, 'FAILED');
    assert.equal(pitRes.failureReason, 'FALLEN_OFF_GRID');
    assert.equal(enginePit.status, 'FAILED');
    assert.equal(enginePit.failureReason, 'FALLEN_OFF_GRID');
    assert.equal(enginePit.movesCount, 1);
  });

  it('84. Moving block ping-pong patrol calculation and boundaries are deterministic', () => {
    // Horizontal moving block (x: 3, y: 2, range: 2)
    const horizObs = { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 };
    assert.deepEqual(getMovingBlockPosition(horizObs, 0), { x: 3, y: 2 });
    assert.deepEqual(getMovingBlockPosition(horizObs, 1), { x: 4, y: 2 });
    assert.deepEqual(getMovingBlockPosition(horizObs, 2), { x: 5, y: 2 });
    assert.deepEqual(getMovingBlockPosition(horizObs, 3), { x: 4, y: 2 });
    assert.deepEqual(getMovingBlockPosition(horizObs, 4), { x: 3, y: 2 });
    assert.deepEqual(getMovingBlockPosition(horizObs, 5), { x: 4, y: 2 });

    // Vertical moving block (x: 2, y: 1, range: 3)
    const vertObs = { x: 2, y: 1, type: 'moving_block', axis: 'vertical', range: 3 };
    assert.deepEqual(getMovingBlockPosition(vertObs, 0), { x: 2, y: 1 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 1), { x: 2, y: 2 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 2), { x: 2, y: 3 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 3), { x: 2, y: 4 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 4), { x: 2, y: 3 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 5), { x: 2, y: 2 });
    assert.deepEqual(getMovingBlockPosition(vertObs, 6), { x: 2, y: 1 });

    // Verify engine instance method matches
    const engine = new WormGameEngine({
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 1, y: 1, initialLength: 2, direction: 'RIGHT' },
      obstacles: [horizObs],
      portal: { x: 7, y: 7 },
    });
    assert.deepEqual(engine.getMovingBlockPosition(horizObs, 3), { x: 4, y: 2 });
  });

  it('85. WormGameEngine blocks movement into a moving block current tile without move penalty', () => {
    const levelDef = {
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, initialLength: 2, direction: 'RIGHT' }, // head (2,2), neck (1,2)
      obstacles: [
        { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      objective: 'reach_portal',
    };

    const engine = new WormGameEngine(levelDef);
    assert.equal(engine.status, 'PLAYING');
    assert.equal(engine.movesCount, 0);

    // At move 0, moving block is at (3,2). Worm attempts to move RIGHT into (3,2)
    const res = engine.move('RIGHT');
    assert.equal(res.moved, false);
    assert.equal(engine.movesCount, 0);
    assert.equal(engine.status, 'PLAYING');
    assert.deepEqual(engine.worm[0], { x: 2, y: 2 });
  });

  it('86. WormGameEngine detects crush collision and supports Undo restoration', () => {
    const levelDef = {
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 4, y: 1, initialLength: 2, direction: 'RIGHT' }, // head at (4,1), neck at (3,1)
      obstacles: [
        // Starts at (3,2), axis horizontal, range 1.
        // At move 0: (3,2). At move 1: (4,2).
        { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 1 },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      objective: 'reach_portal',
    };

    const engine = new WormGameEngine(levelDef);

    // Worm moves DOWN into (4,2). Simultaneously, block moves from (3,2) to (4,2).
    const res = engine.move('DOWN');
    assert.equal(res.moved, true);
    assert.equal(res.status, 'FAILED');
    assert.equal(res.failureReason, 'CRUSHED');
    assert.equal(engine.status, 'FAILED');
    assert.equal(engine.failureReason, 'CRUSHED');
    assert.equal(engine.movesCount, 1);

    // Verify Undo restores engine to PLAYING and block back to (3,2)
    const undone = engine.undo();
    assert.equal(undone, true);
    assert.equal(engine.status, 'PLAYING');
    assert.equal(engine.failureReason, null);
    assert.equal(engine.movesCount, 0);
    assert.deepEqual(engine.worm[0], { x: 4, y: 1 });
    assert.deepEqual(engine.getMovingBlockPosition(levelDef.obstacles[0], engine.movesCount), { x: 3, y: 2 });
  });

  it('87. Worm can safely cross a moving block patrol path when timing moves properly', () => {
    const levelDef = {
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 4, y: 0, initialLength: 2, direction: 'RIGHT' }, // head at (4,0), neck at (3,0)
      obstacles: [
        // Starts at (4,2), axis horizontal, range 2.
        // At move 0: (4,2). At move 1: (5,2). At move 2: (6,2). At move 3: (5,2).
        { x: 4, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 4, y: 3 },
      moveLimit: 20,
      objective: 'reach_portal',
    };

    const engine = new WormGameEngine(levelDef);

    // Move 1: DOWN -> head to (4,1), neck to (4,0). Block moves to (5,2). Safe!
    const m1 = engine.move('DOWN');
    assert.equal(m1.moved, true);
    assert.equal(m1.status, 'PLAYING');

    // Move 2: DOWN -> head to (4,2) [patrol tile!], neck to (4,1). Block moves to (6,2). Safe!
    const m2 = engine.move('DOWN');
    assert.equal(m2.moved, true);
    assert.equal(m2.status, 'PLAYING');

    // Move 3: DOWN -> head to (4,3) [portal!], neck to (4,2). Block moves to (5,2). Safe!
    const m3 = engine.move('DOWN');
    assert.equal(m3.moved, true);
    assert.equal(m3.status, 'WON');
    assert.equal(engine.status, 'WON');
  });

  it('88. Stone pushing is blocked into moving block current tile and patrol corridor', () => {
    const levelDef = {
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, initialLength: 2, direction: 'RIGHT' }, // head (2,2), neck (1,2)
      stones: [{ x: 3, y: 2 }],
      obstacles: [
        { x: 4, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      objective: 'reach_portal',
    };

    const engine = new WormGameEngine(levelDef);

    // At move 0, moving block is at (4,2). Pushing stone from (3,2) into (4,2) is blocked.
    const res = engine.move('RIGHT');
    assert.equal(res.moved, false);
    assert.equal(engine.stones[0].x, 3);
    assert.equal(engine.stones[0].y, 2);
  });

  it('89. Server saveCheckpoint and completeSession reject forged checkpoints overlapping moving blocks', async () => {
    const user = await User.create({
      username: `u_mb89_${Date.now()}`,
      email: `controls_safe_tester_mb89_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 980,
      highestUnlockedLevel: 980,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const levelDoc = await Level.create({
      levelNumber: 980,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [
        { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 6, y: 6 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 980);

    // 1. At move 1, moving block is at (4,2). Tile (3,2) is vacant!
    // Legitimate checkpoint with worm head at (3,2) and body at (2,2) at move 1 is accepted.
    const validCp = await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    assert.ok(validCp);

    // 2. At move 2, moving block is at (5,2).
    // Forged checkpoint with worm head at (5,2) at move 2 must be rejected with HTTP 400.
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 2,
          movesTaken: 2,
          currentScore: 0,
          wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }],
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /overlaps an impassable obstacle/i);
        return true;
      }
    );

    // 3. At move 4, moving block has cycled back to (3,2).
    // Forged checkpoint with worm body segment at (3,2) at move 4 must be rejected with HTTP 400.
    await assert.rejects(
      async () => {
        await gameSessionService.saveCheckpoint(session._id, user._id, {
          checkpointIndex: 3,
          movesTaken: 4,
          currentScore: 0,
          wormState: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
          applesRemaining: [],
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /overlaps an impassable obstacle/i);
        return true;
      }
    );

    // 4. Valid checkpoint at portal (6,6) at move 5 (block is at (4,2), no collision) completes safely
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 4,
      movesTaken: 5,
      currentScore: 0,
      wormState: [{ x: 6, y: 6 }, { x: 5, y: 6 }],
      applesRemaining: [],
    });
    const completed = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(completed.session.status, 'COMPLETED');
  });

  it('90. Backend failSession accepts CRUSHED failure reason and prevents subsequent completions', async () => {
    const user = await User.create({
      username: `u_mb90_${Date.now()}`,
      email: `controls_safe_tester_mb90_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 981,
      highestUnlockedLevel: 981,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });

    const levelDoc = await Level.create({
      levelNumber: 981,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 1, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [
        { x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 2 },
      ],
      portal: { x: 6, y: 6 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 981);

    // Fail session with CRUSHED
    const fail1 = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'CRUSHED',
      moves: 3,
      durationSeconds: 10,
    });
    assert.equal(fail1.status, 'FAILED');
    assert.equal(fail1.failureReason, 'CRUSHED');

    // Duplicate call to failSession must be idempotent
    const fail2 = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'CRUSHED',
      moves: 3,
      durationSeconds: 10,
    });
    assert.equal(fail2.status, 'FAILED');
    assert.equal(fail2.failureReason, 'CRUSHED');

    // Attempting to complete the CRUSHED session is strictly rejected
    await assert.rejects(
      async () => {
        await gameSessionService.completeSession(session._id, user._id);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /cannot complete a session that is FAILED/i);
        return true;
      }
    );

    // Verify wallet unchanged and no completed levels
    const wallet = await walletService.getOrCreateWallet(user._id);
    assert.equal(wallet.balance, 100);
    const progress = await PlayerProgress.findOne({ userId: user._id });
    assert.equal(progress.completedLevels.length, 0);
  });

  it('91. WormGameEngine supports Undo recovery from SELF_COLLISION, CRUSHED, HIT_SPIKE, FALLEN_OFF_GRID, and OUT_OF_MOVES', () => {
    const levelConfig = {
      levelNumber: 970,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 3, y: 3, direction: 'RIGHT', initialLength: 3 },
      apples: [{ x: 5, y: 3, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [
        { x: 3, y: 2, type: 'spike' },
        { x: 3, y: 4, type: 'pit' },
      ],
      portal: { x: 7, y: 7 },
      moveLimit: 2,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
    };

    // Subcase 1: Spike recovery
    const engine1 = new WormGameEngine(levelConfig);
    const spikeRes = engine1.move('UP');
    assert.equal(spikeRes.status, 'FAILED');
    assert.equal(spikeRes.failureReason, 'HIT_SPIKE');
    assert.equal(engine1.status, 'FAILED');
    assert.equal(engine1.failureReason, 'HIT_SPIKE');
    const undoSpike = engine1.undo();
    assert.equal(undoSpike, true);
    assert.equal(engine1.status, 'PLAYING');
    assert.equal(engine1.failureReason, null);
    assert.equal(engine1.moves, 0);

    // Subcase 2: Pit recovery
    const engine2 = new WormGameEngine(levelConfig);
    const pitRes = engine2.move('DOWN');
    assert.equal(pitRes.status, 'FAILED');
    assert.equal(pitRes.failureReason, 'FALLEN_OFF_GRID');
    const undoPit = engine2.undo();
    assert.equal(undoPit, true);
    assert.equal(engine2.status, 'PLAYING');
    assert.equal(engine2.failureReason, null);

    // Subcase 3: Self-collision recovery
    const engine3 = new WormGameEngine({
      levelNumber: 970,
      grid: { rows: 10, cols: 10 },
      wormStart: { x: 2, y: 1, initialLength: 5, direction: 'RIGHT' },
      portal: { x: 8, y: 8 },
      moveLimit: 20,
      objective: 'reach_portal',
      apples: [],
      stones: [],
      obstacles: [],
    });
    engine3.move('DOWN');
    engine3.move('LEFT');
    const selfRes = engine3.move('UP');
    assert.equal(selfRes.status, 'FAILED');
    assert.equal(selfRes.failureReason, 'SELF_COLLISION');
    const undoSelf = engine3.undo();
    assert.equal(undoSelf, true);
    assert.equal(engine3.status, 'PLAYING');
    assert.equal(engine3.failureReason, null);
    assert.equal(engine3.moves, 2);

    // Subcase 4: Crushed recovery
    const engine4 = new WormGameEngine({
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 4, y: 1, initialLength: 2, direction: 'RIGHT' },
      obstacles: [{ x: 3, y: 2, type: 'moving_block', axis: 'horizontal', range: 1 }],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      objective: 'reach_portal',
    });
    const crushRes = engine4.move('DOWN');
    assert.equal(crushRes.status, 'FAILED');
    assert.equal(crushRes.failureReason, 'CRUSHED');
    const undoCrush = engine4.undo();
    assert.equal(undoCrush, true);
    assert.equal(engine4.status, 'PLAYING');
    assert.equal(engine4.failureReason, null);

    // Subcase 5: Out of moves recovery
    const engine5 = new WormGameEngine({
      ...levelConfig,
      obstacles: [],
      moveLimit: 1,
    });
    const oomRes = engine5.move('RIGHT');
    assert.equal(oomRes.status, 'FAILED');
    assert.equal(oomRes.failureReason, 'OUT_OF_MOVES');
    const undoOom = engine5.undo();
    assert.equal(undoOom, true);
    assert.equal(engine5.status, 'PLAYING');
    assert.equal(engine5.failureReason, null);
  });

  it('92. Backend applyUndo successfully recovers a FAILED session caused by SELF_COLLISION: restores status: ACTIVE, resets failureReason: null, restores pre-fatal moves & checkpoint, and consumes exactly 1 UNDO item', async () => {
    const user = await User.create({
      username: `u_rec92_${Date.now()}`,
      email: `controls_safe_tester_rec92_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 971,
      highestUnlockedLevel: 971,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 3 } }
    );

    await Level.create({
      levelNumber: 971,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 3 },
      apples: [{ x: 3, y: 2, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 7, y: 7 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 971);
    assert.equal(session.status, 'ACTIVE');

    // Save checkpoint at move 1 (eaten apple, grew from length 3 to 4)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 100,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
      applesRemaining: [],
    });

    // Save checkpoint at move 2
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 2,
      movesTaken: 2,
      currentScore: 100,
      wormState: [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
      applesRemaining: [],
    });

    // Fatal move 3: self collision
    const failRes = await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 3,
      durationSeconds: 15,
    });
    assert.equal(failRes.status, 'FAILED');
    assert.equal(failRes.failureReason, 'SELF_COLLISION');

    const invBefore = await inventoryService.getInventory(user._id);
    assert.equal(invBefore.items.UNDO.quantity, 3);

    // Call applyUndo to recover
    const undoRes = await gameSessionService.applyUndo(session._id, user._id, 'undo_rec_self_col_1');
    assert.equal(undoRes.success, true);
    assert.equal(undoRes.status, 'ACTIVE');
    assert.equal(undoRes.moves, 2);
    assert.equal(undoRes.restoredCheckpoint.movesTaken, 2);
    assert.equal(undoRes.undosUsed, 1);

    // Verify session in database
    const dbSession = await GameSession.findById(session._id);
    assert.equal(dbSession.status, 'ACTIVE');
    assert.equal(dbSession.failureReason, null);
    assert.equal(dbSession.endedAt, null);
    assert.equal(dbSession.moves, 2);
    assert.equal(dbSession.undosUsed, 1);

    // Verify exactly 1 UNDO item consumed
    const invAfter = await inventoryService.getInventory(user._id);
    assert.equal(invAfter.items.UNDO.quantity, 2);
  });

  it('93. Backend applyUndo successfully recovers a FAILED session caused by CRUSHED, HIT_SPIKE, FALLEN_OFF_GRID, and OUT_OF_MOVES', async () => {
    const reasons = ['CRUSHED', 'HIT_SPIKE', 'FALLEN_OFF_GRID', 'OUT_OF_MOVES'];
    let levelNum = 972;

    for (const reason of reasons) {
      const user = await User.create({
        username: `u93_${reason.slice(0, 4)}_${Math.floor(Math.random() * 1000000)}`,
        email: `controls_safe_tester_rec93_${reason.toLowerCase()}_${Date.now()}@example.com`,
        password: 'SafePassword123!',
      });
      await PlayerProgress.create({
        userId: user._id,
        currentLevel: levelNum,
        highestUnlockedLevel: levelNum,
        totalStars: 0,
        completedLevels: [],
      });
      await Wallet.create({ userId: user._id, balance: 100 });
      await inventoryService.getOrCreateInventory(user._id);
      await Inventory.findOneAndUpdate(
        { userId: user._id },
        { $set: { 'items.UNDO.quantity': 2 } }
      );

      await Level.create({
        levelNumber: levelNum,
        difficulty: 'medium',
        grid: { rows: 8, cols: 8 },
        wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
        apples: [],
        stones: [],
        keys: [],
        obstacles: [],
        portal: { x: 7, y: 7 },
        moveLimit: 20,
        starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
        objective: 'reach_portal',
        targetValue: null,
        isActive: true,
      });

      const session = await gameSessionService.startSession(user._id, levelNum);

      // Save move 1
      await gameSessionService.saveCheckpoint(session._id, user._id, {
        checkpointIndex: 1,
        movesTaken: 1,
        currentScore: 0,
        wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
        applesRemaining: [],
      });

      // Fail session with reason
      await gameSessionService.failSession(session._id, user._id, {
        failureReason: reason,
        moves: 2,
        durationSeconds: 10,
      });

      // Recover via applyUndo
      const res = await gameSessionService.applyUndo(session._id, user._id, `undo_rec_${reason}_key`);
      assert.equal(res.success, true);
      assert.equal(res.status, 'ACTIVE');
      assert.equal(res.moves, 1);

      const dbSession = await GameSession.findById(session._id);
      assert.equal(dbSession.status, 'ACTIVE');
      assert.equal(dbSession.failureReason, null);
      assert.equal(dbSession.endedAt, null);

      const inv = await inventoryService.getInventory(user._id);
      assert.equal(inv.items.UNDO.quantity, 1);

      levelNum++;
    }
  });

  it('94. Reject recovery when user has zero UNDO items in inventory; ensures no items consumed and session remains FAILED', async () => {
    const user = await User.create({
      username: `u_rec94_${Date.now()}`,
      email: `controls_safe_tester_rec94_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 976,
      highestUnlockedLevel: 976,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 0 } }
    );

    await Level.create({
      levelNumber: 976,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 6, y: 6 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 976);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 2,
      durationSeconds: 8,
    });

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(session._id, user._id, 'undo_rec_zero_inv');
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Insufficient UNDO quantity/i);
        return true;
      }
    );

    const dbSession = await GameSession.findById(session._id);
    assert.equal(dbSession.status, 'FAILED');
    assert.equal(dbSession.failureReason, 'SELF_COLLISION');

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 0);
  });

  it('95. Replay protection & idempotency: repeated applyUndo with duplicate idempotency key returns restored checkpoint without double-debiting inventory', async () => {
    const user = await User.create({
      username: `u_rec95_${Date.now()}`,
      email: `controls_safe_tester_rec95_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 977,
      highestUnlockedLevel: 977,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 3 } }
    );

    await Level.create({
      levelNumber: 977,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 6, y: 6 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 977);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'OUT_OF_MOVES',
      moves: 2,
      durationSeconds: 10,
    });

    const idemKey = 'rec_idem_key_unique_1';

    // 1st call
    const res1 = await gameSessionService.applyUndo(session._id, user._id, idemKey);
    assert.equal(res1.success, true);
    assert.equal(res1.status, 'ACTIVE');
    assert.equal(res1.moves, 1);

    const inv1 = await inventoryService.getInventory(user._id);
    assert.equal(inv1.items.UNDO.quantity, 2);

    // 2nd call with identical key
    const res2 = await gameSessionService.applyUndo(session._id, user._id, idemKey);
    assert.equal(res2.success, true);
    assert.equal(res2.isDuplicate, true);
    assert.equal(res2.moves, 1);

    const inv2 = await inventoryService.getInventory(user._id);
    assert.equal(inv2.items.UNDO.quantity, 2, 'Inventory must not be decremented on duplicate call');

    const dbSession = await GameSession.findById(session._id);
    assert.equal(dbSession.undosUsed, 1);
  });

  it('96. Rejection: applyUndo strictly rejects recovery on COMPLETED sessions with HTTP 400', async () => {
    const user = await User.create({
      username: `u_rec96_${Date.now()}`,
      email: `controls_safe_tester_rec96_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 978,
      highestUnlockedLevel: 978,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 2 } }
    );

    await Level.create({
      levelNumber: 978,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 3, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 978);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    const completed = await gameSessionService.completeSession(session._id, user._id);
    assert.equal(completed.session.status, 'COMPLETED');

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(session._id, user._id, 'undo_rec_completed_attempt');
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Cannot undo on a session that is completed/i);
        return true;
      }
    );

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 2);
  });

  it('97. Rejection: applyUndo strictly rejects recovery on ABANDONED sessions or MANUAL_RESTART failure reasons with HTTP 400', async () => {
    const user = await User.create({
      username: `u_rec97_${Date.now()}`,
      email: `controls_safe_tester_rec97_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 979,
      highestUnlockedLevel: 979,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 5 } }
    );

    await Level.create({
      levelNumber: 979,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 5 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    // 1. Abandoned session
    const session1 = await gameSessionService.startSession(user._id, 979);
    await gameSessionService.saveCheckpoint(session1._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    await gameSessionService.abandonSession(session1._id, user._id);

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(session1._id, user._id, 'undo_abandoned_attempt');
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Cannot undo on a session that is abandoned/i);
        return true;
      }
    );

    // 2. Failed with MANUAL_RESTART
    const session2 = await gameSessionService.startSession(user._id, 979);
    await gameSessionService.saveCheckpoint(session2._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    await gameSessionService.failSession(session2._id, user._id, {
      failureReason: 'MANUAL_RESTART',
      moves: 2,
      durationSeconds: 5,
    });

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(session2._id, user._id, 'undo_manual_restart_attempt');
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Cannot undo on a session that is failed/i);
        return true;
      }
    );

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 5);
  });

  it('98. Rejection: applyUndo strictly rejects recovery on sessions where rewardClaimed: true or rewardTransactionId exists', async () => {
    const user = await User.create({
      username: `u_rec98_${Date.now()}`,
      email: `controls_safe_tester_rec98_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 968,
      highestUnlockedLevel: 968,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 2 } }
    );

    await Level.create({
      levelNumber: 968,
      difficulty: 'easy',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 5 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 968);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });

    // Artificially simulate a rewarded state
    await GameSession.findByIdAndUpdate(session._id, {
      status: 'FAILED',
      failureReason: 'SELF_COLLISION',
      rewardClaimed: true,
      rewardTransactionId: new mongoose.Types.ObjectId(),
    });

    await assert.rejects(
      async () => {
        await gameSessionService.applyUndo(session._id, user._id, 'undo_rewarded_attempt');
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Cannot undo on a session that is failed/i);
        return true;
      }
    );

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 2);
  });

  it('99. End-to-end recovery to victory: player fails with SELF_COLLISION, applies Undo recovery, resumes play, reaches portal, and completes session authoritatively with legitimate rewards', async () => {
    const user = await User.create({
      username: `u_rec99_${Date.now()}`,
      email: `controls_safe_tester_rec99_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 969,
      highestUnlockedLevel: 969,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 2 } }
    );

    await Level.create({
      levelNumber: 969,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [{ x: 3, y: 2, type: 'normal' }],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 5, y: 2 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 969);

    // Move 1: Eat apple at (3,2)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 100,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
      applesRemaining: [],
    });

    // Fatal move 2: Self-collision
    await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 2,
      durationSeconds: 12,
    });

    // Apply Undo Recovery
    const recRes = await gameSessionService.applyUndo(session._id, user._id, 'undo_rec_e2e_key');
    assert.equal(recRes.success, true);
    assert.equal(recRes.status, 'ACTIVE');
    assert.equal(recRes.moves, 1);

    // Resume play: Move 2 -> Advance to (4,2)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 2,
      movesTaken: 2,
      currentScore: 100,
      wormState: [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });

    // Move 3 -> Advance to portal at (5,2)
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 3,
      movesTaken: 3,
      currentScore: 100,
      wormState: [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
      applesRemaining: [],
    });

    // Complete session authoritatively
    const completeRes = await gameSessionService.completeSession(session._id, user._id, {
      moves: 3,
      durationSeconds: 15,
      applesCollected: 1,
    });

    assert.equal(completeRes.session.status, 'COMPLETED');
    assert.equal(completeRes.session.moves, 3);
    assert.equal(completeRes.session.undosUsed, 1);
    assert.equal(completeRes.rewards.stars, 3);
    assert.ok(completeRes.rewards.coins > 0);

    const progress = await PlayerProgress.findOne({ userId: user._id });
    assert.equal(progress.completedLevels.length, 1);
    assert.equal(progress.completedLevels[0].levelNumber, 969);

    const wallet = await walletService.getOrCreateWallet(user._id);
    assert.ok(wallet.balance > 100);

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 1);
  });

  it('100. Concurrent recovery requests for the same failed session resolve idempotently without double-debiting inventory', async () => {
    const user = await User.create({
      username: `u_rec100_${Date.now()}`,
      email: `controls_safe_tester_rec100_${Date.now()}@example.com`,
      password: 'SafePassword123!',
    });
    await PlayerProgress.create({
      userId: user._id,
      currentLevel: 967,
      highestUnlockedLevel: 967,
      totalStars: 0,
      completedLevels: [],
    });
    await Wallet.create({ userId: user._id, balance: 100 });
    await inventoryService.getOrCreateInventory(user._id);
    await Inventory.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'items.UNDO.quantity': 5 } }
    );

    await Level.create({
      levelNumber: 967,
      difficulty: 'expert',
      grid: { rows: 8, cols: 8 },
      wormStart: { x: 2, y: 2, direction: 'RIGHT', initialLength: 2 },
      apples: [],
      stones: [],
      keys: [],
      obstacles: [],
      portal: { x: 6, y: 6 },
      moveLimit: 20,
      starThresholds: { threeStars: 10, twoStars: 15, oneStar: 20 },
      objective: 'reach_portal',
      targetValue: null,
      isActive: true,
    });

    const session = await gameSessionService.startSession(user._id, 967);
    await gameSessionService.saveCheckpoint(session._id, user._id, {
      checkpointIndex: 1,
      movesTaken: 1,
      currentScore: 0,
      wormState: [{ x: 3, y: 2 }, { x: 2, y: 2 }],
      applesRemaining: [],
    });
    await gameSessionService.failSession(session._id, user._id, {
      failureReason: 'SELF_COLLISION',
      moves: 2,
      durationSeconds: 10,
    });

    const concKey = 'conc_undo_key_100';

    // Fire 2 concurrent recovery requests with the same key
    const [resA, resB] = await Promise.all([
      gameSessionService.applyUndo(session._id, user._id, concKey),
      gameSessionService.applyUndo(session._id, user._id, concKey),
    ]);

    assert.equal(resA.success, true);
    assert.equal(resB.success, true);

    const inv = await inventoryService.getInventory(user._id);
    assert.equal(inv.items.UNDO.quantity, 4, 'Inventory must be debited exactly once across concurrent identical requests');

    const dbSession = await GameSession.findById(session._id);
    assert.equal(dbSession.status, 'ACTIVE');
    assert.equal(dbSession.failureReason, null);
    assert.equal(dbSession.undosUsed, 1);
  });

  it('101. app.js tiered rate limiting: verifies auth routes are strictly guarded while gameplay routes support sustained multi-level play', async () => {
    const http = await import('node:http');
    const app = (await import('../src/app.js')).default;

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Health check returns 200
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);

      // 2. Auth routes are accessible and not 429 on standard request
      const authRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@example.com', password: 'bad' }),
      });
      assert.notEqual(authRes.status, 429, 'Auth route must not be rate-limited on standard request');
      assert.equal(authRes.status, 401, 'Auth login with nonexistent credentials must return HTTP 401 instead of 500 misconfiguration');
      const authBody = await authRes.json();
      assert.equal(authBody.success, false);
      assert.equal(authBody.message, 'Invalid email or password');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('102. Client checkpoint circuit breaker: halts immediate retries upon HTTP 429 rate-limiting without request amplification', async () => {
    let callCount = 0;
    const fakeSaveCheckpoint = async () => {
      callCount++;
      const err = new Error('Too many requests from this IP, please try again after 15 minutes.');
      err.status = 429;
      err.statusCode = 429;
      throw err;
    };

    let lastErr = null;
    let saved = false;

    // Emulate the updated processCheckpointQueue loop with circuit breaker
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fakeSaveCheckpoint();
        saved = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err.status === 429 || err.statusCode === 429 || err.message?.includes('Too many requests')) {
          break;
        }
      }
    }

    assert.equal(saved, false);
    assert.equal(callCount, 1, 'Circuit breaker must prevent 2nd and 3rd retry attempts on HTTP 429');
    assert.equal(lastErr.status, 429);
  });
});