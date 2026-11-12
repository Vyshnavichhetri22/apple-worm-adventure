/**
 * @file AuthPage.jsx
 * @description Player authentication screen providing tabbed login
 * and registration forms with client validation and error feedback.
 */

import { useState } from 'react';
import { GAME_NAME } from '../config/gameConfig.js';
import { useAuth } from '../context/AuthContext.jsx';

export function AuthPage() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [validationError, setValidationError] = useState('');
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setValidationError('');
    setServerError('');
  };

  const handleModeSwitch = (newMode) => {
    setMode(newMode);
    setValidationError('');
    setServerError('');
    setFormData({
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    });
  };

  const validateForm = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.email.trim()) {
      return 'Email address is required.';
    }
    if (!emailRegex.test(formData.email.trim())) {
      return 'Please enter a valid email address.';
    }

    if (!formData.password) {
      return 'Password is required.';
    }
    if (formData.password.length < 6) {
      return 'Password must be at least 6 characters long.';
    }

    if (mode === 'register') {
      const trimmedUser = formData.username.trim();
      if (!trimmedUser) {
        return 'Username is required.';
      }
      if (trimmedUser.length < 3) {
        return 'Username must be at least 3 characters long.';
      }
      if (trimmedUser.length > 30) {
        return 'Username cannot exceed 30 characters.';
      }

      if (formData.password !== formData.confirmPassword) {
        return 'Passwords do not match.';
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const errorMsg = validateForm();
    if (errorMsg) {
      setValidationError(errorMsg);
      return;
    }

    setIsSubmitting(true);
    setServerError('');

    try {
      if (mode === 'login') {
        await login(formData.email.trim(), formData.password);
      } else {
        await register(
          formData.username.trim(),
          formData.email.trim(),
          formData.password
        );
      }
    } catch (err) {
      setServerError(err.message || 'Authentication request failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        {/* Brand Banner */}
        <div className="auth-header">
          <div className="auth-logo-badge">
            <span className="logo-worm">🐛</span>
            <span className="logo-apple">🍎</span>
          </div>
          <h1 className="auth-title">{GAME_NAME}</h1>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Welcome back! Sign in to continue your adventure.'
              : 'Create your player profile and start solving puzzles.'}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('register')}
          >
            Create Account
          </button>
        </div>

        {/* Alert Notifications */}
        {(validationError || serverError) && (
          <div className="alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <span>{validationError || serverError}</span>
          </div>
        )}

        {/* Authentication Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="PuzzleMaster"
                value={formData.username}
                onChange={handleInputChange}
                disabled={isSubmitting}
                maxLength={30}
              />
              <span className="form-hint">3–30 characters, alphanumeric</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="player@example.com"
              value={formData.email}
              onChange={handleInputChange}
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              value={formData.password}
              onChange={handleInputChange}
              disabled={isSubmitting}
            />
            {mode === 'register' && (
              <span className="form-hint">Minimum 6 characters</span>
            )}
          </div>

          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="auth-confirm-password">Confirm Password</label>
              <input
                id="auth-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                disabled={isSubmitting}
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block submit-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="spinner-text">
                <span className="spinner-dot"></span> Processing...
              </span>
            ) : mode === 'login' ? (
              'Sign In to Play'
            ) : (
              'Register Player'
            )}
          </button>
        </form>

        {/* Footer switch prompt */}
        <div className="auth-footer">
          {mode === 'login' ? (
            <p>
              Don't have an account?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleModeSwitch('register')}
              >
                Create one now
              </button>
            </p>
          ) : (
            <p>
              Already registered?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleModeSwitch('login')}
              >
                Sign in here
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthPage;