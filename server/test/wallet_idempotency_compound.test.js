import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test_jwt_secret_isolated_key_for_compound_idempotency_suite';
}

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Wallet } = await import('../src/models/Wallet.js');
const { default: WalletTransaction } = await import('../src/models/WalletTransaction.js');
const { default: EconomyConfig } = await import('../src/models/EconomyConfig.js');
const { default: walletService } = await import('../src/services/walletService.js');
const { migrateWalletIdempotencyIndex } = await import('../src/utils/migrateWalletIdempotencyIndex.js');

describe('User-Scoped Compound Wallet Idempotency Key Suite', () => {
  let server;
  let baseUrl;
  let testUser1;
  let tokenUser1;
  let testUser2;
  let tokenUser2;
  const createdUserIds = [];

  before(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/apple_worm_adventure_test';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Ensure database migration has run on the test collection
    await migrateWalletIdempotencyIndex(mongoose.connection.db, { quiet: true });

    // Ensure active economy config exists
    let config = await EconomyConfig.findOne({ isActive: true });
    if (!config) {
      config = await EconomyConfig.create({
        version: 8888,
        isActive: true,
        rules: {
          undoPurchaseCost: 40,
          hintPurchaseCost: 50,
          boosterPurchaseCost: 100,
        },
      });
    }

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Register User 1
    const u1Name = `idemp_u1_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const regRes1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: u1Name,
        email: `${u1Name}@veloop.com`,
        password: 'Password123!',
      }),
    });
    const reg1Data = await regRes1.json();
    const u1 = reg1Data.user;
    testUser1 = { id: (u1._id || u1.id).toString(), ...u1 };
    tokenUser1 = reg1Data.token;
    createdUserIds.push(testUser1.id);

    // Register User 2
    const u2Name = `idemp_u2_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const regRes2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: u2Name,
        email: `${u2Name}@veloop.com`,
        password: 'Password123!',
      }),
    });
    const reg2Data = await regRes2.json();
    const u2 = reg2Data.user;
    testUser2 = { id: (u2._id || u2.id).toString(), ...u2 };
    tokenUser2 = reg2Data.token;
    createdUserIds.push(testUser2.id);

    // Fund both users
    await walletService.credit(testUser1.id, 500, {
      type: 'BONUS',
      description: 'Initial funding for testUser1',
    });
    await walletService.credit(testUser2.id, 500, {
      type: 'BONUS',
      description: 'Initial funding for testUser2',
    });
  });

  after(async () => {
    if (createdUserIds.length > 0 && mongoose.connection.readyState === 1) {
      const objIds = createdUserIds.map((id) => new mongoose.Types.ObjectId(id));
      await WalletTransaction.collection.deleteMany({ userId: { $in: objIds } });
      await Wallet.deleteMany({ userId: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }

    if (server && server.listening) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it('1. Index verification: compound unique index { userId: 1, idempotencyKey: 1 } exists and obsolete global index is absent', async () => {
    const indexes = await WalletTransaction.collection.indexes();
    const compoundIdx = indexes.find((i) => i.name === 'userId_1_idempotencyKey_1' || (i.key?.userId === 1 && i.key?.idempotencyKey === 1));
    const oldGlobalIdx = indexes.find((i) => i.name === 'idempotencyKey_1' || (i.key?.idempotencyKey === 1 && !i.key?.userId));

    assert.ok(compoundIdx, 'Compound index userId_1_idempotencyKey_1 must be present');
    assert.strictEqual(compoundIdx.unique, true, 'Compound index must be unique');
    assert.deepStrictEqual(
      compoundIdx.partialFilterExpression,
      { idempotencyKey: { $type: 'string' } },
      'Index must use partialFilterExpression to ignore null keys'
    );
    assert.strictEqual(oldGlobalIdx, undefined, 'Obsolete global index idempotencyKey_1 must not be present');
  });

  it('2. Model layer: direct duplicate insertion for the SAME user is rejected with duplicate key error (code 11000)', async () => {
    const sharedKey = `direct_test_key_${Date.now()}`;
    const user1Wallet = await Wallet.findOne({ userId: testUser1.id });

    // First transaction succeeds
    const tx1 = await WalletTransaction.create({
      userId: testUser1.id,
      walletId: user1Wallet._id,
      direction: 'CREDIT',
      type: 'BONUS',
      amount: 10,
      balanceBefore: 500,
      balanceAfter: 510,
      idempotencyKey: sharedKey,
      description: 'First direct credit',
    });
    assert.ok(tx1._id);

    // Second transaction with the same user and same key must fail with 11000
    let duplicateError = null;
    try {
      await WalletTransaction.create({
        userId: testUser1.id,
        walletId: user1Wallet._id,
        direction: 'CREDIT',
        type: 'BONUS',
        amount: 10,
        balanceBefore: 510,
        balanceAfter: 520,
        idempotencyKey: sharedKey,
        description: 'Duplicate direct credit attempt',
      });
    } catch (err) {
      duplicateError = err;
    }

    assert.ok(duplicateError, 'Expected duplicate key error for same user');
    assert.strictEqual(duplicateError.code, 11000, 'Error code must be 11000 (duplicate key)');
  });

  it('3. Model layer: two DIFFERENT users can create transactions with the identical idempotencyKey', async () => {
    const crossUserKey = `cross_user_key_${Date.now()}`;
    const user1Wallet = await Wallet.findOne({ userId: testUser1.id });
    const user2Wallet = await Wallet.findOne({ userId: testUser2.id });

    // User 1 creates transaction with crossUserKey
    const txUser1 = await WalletTransaction.create({
      userId: testUser1.id,
      walletId: user1Wallet._id,
      direction: 'CREDIT',
      type: 'BONUS',
      amount: 15,
      balanceBefore: 500,
      balanceAfter: 515,
      idempotencyKey: crossUserKey,
      description: 'User 1 cross-user key transaction',
    });
    assert.ok(txUser1._id);

    // User 2 creates transaction with the exact same crossUserKey
    const txUser2 = await WalletTransaction.create({
      userId: testUser2.id,
      walletId: user2Wallet._id,
      direction: 'CREDIT',
      type: 'BONUS',
      amount: 15,
      balanceBefore: 500,
      balanceAfter: 515,
      idempotencyKey: crossUserKey,
      description: 'User 2 cross-user key transaction',
    });
    assert.ok(txUser2._id);
    assert.notStrictEqual(txUser1._id.toString(), txUser2._id.toString());
    assert.strictEqual(txUser1.idempotencyKey, txUser2.idempotencyKey);
  });

  it('4. Model layer: multiple transactions with idempotencyKey: null for the same user do not collide', async () => {
    const user1Wallet = await Wallet.findOne({ userId: testUser1.id });

    // Two null-key transactions for User 1
    const nullTx1 = await WalletTransaction.create({
      userId: testUser1.id,
      walletId: user1Wallet._id,
      direction: 'CREDIT',
      type: 'LEVEL_REWARD',
      amount: 25,
      balanceBefore: 500,
      balanceAfter: 525,
      idempotencyKey: null,
      description: 'Null key transaction 1',
    });

    const nullTx2 = await WalletTransaction.create({
      userId: testUser1.id,
      walletId: user1Wallet._id,
      direction: 'CREDIT',
      type: 'LEVEL_REWARD',
      amount: 25,
      balanceBefore: 525,
      balanceAfter: 550,
      idempotencyKey: null,
      description: 'Null key transaction 2',
    });

    assert.ok(nullTx1._id);
    assert.ok(nullTx2._id);
  });

  it('5. Service layer: walletService.debit and walletService.credit handle cross-user keys independently', async () => {
    const debitKey = `svc_debit_key_${Date.now()}`;

    // User 1 debits 50 coins using debitKey
    const debitRes1 = await walletService.debit(testUser1.id, 50, {
      type: 'HINT_PURCHASE',
      idempotencyKey: debitKey,
      description: 'User 1 debit',
    });
    assert.strictEqual(debitRes1.isDuplicate, false);
    assert.strictEqual(debitRes1.balanceBefore - debitRes1.balanceAfter, 50);

    // User 2 debits 50 coins using the EXACT SAME debitKey
    const debitRes2 = await walletService.debit(testUser2.id, 50, {
      type: 'HINT_PURCHASE',
      idempotencyKey: debitKey,
      description: 'User 2 debit with identical key',
    });
    assert.strictEqual(debitRes2.isDuplicate, false, 'User 2 debit must be a fresh non-duplicate transaction');
    assert.notStrictEqual(debitRes1.transaction._id.toString(), debitRes2.transaction._id.toString());

    // User 1 replays the debitKey -> receives isDuplicate: true
    const replayRes1 = await walletService.debit(testUser1.id, 50, {
      type: 'HINT_PURCHASE',
      idempotencyKey: debitKey,
      description: 'User 1 debit replay',
    });
    assert.strictEqual(replayRes1.isDuplicate, true);
    assert.strictEqual(replayRes1.transaction._id.toString(), debitRes1.transaction._id.toString());

    // User 1 reuses debitKey with conflicting amount (100) -> throws 409 Conflict
    await assert.rejects(
      async () => {
        await walletService.debit(testUser1.id, 100, {
          type: 'HINT_PURCHASE',
          idempotencyKey: debitKey,
        });
      },
      (err) => err.statusCode === 409
    );
  });

  it('6. API layer: POST /api/wallet/purchase allows two different users to purchase with the identical idempotencyKey', async () => {
    const apiSharedKey = `api_shared_key_${Date.now()}`;

    // User 1 purchases UNDO item with apiSharedKey
    const res1 = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser1}`,
      },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: apiSharedKey,
      }),
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(data1.success, true);
    assert.strictEqual(data1.data.isDuplicate, false);
    assert.strictEqual(data1.data.itemType, 'UNDO');

    // User 2 purchases UNDO item with the EXACT SAME apiSharedKey
    const res2 = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser2}`,
      },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: apiSharedKey,
      }),
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 200, 'User 2 purchase with same idempotency key must succeed with 200');
    assert.strictEqual(data2.success, true);
    assert.strictEqual(data2.data.isDuplicate, false, 'User 2 purchase must be fresh (not duplicate of User 1)');
    assert.notStrictEqual(data1.data.transaction.id, data2.data.transaction.id, 'Transactions must be separate records');

    // User 1 replays apiSharedKey -> returns 200 OK with isDuplicate: true
    const replayRes = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser1}`,
      },
      body: JSON.stringify({
        itemType: 'UNDO',
        idempotencyKey: apiSharedKey,
      }),
    });
    const replayData = await replayRes.json();
    assert.strictEqual(replayRes.status, 200);
    assert.strictEqual(replayData.data.isDuplicate, true);

    // User 2 reuses apiSharedKey with different itemType -> returns 409 Conflict
    const conflictRes = await fetch(`${baseUrl}/api/wallet/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser2}`,
      },
      body: JSON.stringify({
        itemType: 'HINT',
        idempotencyKey: apiSharedKey,
      }),
    });
    assert.strictEqual(conflictRes.status, 409, 'Reusing key with different parameters must return 409 Conflict');
  });

  it('7. Ledger immutability: WalletTransaction prevents update and delete operations', async () => {
    const user1Wallet = await Wallet.findOne({ userId: testUser1.id });
    const immutTx = await WalletTransaction.create({
      userId: testUser1.id,
      walletId: user1Wallet._id,
      direction: 'CREDIT',
      type: 'BONUS',
      amount: 1,
      balanceBefore: 100,
      balanceAfter: 101,
      description: 'Immutability test',
    });

    await assert.rejects(async () => {
      await WalletTransaction.updateOne({ _id: immutTx._id }, { $set: { amount: 999 } });
    }, /immutable append-only ledger/);

    await assert.rejects(async () => {
      await WalletTransaction.deleteOne({ _id: immutTx._id });
    }, /immutable append-only ledger/);
  });

  it('8. Concurrency: same-user concurrent duplicate debit requests resolve cleanly without double-debiting', async () => {
    const concurrentDebitKey = `conc_debit_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startingBalance = startWallet.balance;
    const debitAmount = 40;

    // Fire 2 simultaneous debit calls with the identical key and parameters
    const [resA, resB] = await Promise.all([
      walletService.debit(testUser1.id, debitAmount, {
        type: 'UNDO_PURCHASE',
        idempotencyKey: concurrentDebitKey,
        description: 'Concurrent debit A',
      }),
      walletService.debit(testUser1.id, debitAmount, {
        type: 'UNDO_PURCHASE',
        idempotencyKey: concurrentDebitKey,
        description: 'Concurrent debit B',
      }),
    ]);

    // Both promises must succeed
    assert.ok(resA && resB, 'Both concurrent debit operations must return results');

    // Exactly one operation is original, the other is duplicate
    const isDuplicates = [resA.isDuplicate, resB.isDuplicate];
    assert.ok(isDuplicates.includes(false), 'One operation must be the primary (isDuplicate: false)');
    assert.ok(isDuplicates.includes(true), 'One operation must be resolved as duplicate (isDuplicate: true)');

    // Both must reference the exact same ledger transaction
    assert.strictEqual(
      resA.transaction._id.toString(),
      resB.transaction._id.toString(),
      'Both concurrent calls must reference the identical winning transaction'
    );

    // Exactly one ledger transaction was created
    const txRecords = await WalletTransaction.find({
      userId: testUser1.id,
      idempotencyKey: concurrentDebitKey,
    });
    assert.strictEqual(txRecords.length, 1, 'Exactly one ledger record must exist for this idempotency key');

    // Authoritative balance must be decremented by debitAmount exactly once
    const finalWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(
      finalWallet.balance,
      startingBalance - debitAmount,
      `Balance must be reduced by ${debitAmount} once, from ${startingBalance} to ${startingBalance - debitAmount}`
    );
  });

  it('9. Concurrency: same-user concurrent duplicate credit requests resolve cleanly without double-crediting', async () => {
    const concurrentCreditKey = `conc_credit_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startingBalance = startWallet.balance;
    const creditAmount = 75;

    // Fire 2 simultaneous credit calls with the identical key and parameters
    const [resA, resB] = await Promise.all([
      walletService.credit(testUser1.id, creditAmount, {
        type: 'LEVEL_REWARD',
        idempotencyKey: concurrentCreditKey,
        description: 'Concurrent credit A',
      }),
      walletService.credit(testUser1.id, creditAmount, {
        type: 'LEVEL_REWARD',
        idempotencyKey: concurrentCreditKey,
        description: 'Concurrent credit B',
      }),
    ]);

    assert.ok(resA && resB);

    const isDuplicates = [resA.isDuplicate, resB.isDuplicate];
    assert.ok(isDuplicates.includes(false));
    assert.ok(isDuplicates.includes(true));

    assert.strictEqual(resA.transaction._id.toString(), resB.transaction._id.toString());

    // Exactly one ledger record exists
    const txRecords = await WalletTransaction.find({
      userId: testUser1.id,
      idempotencyKey: concurrentCreditKey,
    });
    assert.strictEqual(txRecords.length, 1);

    // Authoritative balance must be incremented exactly once
    const finalWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(
      finalWallet.balance,
      startingBalance + creditAmount,
      `Balance must be incremented by ${creditAmount} once, from ${startingBalance} to ${startingBalance + creditAmount}`
    );
  });

  it('10. Concurrency: same-user concurrent requests with conflicting parameters reject loser with 409 Conflict', async () => {
    const conflictRaceKey = `race_conflict_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startingBalance = startWallet.balance;

    // Fire 2 simultaneous calls with the same key but different types and amounts
    const results = await Promise.allSettled([
      walletService.debit(testUser1.id, 40, {
        type: 'UNDO_PURCHASE',
        idempotencyKey: conflictRaceKey,
      }),
      walletService.debit(testUser1.id, 50, {
        type: 'HINT_PURCHASE',
        idempotencyKey: conflictRaceKey,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one conflicting request must be fulfilled');
    assert.strictEqual(rejected.length, 1, 'Exactly one conflicting request must be rejected');

    const winner = fulfilled[0].value;
    const loser = rejected[0].reason;

    assert.strictEqual(loser.statusCode, 409, 'Losing conflicting request must be rejected with HTTP 409');
    assert.ok(
      loser.message.includes('Idempotency key collision'),
      'Error message must indicate idempotency key collision'
    );

    // Wallet balance must reflect only the winning request
    const finalWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(
      finalWallet.balance,
      startingBalance - winner.transaction.amount,
      'Wallet balance must be debited solely by the winning transaction amount'
    );
  });

  it('11. Concurrency: API layer POST /api/wallet/purchase concurrent duplicate requests both return 200 OK', async () => {
    const apiConcurrentKey = `api_conc_race_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startingBalance = startWallet.balance;
    const itemCost = 40; // UNDO cost

    // Send 2 concurrent HTTP purchase requests with identical idempotencyKey
    const [fetchResA, fetchResB] = await Promise.all([
      fetch(`${baseUrl}/api/wallet/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUser1}`,
        },
        body: JSON.stringify({
          itemType: 'UNDO',
          idempotencyKey: apiConcurrentKey,
        }),
      }),
      fetch(`${baseUrl}/api/wallet/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUser1}`,
        },
        body: JSON.stringify({
          itemType: 'UNDO',
          idempotencyKey: apiConcurrentKey,
        }),
      }),
    ]);

    const dataA = await fetchResA.json();
    const dataB = await fetchResB.json();

    // Both requests must succeed with HTTP 200
    assert.strictEqual(fetchResA.status, 200, 'First concurrent API request must return 200');
    assert.strictEqual(fetchResB.status, 200, 'Second concurrent API request must return 200');
    assert.strictEqual(dataA.success, true);
    assert.strictEqual(dataB.success, true);

    // Exactly one is duplicate: false, and one is duplicate: true
    const dupFlags = [dataA.data.isDuplicate, dataB.data.isDuplicate];
    assert.ok(dupFlags.includes(false), 'One API response must mark isDuplicate: false');
    assert.ok(dupFlags.includes(true), 'One API response must mark isDuplicate: true');

    // Both point to identical transaction ID
    assert.strictEqual(
      dataA.data.transaction.id,
      dataB.data.transaction.id,
      'Both concurrent API responses must report the identical transaction ID'
    );

    // Exactly one transaction in ledger
    const txCount = await WalletTransaction.countDocuments({
      userId: testUser1.id,
      idempotencyKey: apiConcurrentKey,
    });
    assert.strictEqual(txCount, 1, 'Ledger must contain exactly 1 transaction for this key');

    // Balance reduced only once
    const endWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(
      endWallet.balance,
      startingBalance - itemCost,
      `Balance must be reduced by ${itemCost} coins exactly once`
    );
  });

  it('12. Concurrency: different users submitting the same key simultaneously succeed independently', async () => {
    const crossConcurrentKey = `cross_conc_${Date.now()}`;
    const startWallet1 = await Wallet.findOne({ userId: testUser1.id });
    const startWallet2 = await Wallet.findOne({ userId: testUser2.id });

    // Both users concurrently debit with identical key
    const [res1, res2] = await Promise.all([
      walletService.debit(testUser1.id, 50, {
        type: 'HINT_PURCHASE',
        idempotencyKey: crossConcurrentKey,
      }),
      walletService.debit(testUser2.id, 50, {
        type: 'HINT_PURCHASE',
        idempotencyKey: crossConcurrentKey,
      }),
    ]);

    assert.strictEqual(res1.isDuplicate, false);
    assert.strictEqual(res2.isDuplicate, false);
    assert.notStrictEqual(res1.transaction._id.toString(), res2.transaction._id.toString());

    // Both balances debited by 50
    const end1 = await Wallet.findOne({ userId: testUser1.id });
    const end2 = await Wallet.findOne({ userId: testUser2.id });
    assert.strictEqual(end1.balance, startWallet1.balance - 50);
    assert.strictEqual(end2.balance, startWallet2.balance - 50);
  });

  it('13. Unrelated duplicate-key errors are not swallowed or treated as idempotent success', async () => {
    const unrelatedKey = `unrelated_err_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startBal = startWallet.balance;

    // Simulate an unrelated duplicate key error (e.g. unique constraint on _id)
    // by intercepting WalletTransaction.create for this specific invocation
    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async () => {
      const unrelatedErr = new Error('E11000 duplicate key error collection: wallettransactions index: _id_ dup key: { _id: ObjectId("...") }');
      unrelatedErr.code = 11000;
      unrelatedErr.keyPattern = { _id: 1 };
      unrelatedErr.keyValue = { _id: 'fake_id_123' };
      throw unrelatedErr;
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.debit(testUser1.id, 30, {
            type: 'UNDO_PURCHASE',
            idempotencyKey: unrelatedKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.ok(err.message.includes('Ledger recording failed'));
          return true;
        }
      );
    } finally {
      WalletTransaction.create = originalCreate;
    }

    // Step 2 invariant: balance was debited atomically, snapshot remains in unsettledOperations without rollback
    const afterWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(afterWallet.balance, startBal - 30, 'Balance is debited and retained without blind rollback');
    assert.ok(
      afterWallet.unsettledOperations.some((op) => op.idempotencyKey === unrelatedKey),
      'Snapshot must remain in unsettledOperations for recovery'
    );
  });

  it('14. Ledger insertion failure before persistence: preserves snapshot for recovery without rollback', async () => {
    const failKey = `fail_pre_persist_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startBal = startWallet.balance;
    const debitAmount = 35;

    // Simulate validation failure before database persistence
    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async () => {
      const valErr = new mongoose.Error.ValidationError();
      valErr.message = 'Path `description` is required.';
      throw valErr;
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.debit(testUser1.id, debitAmount, {
            type: 'UNDO_PURCHASE',
            idempotencyKey: failKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 500);
          assert.ok(err.message.includes('Ledger recording failed'));
          return true;
        }
      );
    } finally {
      WalletTransaction.create = originalCreate;
    }

    // Ledger record was NOT created
    const tx = await WalletTransaction.findOne({ userId: testUser1.id, idempotencyKey: failKey });
    assert.strictEqual(tx, null);

    // Step 2 invariant: balance was debited atomically, snapshot remains in unsettledOperations without rollback
    const endWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(endWallet.balance, startBal - debitAmount, 'Balance reflects atomic debit');
    assert.ok(
      endWallet.unsettledOperations.some((op) => op.idempotencyKey === failKey),
      'Snapshot must remain in unsettledOperations for recovery'
    );
  });

  it('15. Ambiguous write outcome where ledger DID persist: verified via idempotency key and returned without blind rollback', async () => {
    const ambigPersistedKey = `ambig_persisted_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startBal = startWallet.balance;
    const debitAmount = 40;

    // Simulate MongoDB committing the record, but socket timeout occurs before ack
    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async (doc) => {
      // Actually write the document directly to the database (simulating DB commit)
      const data = Array.isArray(doc) ? doc[0] : doc;
      await originalCreate(data);

      // But simulate client network timeout
      const timeoutErr = new Error('connection closed while waiting for response');
      timeoutErr.name = 'MongoNetworkTimeoutError';
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    };

    try {
      const result = await walletService.debit(testUser1.id, debitAmount, {
        type: 'UNDO_PURCHASE',
        idempotencyKey: ambigPersistedKey,
        description: 'Ambiguous write test',
      });

      assert.ok(result, 'Service must recover the committed write instead of throwing');
      assert.strictEqual(result.isDuplicate, false);
      assert.strictEqual(result.transaction.amount, debitAmount);
      assert.strictEqual(result.balanceAfter, startBal - debitAmount);
    } finally {
      WalletTransaction.create = originalCreate;
    }

    // Ledger record must exist
    const tx = await WalletTransaction.findOne({ userId: testUser1.id, idempotencyKey: ambigPersistedKey });
    assert.ok(tx);
    assert.strictEqual(tx.amount, debitAmount);

    // Balance must NOT have been rolled back (must remain startBal - debitAmount)
    const endWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(endWallet.balance, startBal - debitAmount, 'Wallet must not be blindly compensated if ledger persisted');
  });

  it('16. Ambiguous write outcome where verification fails: persistence is uncertain, compensation aborted, explicit error thrown', async () => {
    const uncertainKey = `uncertain_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startBal = startWallet.balance;

    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    const originalFindOne = WalletTransaction.findOne.bind(WalletTransaction);

    let createAttempted = false;
    WalletTransaction.create = async () => {
      createAttempted = true;
      const timeoutErr = new Error('socket timed out');
      timeoutErr.name = 'MongoNetworkTimeoutError';
      throw timeoutErr;
    };

    // Simulate verification query failing after write attempt because connection dropped
    WalletTransaction.findOne = async (query, projection, options) => {
      if (createAttempted && query && query.idempotencyKey === uncertainKey) {
        const netErr = new Error('connection lost during verification');
        netErr.name = 'MongoServerSelectionError';
        throw netErr;
      }
      return originalFindOne(query, projection, options);
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.debit(testUser1.id, 25, {
            type: 'UNDO_PURCHASE',
            idempotencyKey: uncertainKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 500);
          assert.strictEqual(err.isAmbiguous, true);
          assert.strictEqual(err.persistenceUncertain, true);
          assert.ok(err.message.includes('Compensation was aborted'));
          assert.ok(err.discrepancy, 'Discrepancy metadata must be present');
          assert.strictEqual(err.discrepancy.userId.toString(), testUser1.id.toString());
          assert.strictEqual(err.discrepancy.amount, 25);
          return true;
        }
      );
    } finally {
      WalletTransaction.create = originalCreate;
      WalletTransaction.findOne = originalFindOne;
    }
  });

  it('17. Ledger persistence failure leaves durable unsettled snapshot for recovery without blind rollback', async () => {
    const compFailKey = `comp_fail_${Date.now()}`;
    const startWallet = await Wallet.findOne({ userId: testUser1.id });
    const startBal = startWallet.balance;

    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async () => {
      const err = new Error('Disk full on ledger collection');
      err.code = 12345;
      throw err;
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.debit(testUser1.id, 20, {
            type: 'UNDO_PURCHASE',
            idempotencyKey: compFailKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 500);
          assert.ok(err.message.includes('Ledger recording failed'));
          assert.ok(err.snapshot, 'Snapshot must be attached to error for recovery context');
          return true;
        }
      );
    } finally {
      WalletTransaction.create = originalCreate;
    }

    // Step 2 invariant: balance is NOT rolled back; snapshot remains in unsettledOperations
    const endWallet = await Wallet.findOne({ userId: testUser1.id });
    assert.strictEqual(endWallet.balance, startBal - 20, 'Balance reflects atomic debit');
    const snap = endWallet.unsettledOperations.find((op) => op.idempotencyKey === compFailKey);
    assert.ok(snap, 'Unsettled snapshot must remain in wallet for Step 2.4 recovery worker');
  });

  it('18. Elimination of compensating rollbacks: failed credit ledger write does not decrement balance', async () => {
    const credKey = `safe_cred_neg_${Date.now()}`;
    // Set wallet to a known small balance: 10
    await Wallet.findOneAndUpdate({ userId: testUser1.id }, { $set: { balance: 10 } });

    const originalCreate = WalletTransaction.create.bind(WalletTransaction);
    WalletTransaction.create = async () => {
      // While the credit of 100 was applied (balance became 110),
      // simulate a concurrent debit operation that immediately spent 105 coins
      await Wallet.findOneAndUpdate({ userId: testUser1.id }, { $inc: { balance: -105 } });
      // Now balance is 5!

      // Now ledger insertion fails
      const err = new Error('Ledger write validation failed');
      err.code = 9999;
      throw err;
    };

    try {
      await assert.rejects(
        async () => {
          await walletService.credit(testUser1.id, 100, {
            type: 'LEVEL_REWARD',
            idempotencyKey: credKey,
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 500);
          assert.ok(err.message.includes('Ledger recording failed'));
          return true;
        }
      );

      // In Step 2, no compensating rollback is executed. Balance remains 5 (not driven negative)
      const finalBal = await Wallet.findOne({ userId: testUser1.id });
      assert.strictEqual(finalBal.balance, 5, 'Balance must remain 5 without blind negative compensation');
      assert.ok(finalBal.unsettledOperations.some((op) => op.idempotencyKey === credKey), 'Snapshot preserved in unsettledOperations');
    } finally {
      WalletTransaction.create = originalCreate;
      // Restore healthy balance for test user
      await Wallet.findOneAndUpdate({ userId: testUser1.id }, { $set: { balance: 500 } });
    }
  });

  it('19. Topology inspection and session pass-through support', async () => {
    // Check topology detection helper
    const txSupported = walletService.supportsTransactions();
    assert.strictEqual(typeof txSupported, 'boolean');
    assert.strictEqual(txSupported, false, 'Standalone local test database must be identified as false');

    // Check ambiguous write error classification
    assert.strictEqual(walletService.isAmbiguousWriteError(new Error('Connection timed out')), true);
    assert.strictEqual(walletService.isAmbiguousWriteError({ name: 'MongoNetworkTimeoutError' }), true);
    assert.strictEqual(walletService.isAmbiguousWriteError(new Error('Normal validation failed')), false);
  });
});
