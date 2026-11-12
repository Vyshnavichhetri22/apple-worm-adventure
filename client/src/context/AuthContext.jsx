/**
 * @file AuthContext.jsx
 * @description Authentication context provider managing user profile,
 * JWT tokens, localStorage synchronization, and startup session recovery.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import authService from '../services/authService.js';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(api.getTokenKey()));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const initialCheckPerformed = useRef(false);

  /**
   * Verifies an existing token and restores user session on startup.
   */
  const restoreSession = useCallback(async () => {
    const storedToken = localStorage.getItem(api.getTokenKey());
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await authService.getMe();
      if (response && response.success && response.user) {
        setUser(response.user);
        setToken(storedToken);
      } else {
        throw new Error('Session invalid');
      }
    } catch (_err) {
      // Clear token if expired or revoked
      localStorage.removeItem(api.getTokenKey());
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialCheckPerformed.current) {
      initialCheckPerformed.current = true;
      restoreSession();
    }
  }, [restoreSession]);

  /**
   * Logs in a user, stores the JWT, and loads profile.
   */
  const login = async (email, password) => {
    setError(null);
    try {
      const response = await authService.login({ email, password });
      if (response && response.success && response.token && response.user) {
        localStorage.setItem(api.getTokenKey(), response.token);
        setToken(response.token);
        setUser(response.user);
        return { success: true };
      }
      throw new Error(response.message || 'Login failed.');
    } catch (err) {
      setError(err.message || 'Login failed.');
      throw err;
    }
  };

  /**
   * Registers a new user account, stores the JWT, and logs them in.
   */
  const register = async (username, email, password) => {
    setError(null);
    try {
      const response = await authService.register({ username, email, password });
      if (response && response.success && response.token && response.user) {
        localStorage.setItem(api.getTokenKey(), response.token);
        setToken(response.token);
        setUser(response.user);
        return { success: true };
      }
      throw new Error(response.message || 'Registration failed.');
    } catch (err) {
      setError(err.message || 'Registration failed.');
      throw err;
    }
  };

  /**
   * Clears session and removes token.
   */
  const logout = () => {
    localStorage.removeItem(api.getTokenKey());
    setUser(null);
    setToken(null);
    setError(null);
  };

  /**
   * Refreshes the user profile from the server.
   */
  const refreshUser = async () => {
    try {
      const response = await authService.getMe();
      if (response && response.success && response.user) {
        setUser(response.user);
      }
    } catch (_err) {
      // Ignore background refresh errors
    }
  };

  const value = {
    user,
    token,
    isAuthenticated: Boolean(user && token),
    isLoading,
    error,
    login,
    register,
    logout,
    refreshUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;