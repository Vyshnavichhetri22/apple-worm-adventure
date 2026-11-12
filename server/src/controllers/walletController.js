import walletService from '../services/walletService.js';

/**
 * @desc    Get current user's authoritative wallet balance and details
 * @route   GET /api/wallet
 * @access  Private (Authenticated User)
 */
export const getWallet = async (req, res) => {
  try {
    const userId = req.user.userId;
    const summary = await walletService.getWalletSummary(userId);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Error retrieving wallet summary',
    });
  }
};

/**
 * @desc    Get current user's paginated wallet transaction history
 * @route   GET /api/wallet/transactions
 * @access  Private (Authenticated User)
 */
export const getTransactions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page, limit, type, direction } = req.query;

    const result = await walletService.getTransactionHistory(userId, {
      page,
      limit,
      type,
      direction,
    });

    return res.status(200).json({
      success: true,
      data: result.transactions,
      pagination: result.pagination,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Error retrieving transaction history',
    });
  }
};