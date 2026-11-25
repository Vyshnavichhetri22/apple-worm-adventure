/**
 * @file WalletPage.jsx
 * @description VELoop Coin Wallet view for Apple Worm Adventure.
 * Displays authoritative balance, append-only immutable ledger,
 * server-side pagination, direction/type filters, and intentional refresh.
 * 
 * Features:
 * - Immediate clearing of stale transaction records upon filter/page transition.
 * - Persistent ledger loading indicator across all queries, including manual refresh.
 * - Independent request ID tracking for wallet summary and transaction queries.
 * - React StrictMode duplicate request prevention via ref-based initialization and filter tracking.
 * - Strict numeric validation guarding against whitespace-to-zero coercion.
 * - Preserves last-verified wallet balance during ledger sync failures.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import walletService from '../services/walletService.js';

// Verified backend transaction types matching server/src/models/WalletTransaction.js exactly
const TRANSACTION_TYPE_MAP = {
  LEVEL_REWARD: { label: 'Level Clear Reward', icon: '🏁' },
  GOLDEN_APPLE_REWARD: { label: 'Golden Apple Bonus', icon: '🍏' },
  STAR_BONUS: { label: 'Star Milestone Bonus', icon: '⭐' },
  DAILY_REWARD: { label: 'Daily Login Reward', icon: '📅' },
  AD_REWARD: { label: 'Rewarded Ad Bonus', icon: '📺' },
  ACHIEVEMENT_REWARD: { label: 'Achievement Reward', icon: '🏆' },
  STREAK_MILESTONE_REWARD: { label: 'Streak Milestone Bonus', icon: '🔥' },
  HINT_PURCHASE: { label: 'Hint Purchase', icon: '💡' },
  UNDO_PURCHASE: { label: 'Undo Purchase', icon: '↩️' },
  BOOSTER_PURCHASE: { label: 'Booster Purchase', icon: '⚡' },
  REVIVE_REWARD: { label: 'Revive Opportunity', icon: '💖' },
  BONUS: { label: 'Bonus Coins', icon: '🎁' },
  REVERSAL: { label: 'Ledger Reversal', icon: '🔄' },
};

/**
 * Safely resolves transaction display configuration even if an unrecognized
 * or newly added backend type is encountered in the database.
 */
function getTransactionTypeConfig(type) {
  if (type && TRANSACTION_TYPE_MAP[type]) {
    return TRANSACTION_TYPE_MAP[type];
  }
  const safeLabel =
    typeof type === 'string' && type.trim().length > 0
      ? type
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/\b\w/g, (char) => char.toUpperCase())
      : 'Transaction';
  return {
    label: safeLabel,
    icon: '🪙',
  };
}

/**
 * Safely formats a numeric amount or balance.
 * Returns formatted locale string for valid numbers (including legitimate 0).
 * Returns '—' for missing, null, undefined, empty strings, whitespace-only strings,
 * booleans, NaN, or non-finite values (prevents whitespace coercion to 0).
 */
function formatNumericValue(val) {
  if (val === null || val === undefined || typeof val === 'boolean') {
    return '—';
  }
  if (typeof val === 'string' && val.trim().length === 0) {
    return '—';
  }
  const num = Number(val);
  if (!Number.isFinite(num)) {
    return '—';
  }
  return num.toLocaleString();
}

