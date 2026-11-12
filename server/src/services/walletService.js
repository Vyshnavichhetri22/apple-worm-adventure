import mongoose from 'mongoose';
import Wallet from '../models/Wallet.js';
import WalletTransaction, { TRANSACTION_TYPES } from '../models/WalletTransaction.js';
import User from '../models/User.js';

export const walletService = {
  /**
   * Retrieves an existing wallet for a user or creates one.
   * Seamlessly migrates existing User.coins balance if present.
   */
  async getOrCreateWallet(userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid userId format');
      error.statusCode = 400;
      throw error;
    }

    let wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      // Check if user has legacy coins recorded
      const user = await User.findById(userId).lean();
      const legacyBalance = user && Number.isInteger(user.coins) && user.coins > 0 ? user.coins : 0;

      wallet = await Wallet.create({
        userId,
        balance: legacyBalance,
      });

      // Record migration ledger entry if initial coins existed
      if (legacyBalance > 0) {
        await WalletTransaction.create({
          userId,
          walletId: wallet._id,
          direction: 'CREDIT',
          type: 'BONUS',
          amount: legacyBalance,
          balanceBefore: 0,
          balanceAfter: legacyBalance,
          idempotencyKey: `migration_user_${userId}`,
          description: 'Initial legacy balance migration to wallet',
          metadata: { initialMigration: true },
        }).catch((err) => {
          // Ignore duplicate migration key race conditions
          if (err.code !== 11000) console.error('Migration ledger warning:', err.message);
        });
      }
    }

    return wallet;
  },

  /**
   * Credits coins to a user's wallet with database-enforced idempotency.
   */
  async credit(userId, amount, options = {}) {
    const {
      type = 'BONUS',
      referenceId = null,
      idempotencyKey = null,
      description = 'Coin credit',
      metadata = {},
    } = options;

    if (!Number.isInteger(amount) || amount <= 0) {
      const error = new Error(`Credit amount must be a positive integer (received: ${amount})`);
      error.statusCode = 400;
      throw error;
    }

    if (!TRANSACTION_TYPES.includes(type)) {
      const error = new Error(`Invalid transaction type: ${type}`);
      error.statusCode = 400;
      throw error;
    }

    // Idempotency check: verify whether this key was already processed
    if (idempotencyKey) {
      const existingTx = await WalletTransaction.findOne({ idempotencyKey });
      if (existingTx) {
        const isSameUser = existingTx.userId.toString() === userId.toString();
        const isSameAmount = existingTx.amount === amount;
        const isSameDirection = existingTx.direction === 'CREDIT';
        const isSameType = existingTx.type === type;

        // Same request: return existing transaction without double-crediting
        if (isSameUser && isSameAmount && isSameDirection && isSameType) {
          const wallet = await Wallet.findById(existingTx.walletId);
          return {
            isDuplicate: true,
            transaction: existingTx,
            balanceBefore: existingTx.balanceBefore,
            balanceAfter: existingTx.balanceAfter,
            wallet,
          };
        }

        // Different request reusing the same idempotency key: reject with conflict
        const error = new Error(
          `Idempotency key collision: key "${idempotencyKey}" already used with different transaction parameters`
        );
        error.statusCode = 409;
        throw error;
      }
    }

    await this.getOrCreateWallet(userId);

    // Atomic credit with returnDocument: 'after'
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { balance: amount } },
      { returnDocument: 'after' }
    );

    const balanceBefore = updatedWallet.balance - amount;
    const balanceAfter = updatedWallet.balance;

    try {
      const transaction = await WalletTransaction.create({
        userId,
        walletId: updatedWallet._id,
        direction: 'CREDIT',
        type,
        amount,
        balanceBefore,
        balanceAfter,
        referenceId: referenceId ? String(referenceId) : null,
        idempotencyKey: idempotencyKey || null,
        description,
        metadata,
      });

      // Synchronize with User document in an isolated guard so legacy sync issues
      // cannot falsely trigger an erroneous rollback of the authoritative wallet
      try {
        await User.findByIdAndUpdate(userId, { $set: { coins: balanceAfter } });
      } catch (syncErr) {
        console.error(`User.coins sync warning for user ${userId}:`, syncErr.message);
      }

      return {
        isDuplicate: false,
        transaction,
        balanceBefore,
        balanceAfter,
        wallet: updatedWallet,
      };
    } catch (err) {
      // Revert wallet increment on ledger failure
      await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: -amount } },
        { returnDocument: 'after' }
      );
      const error = new Error(`Ledger recording failed: ${err.message}`);
      error.statusCode = err.code === 11000 ? 409 : 500;
      throw error;
    }
  },

  /**
   * Debits coins from a user's wallet with atomic balance check and idempotency.
   */
  async debit(userId, amount, options = {}) {
    const {
      type = 'HINT_PURCHASE',
      referenceId = null,
      idempotencyKey = null,
      description = 'Coin debit',
      metadata = {},
    } = options;

    if (!Number.isInteger(amount) || amount <= 0) {
      const error = new Error(`Debit amount must be a positive integer (received: ${amount})`);
      error.statusCode = 400;
      throw error;
    }

    if (!TRANSACTION_TYPES.includes(type)) {
      const error = new Error(`Invalid transaction type: ${type}`);
      error.statusCode = 400;
      throw error;
    }

    // Idempotency check: verify whether this key was already processed
    if (idempotencyKey) {
      const existingTx = await WalletTransaction.findOne({ idempotencyKey });
      if (existingTx) {
        const isSameUser = existingTx.userId.toString() === userId.toString();
        const isSameAmount = existingTx.amount === amount;
        const isSameDirection = existingTx.direction === 'DEBIT';
        const isSameType = existingTx.type === type;

        // Same request: return existing transaction without double-debiting
        if (isSameUser && isSameAmount && isSameDirection && isSameType) {
          const wallet = await Wallet.findById(existingTx.walletId);
          return {
            isDuplicate: true,
            transaction: existingTx,
            balanceBefore: existingTx.balanceBefore,
            balanceAfter: existingTx.balanceAfter,
            wallet,
          };
        }

        // Different request reusing the same idempotency key: reject with conflict
        const error = new Error(
          `Idempotency key collision: key "${idempotencyKey}" already used with different transaction parameters`
        );
        error.statusCode = 409;
        throw error;
      }
    }

    const currentWallet = await this.getOrCreateWallet(userId);

    // Atomic debit conditioned on balance >= amount with returnDocument: 'after'
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { returnDocument: 'after' }
    );

    if (!updatedWallet) {
      const error = new Error(
        `Insufficient balance. Required: ${amount}, Available: ${currentWallet.balance}`
      );
      error.statusCode = 400;
      throw error;
    }

    const balanceBefore = updatedWallet.balance + amount;
    const balanceAfter = updatedWallet.balance;

    try {
      const transaction = await WalletTransaction.create({
        userId,
        walletId: updatedWallet._id,
        direction: 'DEBIT',
        type,
        amount,
        balanceBefore,
        balanceAfter,
        referenceId: referenceId ? String(referenceId) : null,
        idempotencyKey: idempotencyKey || null,
        description,
        metadata,
      });

      // Synchronize with User document in an isolated guard so legacy sync issues
      // cannot falsely trigger an erroneous rollback of the authoritative wallet
      try {
        await User.findByIdAndUpdate(userId, { $set: { coins: balanceAfter } });
      } catch (syncErr) {
        console.error(`User.coins sync warning for user ${userId}:`, syncErr.message);
      }

      return {
        isDuplicate: false,
        transaction,
        balanceBefore,
        balanceAfter,
        wallet: updatedWallet,
      };
    } catch (err) {
      // Revert wallet decrement on ledger failure
      await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: amount } },
        { returnDocument: 'after' }
      );
      const error = new Error(`Ledger recording failed: ${err.message}`);
      error.statusCode = err.code === 11000 ? 409 : 500;
      throw error;
    }
  },

  /**
   * Returns authoritative wallet summary for a user.
   */
  async getWalletSummary(userId) {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      walletId: wallet._id,
      userId: wallet.userId,
      balance: wallet.balance,
      currency: wallet.currency,
      isActive: wallet.isActive,
      updatedAt: wallet.updatedAt,
    };
  },

  /**
   * Returns paginated transaction history for a user.
   */
  async getTransactionHistory(userId, options = {}) {
    await this.getOrCreateWallet(userId);

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = { userId };
    if (options.type) query.type = options.type;
    if (options.direction) query.direction = options.direction;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(query),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },
};

export default walletService;