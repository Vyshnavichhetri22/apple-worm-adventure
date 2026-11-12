/**
 * @file Navbar.jsx
 * @description Global game header navigation bar displaying game branding,
 * user identification, live coin balance, and navigation buttons.
 */

import { GAME_NAME } from '../../config/gameConfig.js';
import { useAuth } from '../../context/AuthContext.jsx';

export function Navbar({ currentScreen, onNavigate }) {
  const { user, logout } = useAuth();

  const coins = user && typeof user.coins === 'number' ? user.coins : 0;
  const username = user?.username || 'Player';
  const role = user?.role || 'player';

  return (
    <header className="navbar">
      <div className="navbar-container">
        {/* Brand / Logo */}
        <div 
          className="navbar-brand" 
          onClick={() => onNavigate('HOME')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onNavigate('HOME')}
        >
          <span className="brand-worm-icon" aria-hidden="true">🐛</span>
          <span className="brand-title">{GAME_NAME}</span>
        </div>

        {/* Navigation Items */}
        <nav className="navbar-nav" aria-label="Game Navigation">
          <button
            type="button"
            className={`nav-btn ${currentScreen === 'HOME' ? 'active' : ''}`}
            onClick={() => onNavigate('HOME')}
          >
            🏠 Home
          </button>
          <button
            type="button"
            className={`nav-btn ${currentScreen === 'LEVELS' ? 'active' : ''}`}
            onClick={() => onNavigate('LEVELS')}
          >
            🗺️ Levels
          </button>
          <button
            type="button"
            className={`nav-btn ${currentScreen === 'WALLET' ? 'active' : ''}`}
            onClick={() => onNavigate('WALLET')}
          >
            💰 Wallet
          </button>
          <button
            type="button"
            className={`nav-btn ${currentScreen === 'LEADERBOARD' ? 'active' : ''}`}
            onClick={() => onNavigate('LEADERBOARD')}
          >
            🏆 Rankings
          </button>
          {role === 'admin' && (
            <button
              type="button"
              className={`nav-btn admin-btn ${currentScreen === 'ADMIN' ? 'active' : ''}`}
              onClick={() => onNavigate('ADMIN')}
            >
              ⚙️ Admin
            </button>
          )}
        </nav>

        {/* User Profile & Wallet Widget */}
        <div className="navbar-user">
          <div className="coin-badge" title="VELoop Coins">
            <span className="coin-icon" aria-hidden="true">🪙</span>
            <span className="coin-amount">{coins.toLocaleString()}</span>
          </div>

          <div className="user-profile">
            <span className="user-avatar" aria-hidden="true">👤</span>
            <span className="user-name">{username}</span>
            {role === 'admin' && <span className="admin-tag">ADMIN</span>}
          </div>

          <button
            type="button"
            className="btn btn-secondary logout-btn"
            onClick={logout}
            title="Sign out of your account"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;