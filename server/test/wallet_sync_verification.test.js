import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import WalletTransaction from '../src/models/WalletTransaction.js';
import EconomyConfig from '../src/models/EconomyConfig.js';
import walletService from '../src/services/walletService.js';
import gameSessionService from '../src/services/gameSessionService.js';
import Level from '../src/models/Level.js';
import { assertValidTestTarget } from '../src/utils/validateTestTarget.js';

function resolveClientPath(relPath) {
  const directPath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(directPath)) return directPath;
  return path.resolve(process.cwd(), '..', relPath);
}

describe('Global Wallet Balance Synchronization Verification Suite', () => {
  let server;
  let baseUrl;
  let testUser;
  let authToken;
  let createdEconomyConfig = null;

  before(async () => {
    // Isolated test JWT_SECRET configuration
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_isolated_key_for_wallet_sync_verification_suite';
    }

    // Fail closed: require explicit TEST_MONGODB_URI and validate test target before connection
    const testMongoUri = process.env.TEST_MONGODB_URI;
    assertValidTestTarget(testMongoUri);

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(testMongoUri);
    }

    // Ensure active economy configuration exists
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

    // Create unique test user with initial balance
    const username = `wuser_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const email = `${username}@veloop.com`;
    const password = 'Password123!';

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const regData = await regRes.json();
    assert.equal(regRes.status, 201);
    authToken = regData.token;
    testUser = await User.findOne({ email }).lean();

    // Seed wallet with 645 coins (matching the prompt scenario)
    await walletService.credit(testUser._id, 645, {
      type: 'BONUS',
      description: 'Initial test wallet seed of 645 coins',
      idempotencyKey: `seed_balance_${Date.now()}`,
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (createdEconomyConfig?._id) {
      await EconomyConfig.deleteOne({ _id: createdEconomyConfig._id });
    }
    if (mongoose.connection.readyState !== 0 && mongoose.connection.name.toLowerCase().includes('test')) {
      if (testUser?._id) {
        await Wallet.deleteMany({ userId: testUser._id });
        await WalletTransaction.collection.deleteMany({ userId: testUser._id });
        await User.deleteMany({ _id: testUser._id });
      }
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it('1. GET /api/wallet returns authoritative initial balance matching User.coins', async () => {
    const res = await fetch(`${baseUrl}/api/wallet`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.balance, 645);

    const userInDb = await User.findById(testUser._id).lean();
    assert.equal(userInDb.coins, 645);
  });

  it('2. POST /api/wallet/purchase (Undo: 40 coins) returns updated balance 605 and syncs User.coins', async () => {
    const idempotencyKey = `undo_buy_test_${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.balance, 605);
    assert.equal(data.data.balanceBefore, 645);
    assert.equal(data.data.balanceAfter, 605);

    // Verify database coherence
    const userInDb = await User.findById(testUser._id).lean();
    assert.equal(userInDb.coins, 605);

    const walletInDb = await Wallet.findOne({ userId: testUser._id }).lean();
    assert.equal(walletInDb.balance, 605);
  });

  it('3. Subsequent item purchase (Booster: 100 coins) debits balance to 505 matching example', async () => {
    const idempotencyKey = `booster_buy_test_${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        itemType: 'BOOSTER',
        idempotencyKey,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.balance, 505);

    // GET /api/wallet reflects 505
    const walletRes = await fetch(`${baseUrl}/api/wallet`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const walletData = await walletRes.json();
    assert.equal(walletData.data.balance, 505);

    const userInDb = await User.findById(testUser._id).lean();
    assert.equal(userInDb.coins, 505);
  });

  it('4. Frontend code integrity: WalletContext is created and correctly exported', () => {
    const filePath = resolveClientPath('client/src/context/WalletContext.jsx');
    assert.ok(fs.existsSync(filePath), 'WalletContext.jsx must exist');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('export function WalletProvider'), 'Must export WalletProvider');
    assert.ok(content.includes('export function useWallet'), 'Must export useWallet hook');
    assert.ok(content.includes('refreshWallet'), 'Must expose refreshWallet method');
    assert.ok(content.includes('updateBalance'), 'Must expose updateBalance method');
  });

  it('5. Frontend code integrity: App.jsx wraps GameApp with WalletProvider', () => {
    const filePath = resolveClientPath('client/src/App.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes("import { WalletProvider } from './context/WalletContext.jsx';"));
    assert.ok(content.includes('<WalletProvider>'));
    assert.ok(content.includes('</WalletProvider>'));
  });

  it('6. Frontend code integrity: Navbar.jsx consumes useWallet for live coin updates', () => {
    const filePath = resolveClientPath('client/src/components/common/Navbar.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('useWallet'));
    assert.ok(content.includes('const { balance } = useWallet();'));
  });

  it('7. Frontend code integrity: GamePlayPage.jsx consumes useWallet and synchronizes balance on events', () => {
    const filePath = resolveClientPath('client/src/pages/GamePlayPage.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('useWallet'));
    assert.ok(content.includes('const { balance: contextBalance, updateBalance } = useWallet();'));
    // Ensures purchaseItem response syncs updateBalanceRef
    assert.ok(content.includes('updateBalanceRef.current?.(Number(newBal));'));
    // Ensures completeSession response syncs updateBalanceRef
    assert.ok(content.includes('updateBalanceRef.current?.(Number(resData.wallet.balance));'));
    // Ensures refreshUserEconomy syncs updateBalanceRef
    assert.ok(content.includes('updateBalanceRef.current?.(Number(bal));'));
  });

  it('8. Frontend code integrity: HomePage.jsx and WalletPage.jsx sync with WalletContext', () => {
    const homePath = resolveClientPath('client/src/pages/HomePage.jsx');
    const homeContent = fs.readFileSync(homePath, 'utf8');
    assert.ok(homeContent.includes('useWallet'));
    assert.ok(homeContent.includes('const { balance } = useWallet();'));

    const walletPath = resolveClientPath('client/src/pages/WalletPage.jsx');
    const walletContent = fs.readFileSync(walletPath, 'utf8');
    assert.ok(walletContent.includes('useWallet'));
    assert.ok(walletContent.includes('updateBalanceRef.current?.(res.data.balance);'));
  });
});
