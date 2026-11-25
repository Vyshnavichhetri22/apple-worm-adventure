/**
 * @file WalletContext.jsx
 * @description Centralized wallet context provider managing authoritative VELoop Coin
 * balance across the application (Navbar, GamePlay, Wallet page, Dashboard).
 *
 * Ensures instant, reactive synchronization following any confirmed server-side
 * transaction (earnings, purchases, rewards, refetches) without requiring page reloads.
 * Hardened against:
 *   - In-flight requests returning after logout (discarded without state corruption)
 *   - Cross-account balance leakage during account switching (immediate state reset)
 *   - Stale out-of-order network responses (monotonic request id tracking)
 *   - Session restoration and authentication lifecycle transitions
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext.jsx';
import walletService from '../services/walletService.js';

const WalletContext = createContext(null);

/**
 * Safely resolves unique user identifier from user object.
 */
function resolveUserId(user) {
  if (!user) return null;
  return user._id || user.id || user.username || null;
}

export function WalletProvider({ children }) {
  const { user, isAuthenticated, updateUserCoins } = useAuth();

  const [balance, setBalanceState] = useState(() => {
    return isAuthenticated && user && typeof user.coins === 'number' && Number.isFinite(user.coins)
      ? user.coins
      : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const activeRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const currentUserIdRef = useRef(resolveUserId(user));
  const lastActiveUserIdRef = useRef(isAuthenticated ? resolveUserId(user) : null);
  const updateUserCoinsRef = useRef(updateUserCoins);

  // Synchronize mutable refs on every render
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
    currentUserIdRef.current = resolveUserId(user);
    updateUserCoinsRef.current = updateUserCoins;
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestIdRef.current++;
    };
  }, []);

  /**
   * Directly updates authoritative wallet balance from a confirmed server response
   * (e.g. from completeSession or purchaseItem), keeping both WalletContext and AuthContext in sync.
   * Increments activeRequestIdRef to invalidate older in-flight reads that might overwrite this balance.
   */
  const updateBalance = useCallback((newBalance) => {
    if (newBalance !== null && newBalance !== undefined && Number.isFinite(Number(newBalance))) {
      const numericVal = Number(newBalance);
      activeRequestIdRef.current++;
      setBalanceState(numericVal);
      setError(null);
      if (isAuthenticatedRef.current && typeof updateUserCoinsRef.current === 'function') {
        updateUserCoinsRef.current(numericVal);
      }
    }
  }, []);

  /**
   * Refreshes the authoritative wallet balance from GET /api/wallet.
   * Concurrency-protected against out-of-order network responses,
   * post-logout execution, and cross-account leakage.
   */
  const refreshWallet = useCallback(async () => {
    if (!isAuthenticatedRef.current) {
      return null;
    }

    const targetUserId = currentUserIdRef.current;
    const reqId = ++activeRequestIdRef.current;
    setIsLoading(true);

    try {
      const res = await walletService.getWallet();

      // Guard: Discard if unmounted, superseded by newer request, logged out, or account switched
      if (
        !isMountedRef.current ||
        reqId !== activeRequestIdRef.current ||
        !isAuthenticatedRef.current ||
        targetUserId !== currentUserIdRef.current
      ) {
        return null;
      }

      const verifiedBalance = res?.data?.balance ?? res?.balance;
      if (verifiedBalance !== undefined && Number.isFinite(Number(verifiedBalance))) {
        const numericVal = Number(verifiedBalance);
        setBalanceState(numericVal);
        setError(null);
        if (typeof updateUserCoinsRef.current === 'function') {
          updateUserCoinsRef.current(numericVal);
        }
        return numericVal;
      } else {
        throw new Error('Malformed wallet response from server.');
      }
    } catch (err) {
      if (
        isMountedRef.current &&
        reqId === activeRequestIdRef.current &&
        isAuthenticatedRef.current &&
        targetUserId === currentUserIdRef.current
      ) {
        setError(err.message || 'Failed to sync wallet balance.');
      }
      throw err;
    } finally {
      if (isMountedRef.current && reqId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Sync or reset balance when authentication status or account transitions
  useEffect(() => {
    const activeId = resolveUserId(user);

    if (isAuthenticated && activeId) {
      const isAccountSwitch = lastActiveUserIdRef.current !== null && lastActiveUserIdRef.current !== activeId;

      if (isAccountSwitch) {
        // Invalidate in-flight requests from prior user immediately
        activeRequestIdRef.current++;
        // Reset balance immediately to new user profile balance or null to prevent cross-account display leakage
        const initialCoins = typeof user?.coins === 'number' && Number.isFinite(user.coins) ? user.coins : null;
        setBalanceState(initialCoins);
        setError(null);
      } else if (lastActiveUserIdRef.current === null) {
        // Initial login or session restore: populate initial coins if available
        if (typeof user?.coins === 'number' && Number.isFinite(user.coins)) {
          setBalanceState((prev) => (prev === null ? user.coins : prev));
        }
      }

      lastActiveUserIdRef.current = activeId;

      refreshWallet().catch((err) => {
        if (isAuthenticatedRef.current && lastActiveUserIdRef.current === activeId) {
          console.warn('Initial wallet sync notice:', err?.message);
        }
      });
    } else {
      // User logged out or session expired
      activeRequestIdRef.current++;
      lastActiveUserIdRef.current = null;
      setBalanceState(null);
      setError(null);
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.username, user?._id, user?.id, refreshWallet]);

  const value = {
    balance,
    isLoading,
    error,
    refreshWallet,
    updateBalance,
    setBalance: updateBalance,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export default WalletContext;
