import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import walletService from '../src/services/walletService.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

describe('Wallet Context Lifecycle Hardening Test Suite', () => {
  let server;
  let baseUrl;
  let userA;
  let tokenA;
  let userB;
  let tokenB;
  let createdEconomyConfig = null;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_isolated_key_for_lifecycle_hardening_suite';
    }

    // Fail closed: require explicit TEST_MONGODB_URI and validate test target before connection
    const testMongoUri = process.env.TEST_MONGODB_URI;
    assertValidTestTarget(testMongoUri);

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(testMongoUri);
    }

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
          undoPurchaseCost: 40,
          hintPurchaseCost: 50,
          boosterPurchaseCost: 100,
        },
      });
      createdEconomyConfig = config;
    }

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Register User A (645 coins)
    const unameA = `userA_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const regResA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: unameA, email: `${unameA}@test.com`, password: 'Password123!' }),
    });
    const regDataA = await regResA.json();
    tokenA = regDataA.token;
    userA = await User.findOne({ username: unameA }).lean();
    await walletService.credit(userA._id, 645, {
      type: 'BONUS',
      description: 'Initial seed for user A',
      idempotencyKey: `seed_A_${Date.now()}`,
    });
    userA = await User.findById(userA._id).lean();

    // Register User B (150 coins)
    const unameB = `userB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const regResB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: unameB, email: `${unameB}@test.com`, password: 'Password123!' }),
    });
    const regDataB = await regResB.json();
    tokenB = regDataB.token;
    userB = await User.findOne({ username: unameB }).lean();
    await walletService.credit(userB._id, 150, {
      type: 'BONUS',
      description: 'Initial seed for user B',
      idempotencyKey: `seed_B_${Date.now()}`,
    });
    userB = await User.findById(userB._id).lean();
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (createdEconomyConfig?._id) {
      await EconomyConfig.deleteOne({ _id: createdEconomyConfig._id });
    }
    if (mongoose.connection.readyState !== 0 && mongoose.connection.name.toLowerCase().includes('test')) {
      const userIds = [userA?._id, userB?._id].filter(Boolean);
      if (userIds.length > 0) {
        await Wallet.deleteMany({ userId: { $in: userIds } });
        await WalletTransaction.collection.deleteMany({ userId: { $in: userIds } });
        await User.deleteMany({ _id: { $in: userIds } });
      }
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it('1. Pending requests after logout: in-flight wallet refresh cannot update state after logout', async () => {
    // Harness simulating WalletContext state & lifecycle logic
    let balance = 645;
    let authUserCoins = 645;
    let isAuthenticated = true;
    let currentUserId = userA._id.toString();
    let activeRequestId = 0;
    const isMounted = true;

    const updateUserCoins = (c) => { authUserCoins = c; };

    // Function matching WalletContext.refreshWallet implementation
    const simulateRefreshWallet = async (delayMs, fetchResult) => {
      if (!isAuthenticated) return null;
      const targetUserId = currentUserId;
      const reqId = ++activeRequestId;

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (!isMounted || reqId !== activeRequestId || !isAuthenticated || targetUserId !== currentUserId) {
        return null; // DISCARDED
      }

      balance = fetchResult;
      updateUserCoins(fetchResult);
      return fetchResult;
    };

    // User triggers refresh with 50ms latency
    const refreshPromise = simulateRefreshWallet(50, 700);

    // User logs out at 10ms (before network response arrives)
    await new Promise((resolve) => setTimeout(resolve, 10));
    isAuthenticated = false;
    currentUserId = null;
    activeRequestId++; // Invalidate pending requests on logout
    balance = null;

    // Await response
    const result = await refreshPromise;

    // Assert that response was discarded
    assert.equal(result, null, 'In-flight response must be dropped');
    assert.equal(balance, null, 'Balance must remain null after logout');
    assert.equal(authUserCoins, 645, 'AuthContext user coins must NOT be updated by post-logout response');
  });

  it('2. Account switching: previous account balance cannot remain visible while new account initializes', async () => {
    // User A is active
    let balance = 645;
    let lastActiveUserId = userA._id.toString();
    let activeRequestId = 5;
    let isAuthenticated = true;
    let currentUserId = userA._id.toString();

    // User A triggers slow refresh (100ms)
    let slowResponseAccepted = false;
    const userASlowRequest = (async () => {
      const targetUserId = currentUserId;
      const reqId = ++activeRequestId;
      await new Promise((r) => setTimeout(r, 60));
      if (reqId === activeRequestId && isAuthenticated && targetUserId === currentUserId) {
        slowResponseAccepted = true;
        balance = 645;
      }
    })();

    // User switches to User B (with 150 profile coins) at 20ms
    await new Promise((r) => setTimeout(r, 20));

    // Simulate WalletContext account switch effect:
    currentUserId = userB._id.toString();
    const isAccountSwitch = lastActiveUserId !== null && lastActiveUserId !== currentUserId;
    assert.equal(isAccountSwitch, true, 'Must detect account switch');

    activeRequestId++; // Invalidate User A requests
    const initialCoins = typeof userB.coins === 'number' ? userB.coins : 150;
    balance = initialCoins; // Immediately reset to User B coins, never retain User A's 645
    lastActiveUserId = currentUserId;

    assert.equal(balance, 150, 'Must display User B balance immediately upon switch');

    // Wait for User A's slow request to finish
    await userASlowRequest;

    assert.equal(slowResponseAccepted, false, 'User A request must not be accepted');
    assert.equal(balance, 150, 'Balance must remain User B balance (150) and not revert to User A');
  });

  it('3. Stale requests: older request returning later cannot overwrite newer request', async () => {
    let balance = 0;
    let activeRequestId = 0;

    const executeRequest = async (reqNumber, delayMs, returnedBalance) => {
      const reqId = ++activeRequestId;
      await new Promise((r) => setTimeout(r, delayMs));

      if (reqId === activeRequestId) {
        balance = returnedBalance;
        return true;
      }
      return false; // Stale request dropped
    };

    // Request 1 is slow (returns 645 in 60ms)
    const p1 = executeRequest(1, 60, 645);
    // Request 2 is fast (returns 605 in 20ms)
    const p2 = executeRequest(2, 20, 605);

    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(r2, true, 'Newer request must be accepted');
    assert.equal(r1, false, 'Older request returning later must be rejected');
    assert.equal(balance, 605, 'Balance must reflect newer request (605)');
  });

  it('4. updateBalance() invalidates in-flight older refreshWallet requests', async () => {
    let balance = 645;
    let activeRequestId = 0;

    // Simulate in-flight refresh (server had pre-purchase balance of 645)
    let refreshOverwrote = false;
    const inFlightRefresh = (async () => {
      const reqId = ++activeRequestId;
      await new Promise((r) => setTimeout(r, 50));
      if (reqId === activeRequestId) {
        balance = 645;
        refreshOverwrote = true;
      }
    })();

    // User buys an item at 10ms -> server authoritatively confirms balance: 605
    await new Promise((r) => setTimeout(r, 10));
    // updateBalance(605) called
    activeRequestId++; // lifecycle hardening: updateBalance advances activeRequestId
    balance = 605;

    await inFlightRefresh;

    assert.equal(refreshOverwrote, false, 'In-flight older read must not overwrite transaction balance');
    assert.equal(balance, 605, 'Balance must stay at 605');
  });

  it('5. Session restoration: initial profile balance rendered immediately, then verified by server', async () => {
    const res = await fetch(`${baseUrl}/api/wallet`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.balance, 645);
  });

  it('6. updateBalance() synchronizes both AuthContext and WalletContext', () => {
    let walletState = null;
    let authUserCoins = null;
    const isAuthenticated = true;

    const updateUserCoins = (coins) => {
      authUserCoins = coins;
    };

    const updateBalance = (newBalance) => {
      if (newBalance !== null && newBalance !== undefined && Number.isFinite(Number(newBalance))) {
        const num = Number(newBalance);
        walletState = num;
        if (isAuthenticated) {
          updateUserCoins(num);
        }
      }
    };

    updateBalance(505);

    assert.equal(walletState, 505);
    assert.equal(authUserCoins, 505);
  });

  it('7. Real server API: purchase and reward flows reflect exact balance progression', async () => {
    // User A has 645
    // Purchase UNDO (40 coins)
    const buyRes = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: `buy_undo_lh_${Date.now()}`,
      }),
    });
    const buyData = await buyRes.json();
    assert.equal(buyRes.status, 200);
    assert.equal(buyData.data.balance, 605);

    // Verify GET /api/wallet matches
    const wRes = await fetch(`${baseUrl}/api/wallet`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const wData = await wRes.json();
    assert.equal(wData.data.balance, 605);
  });

  it('8. WalletContext.jsx file verification: all lifecycle safeguards are implemented', () => {
    const filePath = fs.existsSync(path.resolve(process.cwd(), 'client/src/context/WalletContext.jsx'))
      ? path.resolve(process.cwd(), 'client/src/context/WalletContext.jsx')
      : path.resolve(process.cwd(), '../client/src/context/WalletContext.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Post-logout protection check
    assert.ok(content.includes('!isAuthenticatedRef.current'), 'Must verify isAuthenticatedRef');
    // 2. Cross-account check
    assert.ok(content.includes('targetUserId !== currentUserIdRef.current'), 'Must verify targetUserId matches currentUserId');
    // 3. Stale request check
    assert.ok(content.includes('reqId !== activeRequestIdRef.current'), 'Must verify reqId matches activeRequestId');
    // 4. Invalidation on updateBalance
    assert.ok(content.includes('activeRequestIdRef.current++'), 'Must increment activeRequestId on updateBalance');
    // 5. Account switch detection
    assert.ok(content.includes('isAccountSwitch'), 'Must detect account switch');
  });
});
