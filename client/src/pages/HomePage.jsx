/**
 * @file HomePage.jsx
 * @description Main dashboard displayed upon player authentication.
 * Features live progress metrics, level map navigator, and career statistics.
 */

import { useState, useEffect } from 'react';
import { GAME_CONFIG } from '../config/gameConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import levelService from '../services/levelService.js';

export function HomePage({ onNavigate }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadPlayerProgress() {
      try {
        const response = await levelService.getPlayerProgress();
        if (isMounted && response && response.success && response.data) {
          setProgress(response.data);
        }
      } catch (_err) {
        // Fallback to user profile if progress API query encounters issue
      } finally {
        if (isMounted) setIsLoadingProgress(false);
      }
    }
    loadPlayerProgress();
    return () => {
      isMounted = false;
    };
  }, []);

  const highestUnlocked = progress?.highestUnlockedLevel || user?.currentLevel || 1;
  const totalStars = progress?.totalStars ?? user?.totalStars ?? 0;
  const totalScore = progress?.totalScore ?? user?.totalScore ?? 0;
  const applesEaten = progress?.totalApplesEaten || 0;
  const coins = user?.coins || 0;

  return (
    <div className="home-container">
      {/* Welcome Banner */}
      <section className="hero-banner">
        <div className="hero-content">
          <span className="hero-badge">Adventure Ready</span>
          <h1 className="hero-title">
            Welcome back, <span className="highlight-text">{user?.username || 'Worm Explorer'}</span>!
          </h1>
          <p className="hero-description">
            Navigate tight labyrinths, munch crisp apples to lengthen your body, and slither into
            portals across 50 challenging puzzle levels!
          </p>

          <div className="hero-actions">
            {/* Accurately labeled navigation trigger */}
            <button
              type="button"
              className="btn btn-play-large"
              onClick={() => onNavigate('LEVELS')}
              title="Open the level map to select and play an unlocked puzzle"
            >
              <span className="btn-play-icon" aria-hidden="true">▶</span>
              <span className="btn-play-label">
                Select Level to Play
              </span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('LEVELS')}
            >
              Browse All Levels ({highestUnlocked}/{GAME_CONFIG.maxLevel} Unlocked)
            </button>
          </div>
        </div>
      </section>

      {/* Real-time Player Stats */}
      <section className="stats-section" aria-label="Player Statistics">
        <h2 className="section-title">Player Career Stats</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper gold">⭐</div>
            <div className="stat-details">
              <span className="stat-value">{isLoadingProgress ? '...' : totalStars}</span>
              <span className="stat-label">Total Stars Earned</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper green">🗺️</div>
            <div className="stat-details">
              <span className="stat-value">
                {isLoadingProgress ? '...' : `${highestUnlocked} / ${GAME_CONFIG.maxLevel}`}
              </span>
              <span className="stat-label">Highest Unlocked</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper yellow">🪙</div>
            <div className="stat-details">
              <span className="stat-value">{coins.toLocaleString()}</span>
              <span className="stat-label">Wallet Balance</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper red">🍎</div>
            <div className="stat-details">
              <span className="stat-value">{isLoadingProgress ? '...' : applesEaten}</span>
              <span className="stat-label">Apples Consumed</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper purple">🏆</div>
            <div className="stat-details">
              <span className="stat-value">{isLoadingProgress ? '...' : totalScore.toLocaleString()}</span>
              <span className="stat-label">Career High Score</span>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Hub Cards */}
      <section className="hubs-section" aria-label="Game Features">
        <h2 className="section-title">Game Portals</h2>
        <div className="hubs-grid">
          <div className="hub-card" onClick={() => onNavigate('LEVELS')}>
            <div className="hub-header">
              <span className="hub-icon">🗺️</span>
              <span className="badge badge-success">50 Levels</span>
            </div>
            <h3>Level Selection</h3>
            <p>50 progressive puzzles spanning 5 difficulty bands from Tutorial to Expert.</p>
            <span className="hub-link">Open Level Map →</span>
          </div>

          <div className="hub-card" onClick={() => onNavigate('WALLET')}>
            <div className="hub-header">
              <span className="hub-icon">💰</span>
              <span className="badge badge-pending">Milestone 5</span>
            </div>
            <h3>VELoop Wallet & Store</h3>
            <p>View your immutable transaction ledger, claim daily free coins, and inspect earnings.</p>
            <span className="hub-link">Inspect Wallet →</span>
          </div>

          <div className="hub-card" onClick={() => onNavigate('LEADERBOARD')}>
            <div className="hub-header">
              <span className="hub-icon">🏆</span>
              <span className="badge badge-pending">Milestone 6</span>
            </div>
            <h3>Global Leaderboards</h3>
            <p>Compare puzzle scores and star ratings with players across the VELoop platform.</p>
            <span className="hub-link">View Rankings →</span>
          </div>

          <div className="hub-card" onClick={() => onNavigate('ACHIEVEMENTS')}>
            <div className="hub-header">
              <span className="hub-icon">🎖️</span>
              <span className="badge badge-pending">Milestone 6</span>
            </div>
            <h3>Achievements</h3>
            <p>Unlock puzzle badges, completion milestones, and golden apple bonuses.</p>
            <span className="hub-link">Check Badges →</span>
          </div>
        </div>
      </section>

      {/* How to Play Guide */}
      <section className="guide-section">
        <h2 className="section-title">How to Play Apple Worm</h2>
        <div className="guide-card">
          <div className="guide-step">
            <span className="step-num">1</span>
            <h4>Slither Around</h4>
            <p>Use Arrow keys or WASD to guide your worm across the puzzle grid.</p>
          </div>
          <div className="guide-step">
            <span className="step-num">2</span>
            <h4>Eat to Grow</h4>
            <p>Munch apples to expand your segment count and bridge wide chasms.</p>
          </div>
          <div className="guide-step">
            <span className="step-num">3</span>
            <h4>Mind the Physics</h4>
            <p>Watch out for gravity! Without ground underneath, your worm will tumble.</p>
          </div>
          <div className="guide-step">
            <span className="step-num">4</span>
            <h4>Reach the Portal</h4>
            <p>Navigate your head into the swirling portal to complete the level.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default HomePage;