export function WalletPage({ onNavigate }) {
  const { refreshUser } = useAuth();
  const { updateBalance } = useWallet();

  const updateBalanceRef = useRef(updateBalance);
  useEffect(() => {
    updateBalanceRef.current = updateBalance;
  }, [updateBalance]);

  // Decouple refreshUser from effect dependencies using a mutable ref
  const refreshUserRef = useRef(refreshUser);
  useEffect(() => {
    refreshUserRef.current = refreshUser;
  }, [refreshUser]);

  // Authoritative Wallet & Ledger State
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  // Filter States
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Independent Loading States
  const [isWalletLoading, setIsWalletLoading] = useState(true);
  const [isTxLoading, setIsTxLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Independent Error States
  const [walletErrorMessage, setWalletErrorMessage] = useState(null);
  const [txErrorMessage, setTxErrorMessage] = useState(null);

  // Independent Concurrency Tracking References
  const activeWalletRequestIdRef = useRef(0);
  const activeTxRequestIdRef = useRef(0);

  // StrictMode & Mount Lifecycle Tracking References
  const isMountedRef = useRef(true);
  const hasInitiatedInitialLoadRef = useRef(false);
  const prevFilterRef = useRef({ direction: 'ALL', type: 'ALL' });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Fetches authoritative wallet summary.
   * Concurrency protected by activeWalletRequestIdRef.
   * Preserves previous valid wallet state on error.
   */
  const loadWalletSummary = useCallback(async (isManual = false) => {
    const reqId = ++activeWalletRequestIdRef.current;

    if (isManual) {
      setIsRefreshing(true);
    } else {
      setIsWalletLoading(true);
    }
    setWalletErrorMessage(null);

    try {
      const res = await walletService.getWallet();

      if (!isMountedRef.current || reqId !== activeWalletRequestIdRef.current) {
        return;
      }

      setWallet(res.data);
      if (typeof res.data?.balance === 'number') {
        updateBalanceRef.current?.(res.data.balance);
      }

      // Background navbar badge sync via ref without circular callback dependency
      if (typeof refreshUserRef.current === 'function') {
        try {
          refreshUserRef.current().catch?.((profileErr) => {
            console.warn('Navbar profile coin sync warning:', profileErr?.message);
          });
        } catch (syncErr) {
          console.warn('Navbar profile coin sync warning:', syncErr?.message);
        }
      }
    } catch (err) {
      if (isMountedRef.current && reqId === activeWalletRequestIdRef.current) {
        // Preserves previous successfully verified wallet state if present
        setWalletErrorMessage(
          err.message || 'Unable to load wallet summary. Please check your connection and retry.'
        );
      }
    } finally {
      if (isMountedRef.current && reqId === activeWalletRequestIdRef.current) {
        setIsWalletLoading(false);
        if (isManual) {
          setIsRefreshing(false);
        }
      }
    }
  }, []);

  /**
   * Fetches ONLY transaction ledger data.
   * Immediately clears previous records and resets displayed pagination to prevent
   * stale records from masquerading as matching the new filter or page.
   * Concurrency protected by activeTxRequestIdRef.
   */
  const loadTransactions = useCallback(
    async (targetPage = 1, direction = directionFilter, type = typeFilter) => {
      const reqId = ++activeTxRequestIdRef.current;

      // Safe Stale-Data Prevention: Clear records and set target page immediately
      setTransactions([]);
      setPagination((prev) => ({
        ...prev,
        page: targetPage,
        total: 0,
        totalPages: 1,
      }));
      setIsTxLoading(true);
      setTxErrorMessage(null);

      try {
        const res = await walletService.getTransactions({
          page: targetPage,
          limit: 10,
          direction,
          type,
        });

        if (!isMountedRef.current || reqId !== activeTxRequestIdRef.current) {
          return;
        }

        setTransactions(Array.isArray(res.data) ? res.data : []);
        if (res.pagination) {
          setPagination({
            page: Number(res.pagination.page) || 1,
            limit: Number(res.pagination.limit) || 10,
            total: Number(res.pagination.total) || 0,
            totalPages: Math.max(1, Number(res.pagination.totalPages) || 1),
          });
        }
      } catch (err) {
        if (!isMountedRef.current || reqId !== activeTxRequestIdRef.current) {
          return;
        }
        // Ensure transactions remain cleared on error
        setTransactions([]);
        setTxErrorMessage(
          err.message || 'Unable to load transaction ledger. Please check your connection and retry.'
        );
      } finally {
        if (isMountedRef.current && reqId === activeTxRequestIdRef.current) {
          setIsTxLoading(false);
        }
      }
    },
    [directionFilter, typeFilter]
  );

  // 1. Initial Mount Effect: executes exactly once even during React StrictMode replay
  useEffect(() => {
    if (!hasInitiatedInitialLoadRef.current) {
      hasInitiatedInitialLoadRef.current = true;
      loadWalletSummary(false);
      loadTransactions(1, 'ALL', 'ALL');
    }
  }, [loadWalletSummary, loadTransactions]);

  // 2. Filter Change Effect: executes strictly when directionFilter or typeFilter values transition
  useEffect(() => {
    const prev = prevFilterRef.current;
    const hasChanged = prev.direction !== directionFilter || prev.type !== typeFilter;

    if (!hasChanged) {
      return;
    }

    prevFilterRef.current = { direction: directionFilter, type: typeFilter };
    loadTransactions(1, directionFilter, typeFilter);
  }, [directionFilter, typeFilter, loadTransactions]);

  // Pagination Handler: loads only transaction page
  const handlePageChange = (newPage) => {
    if (
      newPage < 1 ||
      newPage > pagination.totalPages ||
      newPage === pagination.page ||
      isTxLoading ||
      isRefreshing
    ) {
      return;
    }
    loadTransactions(newPage, directionFilter, typeFilter);
  };

  // Manual Refresh Handler: intentionally refreshes both summary and transactions once
  const handleManualRefresh = () => {
    if (isWalletLoading || isTxLoading || isRefreshing) return;
    loadWalletSummary(true);
    loadTransactions(pagination.page, directionFilter, typeFilter);
  };

  // Selective Retry Handler: only retries what failed
  const handleRetry = () => {
    if (walletErrorMessage || !wallet) {
      // Wallet summary failed or was never retrieved: retry both
      loadWalletSummary(false);
      loadTransactions(pagination.page, directionFilter, typeFilter);
    } else {
      // Wallet is already valid: retry transactions only
      loadTransactions(pagination.page, directionFilter, typeFilter);
    }
  };

  const handleResetFilters = () => {
    setDirectionFilter('ALL');
    setTypeFilter('ALL');
  };

  const handleTypeFilterChange = (newType) => {
    setTypeFilter(newType);
    if (newType !== 'ALL') {
      // Reconcile direction filter if it directly conflicts with the selected category
      if (newType === 'DAILY_REWARD' && directionFilter === 'DEBIT') {
        setDirectionFilter('ALL');
      } else if (['HINT_PURCHASE', 'UNDO_PURCHASE', 'BOOSTER_PURCHASE'].includes(newType) && directionFilter === 'CREDIT') {
        setDirectionFilter('ALL');
      } else if (
        ['LEVEL_REWARD', 'GOLDEN_APPLE_REWARD', 'STAR_BONUS', 'AD_REWARD', 'BONUS', 'ACHIEVEMENT_REWARD', 'STREAK_MILESTONE_REWARD'].includes(newType) &&
        directionFilter === 'DEBIT'
      ) {
        setDirectionFilter('ALL');
      }
    }
  };

  const handleDirectionFilterChange = (newDirection) => {
    setDirectionFilter(newDirection);
    // Reconcile category dropdown if the selected category directly contradicts the new direction
    if (
      newDirection === 'DEBIT' &&
      ['DAILY_REWARD', 'LEVEL_REWARD', 'GOLDEN_APPLE_REWARD', 'STAR_BONUS', 'AD_REWARD', 'BONUS', 'ACHIEVEMENT_REWARD', 'STREAK_MILESTONE_REWARD'].includes(typeFilter)
    ) {
      setTypeFilter('ALL');
    } else if (newDirection === 'CREDIT' && ['HINT_PURCHASE', 'UNDO_PURCHASE', 'BOOSTER_PURCHASE'].includes(typeFilter)) {
      setTypeFilter('ALL');
    }
  };

  const formatDateTime = (isoDateString) => {
    if (!isoDateString) return '—';
    try {
      const date = new Date(isoDateString);
      if (isNaN(date.getTime())) return String(isoDateString);
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_e) {
      return String(isoDateString);
    }
  };

  const currency = wallet?.currency || 'COIN';
  const lastUpdated = wallet?.updatedAt
    ? formatDateTime(wallet.updatedAt)
    : isWalletLoading
    ? 'Checking...'
    : 'Unavailable';

  // Strict validation of authoritative balance (whitespace strings do NOT coerce to 0)
  const isBalanceValid =
    wallet !== null &&
    wallet !== undefined &&
    wallet.balance !== null &&
    wallet.balance !== undefined &&
    typeof wallet.balance !== 'boolean' &&
    !(typeof wallet.balance === 'string' && wallet.balance.trim().length === 0) &&
    Number.isFinite(Number(wallet.balance));

  let balanceDisplayNode = null;
  let balanceDenominationText = 'Coins Available';

  if (isWalletLoading && !wallet) {
    // Initial loading state: no verified balance retrieved yet
    balanceDisplayNode = <span style={{ opacity: 0.7, fontSize: '1.8rem' }}>Loading...</span>;
    balanceDenominationText = 'Verifying with server...';
  } else if (!isBalanceValid) {
    // Missing, null, empty, whitespace-only, invalid balance (never coerce to 0)
    balanceDisplayNode = <span style={{ color: 'var(--color-error)', fontSize: '2.4rem' }}>—</span>;
    balanceDenominationText = 'Balance Unavailable';
  } else {
    // Legitimate numeric balance present (legitimate numeric zero displays as "0")
    balanceDisplayNode = Number(wallet.balance).toLocaleString();
    if (walletErrorMessage) {
      balanceDenominationText = 'Last Verified Balance (Latest Sync Failed)';
    } else if (isRefreshing) {
      balanceDenominationText = 'Syncing balance with server...';
    } else {
      balanceDenominationText = 'Coins Available';
    }
  }

  // Determine account status strictly from verified backend data
  let accountStatusText = 'Checking...';
  let accountStatusClass = '';

  if (walletErrorMessage && !wallet) {
    accountStatusText = 'Verification Failed';
    accountStatusClass = 'status-inactive';
  } else if (walletErrorMessage && wallet) {
    accountStatusText = 'Sync Failed (Preserving Last Verified)';
    accountStatusClass = 'gold-text';
  } else if (isRefreshing) {
    accountStatusText = 'Syncing with Server...';
    accountStatusClass = '';
  } else if (wallet) {
    if (wallet.isActive === true) {
      accountStatusText = 'Active & Synced';
      accountStatusClass = 'status-active';
    } else if (wallet.isActive === false) {
      accountStatusText = 'Inactive';
      accountStatusClass = 'status-inactive';
    } else {
      // Neutral fallback when isActive boolean is not explicitly provided by backend
      accountStatusText = 'Wallet Data Retrieved';
      accountStatusClass = '';
    }
  } else {
    accountStatusText = 'Unavailable';
    accountStatusClass = 'status-inactive';
  }

  const combinedErrorMessage = walletErrorMessage || txErrorMessage;

  return (
    <div className="wallet-page-container">
      {/* Top Header & Breadcrumbs */}
      <div className="wallet-header">
        <button
          type="button"
          className="btn btn-secondary back-btn"
          onClick={() => onNavigate('HOME')}
          title="Return to Player Dashboard"
        >
          ← Back to Dashboard
        </button>

        <div className="wallet-header-actions">
          <button
            type="button"
            className="btn btn-secondary refresh-btn"
            onClick={handleManualRefresh}
            disabled={isWalletLoading || isTxLoading || isRefreshing}
            title="Refresh authoritative wallet balance and transaction ledger"
          >
            <span className={isRefreshing ? 'spin-icon' : ''} aria-hidden="true">🔄</span>
            <span>{isRefreshing ? 'Syncing...' : 'Refresh Wallet'}</span>
          </button>
        </div>
      </div>

      {/* Authoritative Balance Hero Card */}
      <section className="wallet-hero-card" aria-label="Authoritative Coin Balance">
        <div className="wallet-hero-content">
          <div className="wallet-badge-row">
            <span className="wallet-status-badge">Authoritative Ledger</span>
            <span className="wallet-currency-tag">{currency}</span>
            {walletErrorMessage && wallet && (
              <span
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--apple-red-light)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.2rem 0.65rem',
                  borderRadius: 'var(--radius-full)',
                  textTransform: 'uppercase',
                }}
              >
                Sync Failed
              </span>
            )}
          </div>

          <h1 className="wallet-title">VELoop Coin Wallet</h1>
          <p className="wallet-subtitle">
            Secure, append-only in-game economic ledger tracking all adventure rewards and transactions.
          </p>

          <div className="wallet-balance-display">
            <span className="balance-coin-icon" aria-hidden="true">🪙</span>
            <div className="balance-numeric-group">
              <span className="balance-amount">
                {balanceDisplayNode}
              </span>
              <span className="balance-denomination">{balanceDenominationText}</span>
            </div>
          </div>
        </div>

        <div className="wallet-hero-meta">
          <div className="wallet-meta-item">
            <span className="meta-label">Account Status:</span>
            <strong className={accountStatusClass}>
              {accountStatusText}
            </strong>
          </div>
          <div className="wallet-meta-item">
            <span className="meta-label">Last Ledger Update:</span>
            <span>{lastUpdated}</span>
          </div>
        </div>
      </section>

      {/* Error Alert State with Retry */}
      {combinedErrorMessage && (
        <div className="wallet-error-banner" role="alert">
          <div className="error-banner-content">
            <span className="error-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>{walletErrorMessage ? 'Wallet Sync Issue' : 'Ledger Sync Issue'}</strong>
              <p>{combinedErrorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-retry"
            onClick={handleRetry}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Ledger Section */}
      <section className="wallet-ledger-section" aria-label="Transaction Ledger History">
        <div className="ledger-section-header">
          <div className="ledger-title-group">
            <h2 className="section-title">Transaction History</h2>
            <span className="ledger-count-badge">
              {pagination.total} {pagination.total === 1 ? 'Record' : 'Records'}
            </span>
          </div>

          {/* Ledger Filter Bar */}
          <div className="ledger-filter-bar">
            {/* Direction Filter Pills */}
            <div className="direction-filter-pills" role="radiogroup" aria-label="Filter by Direction">
              <button
                type="button"
                className={`filter-pill ${directionFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => handleDirectionFilterChange('ALL')}
              >
                All
              </button>
              <button
                type="button"
                className={`filter-pill ${directionFilter === 'CREDIT' ? 'active' : ''}`}
                onClick={() => handleDirectionFilterChange('CREDIT')}
              >
                + Credits (Earned)
              </button>
              <button
                type="button"
                className={`filter-pill ${directionFilter === 'DEBIT' ? 'active' : ''}`}
                onClick={() => handleDirectionFilterChange('DEBIT')}
              >
                - Debits (Spent)
              </button>
            </div>

            {/* Transaction Type Dropdown Filter */}
            <div className="type-filter-group">
              <label htmlFor="tx-type-select" className="filter-label">
                Filter Type:
              </label>
              <select
                id="tx-type-select"
                className="filter-select"
                value={typeFilter}
                onChange={(e) => handleTypeFilterChange(e.target.value)}
              >
                <option value="ALL">All Categories</option>
                {Object.keys(TRANSACTION_TYPE_MAP).map((typeKey) => (
                  <option key={typeKey} value={typeKey}>
                    {TRANSACTION_TYPE_MAP[typeKey].icon} {TRANSACTION_TYPE_MAP[typeKey].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Ledger Container */}
        <div className="ledger-card">
          {isTxLoading ? (
            <div className="wallet-loading-state">
              <div className="loading-spinner" />
              <p>Retrieving authoritative ledger transactions...</p>
            </div>
          ) : txErrorMessage && transactions.length === 0 ? (
            <div className="wallet-empty-state">
              <span className="empty-icon" aria-hidden="true">⚠️</span>
              <h3>Ledger Unavailable</h3>
              <p>
                {txErrorMessage}
              </p>
              <button
                type="button"
                className="btn btn-secondary reset-filters-btn"
                onClick={() => loadTransactions(pagination.page, directionFilter, typeFilter)}
              >
                Retry Fetching Ledger
              </button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="wallet-empty-state">
              <span className="empty-icon" aria-hidden="true">📜</span>
              <h3>No Transactions Recorded</h3>
              <p>
                {directionFilter !== 'ALL' || typeFilter !== 'ALL'
                  ? 'No transactions match the selected filter criteria. Try resetting your filters.'
                  : 'Your transaction ledger is pristine! Complete puzzle levels, collect golden apples, or unlock bonuses to start earning VELoop coins.'}
              </p>
              {(directionFilter !== 'ALL' || typeFilter !== 'ALL') && (
                <button
                  type="button"
                  className="btn btn-secondary reset-filters-btn"
                  onClick={handleResetFilters}
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop & Tablet Table View */}
              <div className="ledger-table-responsive">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th scope="col">Date & Time</th>
                      <th scope="col">Category</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="text-right">Balance Change</th>
                      <th scope="col" className="text-right">Balance Before / After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const isCredit = tx.direction === 'CREDIT';
                      const isDebit = tx.direction === 'DEBIT';
                      const typeConfig = getTransactionTypeConfig(tx.type);
                      const formattedAmount = formatNumericValue(tx.amount);
                      const formattedBefore = formatNumericValue(tx.balanceBefore);
                      const formattedAfter = formatNumericValue(tx.balanceAfter);

                      return (
                        <tr key={tx._id || tx.id}>
                          {/* Date */}
                          <td className="tx-date-cell">
                            <span className="tx-date">{formatDateTime(tx.createdAt)}</span>
                          </td>

                          {/* Category Badge */}
                          <td>
                            <span
                              className={`tx-type-pill ${
                                isCredit ? 'pill-credit' : isDebit ? 'pill-debit' : 'pill-neutral'
                              }`}
                            >
                              <span className="pill-icon" aria-hidden="true">
                                {typeConfig.icon}
                              </span>
                              <span className="pill-text">{typeConfig.label}</span>
                            </span>
                          </td>

                          {/* Description */}
                          <td className="tx-desc-cell">
                            <span className="tx-description">
                              {tx.description && !['Coin credit', 'Coin debit'].includes(tx.description.trim())
                                ? tx.description
                                : typeConfig.label || tx.description || 'Transaction'}
                            </span>
                            {tx.referenceId && (
                              <span className="tx-reference" title={`Reference ID: ${tx.referenceId}`}>
                                Ref: {String(tx.referenceId).slice(-8)}
                              </span>
                            )}
                          </td>

                          {/* Amount with Direction Indicator (Never shows false 0) */}
                          <td
                            className={`tx-amount-cell text-right ${
                              isCredit ? 'credit-val' : isDebit ? 'debit-val' : ''
                            }`}
                          >
                            {formattedAmount !== '—' ? (
                              <strong>
                                {isCredit ? '+' : isDebit ? '-' : ''}
                                {formattedAmount} 🪙
                              </strong>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          {/* Balance Before -> After (Preserves legitimate 0, shows — for missing) */}
                          <td className="tx-balances-cell text-right">
                            <span className="balance-before">{formattedBefore}</span>
                            <span className="balance-arrow"> → </span>
                            <span className="balance-after">{formattedAfter}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View (Activated automatically via CSS) */}
              <div className="ledger-cards-mobile">
                {transactions.map((tx) => {
                  const isCredit = tx.direction === 'CREDIT';
                  const isDebit = tx.direction === 'DEBIT';
                  const typeConfig = getTransactionTypeConfig(tx.type);
                  const formattedAmount = formatNumericValue(tx.amount);
                  const formattedBefore = formatNumericValue(tx.balanceBefore);
                  const formattedAfter = formatNumericValue(tx.balanceAfter);

                  return (
                    <div key={tx._id || tx.id} className="tx-mobile-card">
                      <div className="tx-mobile-header">
                        <span
                          className={`tx-type-pill ${
                            isCredit ? 'pill-credit' : isDebit ? 'pill-debit' : 'pill-neutral'
                          }`}
                        >
                          <span className="pill-icon">{typeConfig.icon}</span>
                          <span className="pill-text">{typeConfig.label}</span>
                        </span>
                        {formattedAmount !== '—' ? (
                          <span
                            className={`tx-mobile-amount ${
                              isCredit ? 'credit-val' : isDebit ? 'debit-val' : ''
                            }`}
                          >
                            {isCredit ? '+' : isDebit ? '-' : ''}
                            {formattedAmount} 🪙
                          </span>
                        ) : (
                          <span className="tx-mobile-amount" style={{ color: 'var(--text-muted)' }}>
                            —
                          </span>
                        )}
                      </div>

                      <div className="tx-mobile-desc">
                        {tx.description && !['Coin credit', 'Coin debit'].includes(tx.description.trim())
                          ? tx.description
                          : typeConfig.label || tx.description || 'Transaction'}
                      </div>

                      <div className="tx-mobile-footer">
                        <span className="tx-mobile-date">{formatDateTime(tx.createdAt)}</span>
                        <div className="tx-mobile-balances">
                          <span>{formattedBefore}</span>
                          <span className="balance-arrow"> → </span>
                          <span className="balance-after-bold">{formattedAfter}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              {pagination.totalPages > 1 && (
                <div className="ledger-pagination-bar" aria-label="Transaction pagination">
                  <div className="pagination-info">
                    Showing Page <strong>{pagination.page}</strong> of{' '}
                    <strong>{pagination.totalPages}</strong> ({pagination.total} total)
                  </div>

                  <div className="pagination-nav-buttons">
                    <button
                      type="button"
                      className="btn btn-secondary pagination-btn"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page <= 1 || isTxLoading || isRefreshing}
                    >
                      ← Previous
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary pagination-btn"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages || isTxLoading || isRefreshing}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default WalletPage;