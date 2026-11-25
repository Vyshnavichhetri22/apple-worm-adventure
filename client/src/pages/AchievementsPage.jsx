/**
 * @file AchievementsPage.jsx
 * @description Dedicated Player Achievements & Badges Showcase for Apple Worm Adventure.
 * Authoritatively tracks 10 distinct gameplay achievements, monitors progress percentages,
 * and allows players to claim one-time coin rewards with instant wallet balance synchronization.
 */

import React, { useState, useEffect, useCallback } from 'react';
import achievementService from '../services/achievementService.js';
import { useWallet } from '../context/WalletContext.jsx';

export function AchievementsPage({ onNavigate }) {
  const [achievements, setAchievements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [claimSuccessNotification, setClaimSuccessNotification] = useState(null);
  const [filter, setFilter] = useState('ALL'); // 'ALL', 'UNLOCKED', 'LOCKED', 'CLAIMED'

  const { updateBalance, refreshWallet } = useWallet();

  const loadAchievements = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await achievementService.getAchievements();
      if (response && response.success && Array.isArray(response.achievements)) {
        setAchievements(response.achievements);
      } else {
        setErrorMessage('Failed to load achievements from server.');
      }
    } catch (err) {
      console.error('Failed to load achievements:', err);
      setErrorMessage(err.message || 'Unable to retrieve achievements.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAchievements();
  }, [loadAchievements]);

  const handleClaim = async (achievement) => {
    if (claimingId || achievement.claimed || !achievement.unlocked) return;

    setClaimingId(achievement.id);
    setClaimSuccessNotification(null);

    try {
      const response = await achievementService.claimAchievement(achievement.id);
      if (response && response.success) {
        // Optimistically mark achievement as claimed in local state
        setAchievements((prev) =>
          prev.map((item) =>
            item.id === achievement.id
              ? { ...item, claimed: true, claimedAt: new Date().toISOString() }
              : item
          )
        );

        // Synchronize wallet balance
        if (response.wallet?.balance !== undefined) {
          updateBalance(response.wallet.balance);
        } else {
          refreshWallet();
        }

        setClaimSuccessNotification({
          title: achievement.title,
          coins: response.rewardCoins || achievement.rewardCoins,
          icon: achievement.icon,
        });

        setTimeout(() => {
          setClaimSuccessNotification(null);
        }, 5000);
      } else {
        alert(response?.message || 'Failed to claim achievement reward.');
      }
    } catch (err) {
      console.error('Achievement claim error:', err);
      alert(err.message || 'Failed to claim reward. Please try again.');
    } finally {
      setClaimingId(null);
    }
  };

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const claimedCount = achievements.filter((a) => a.claimed).length;
  const unclaimedUnlockedCount = achievements.filter((a) => a.unlocked && !a.claimed).length;
  const totalCoinsAvailable = achievements.reduce(
    (sum, a) => sum + (a.unlocked && !a.claimed ? a.rewardCoins : 0),
    0
  );

  const filteredAchievements = achievements.filter((a) => {
    if (filter === 'UNLOCKED') return a.unlocked && !a.claimed;
    if (filter === 'CLAIMED') return a.claimed;
    if (filter === 'LOCKED') return !a.unlocked;
    return true;
  });

  return (
    <div className="achievements-page-container">
      {/* Page Header */}
      <div className="achievements-header">
        <div className="header-nav">
          <button
            type="button"
            className="btn btn-secondary back-btn"
            onClick={() => onNavigate('HOME')}
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="achievements-title-section">
          <div className="achievements-icon">🎖️</div>
          <h1 className="achievements-title">Player Achievements</h1>
          <p className="achievements-subtitle">
            Conquer tricky challenges, grow longer worms, and claim VELoop Coin rewards
          </p>
        </div>

        {/* Global Progress Overview Banner */}
        <div className="achievements-summary-banner">
          <div className="summary-col">
            <span className="summary-label">Badges Unlocked</span>
            <span className="summary-val highlight">
              {unlockedCount} / {achievements.length || 10}
            </span>
          </div>
          <div className="summary-col">
            <span className="summary-label">Rewards Claimed</span>
            <span className="summary-val">{claimedCount}</span>
          </div>
          <div className="summary-col">
            <span className="summary-label">Claimable Coins</span>
            <span className="summary-val gold">
              +{totalCoinsAvailable} 🪙
            </span>
          </div>
          <div className="summary-col progress-col">
            <span className="summary-label">Mastery Progress</span>
            <div className="summary-progress-bar">
              <div
                className="summary-progress-fill"
                style={{
                  width: `${achievements.length > 0 ? (unlockedCount / achievements.length) * 100 : 0}%`,
                }}
              ></div>
            </div>
          </div>
        </div>

        {/* Filter Navigation */}
        <div className="achievements-filters" role="tablist" aria-label="Achievement Filters">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'ALL'}
            className={`filter-btn ${filter === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            All ({achievements.length || 10})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'UNLOCKED'}
            className={`filter-btn ${filter === 'UNLOCKED' ? 'active' : ''}`}
            onClick={() => setFilter('UNLOCKED')}
          >
            Ready to Claim ({unclaimedUnlockedCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'LOCKED'}
            className={`filter-btn ${filter === 'LOCKED' ? 'active' : ''}`}
            onClick={() => setFilter('LOCKED')}
          >
            In Progress ({achievements.length - unlockedCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'CLAIMED'}
            className={`filter-btn ${filter === 'CLAIMED' ? 'active' : ''}`}
            onClick={() => setFilter('CLAIMED')}
          >
            Claimed ({claimedCount})
          </button>
        </div>
      </div>

      {/* Claim Success Notification */}
      {claimSuccessNotification && (
        <div className="claim-notification-banner" role="alert">
          <span className="notification-icon">{claimSuccessNotification.icon}</span>
          <div className="notification-text">
            <strong>Reward Claimed!</strong>
            <p>
              Received +{claimSuccessNotification.coins} Coins for unlocking{' '}
              <em>{claimSuccessNotification.title}</em>.
            </p>
          </div>
        </div>
      )}

      {/* Achievement Cards Grid */}
      <div className="achievements-content">
        {isLoading ? (
          <div className="achievements-loading">
            <div className="loading-spinner" aria-hidden="true"></div>
            <p>Loading achievements and tracking progress...</p>
          </div>
        ) : errorMessage ? (
          <div className="achievements-error">
            <span className="error-icon">⚠️</span>
            <p>{errorMessage}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={loadAchievements}
            >
              Try Again
            </button>
          </div>
        ) : filteredAchievements.length === 0 ? (
          <div className="achievements-empty">
            <p>No achievements match this filter.</p>
          </div>
        ) : (
          <div className="achievements-grid">
            {filteredAchievements.map((achievement) => {
              const isClaimed = achievement.claimed;
              const isUnlocked = achievement.unlocked;
              const isReadyToClaim = isUnlocked && !isClaimed;
              const percentage = achievement.percentage || 0;
              const isClaiming = claimingId === achievement.id;

              return (
                <div
                  key={achievement.id}
                  className={`achievement-card ${
                    isClaimed ? 'claimed' : isUnlocked ? 'unlocked' : 'locked'
                  }`}
                >
                  <div className="card-top">
                    <div className="achievement-icon-wrapper" aria-hidden="true">
                      {achievement.icon}
                    </div>

                    <div className="achievement-reward-badge" title="Coin Reward">
                      <span>+{achievement.rewardCoins}</span>
                      <span className="coin-emoji">🪙</span>
                    </div>
                  </div>

                  <div className="card-body">
                    <h3 className="achievement-title">{achievement.title}</h3>
                    <p className="achievement-description">{achievement.description}</p>

                    {/* Progress Bar & Indicators */}
                    <div className="achievement-progress-section">
                      <div className="progress-labels">
                        <span className="progress-count">
                          {achievement.progress} / {achievement.target}
                        </span>
                        <span className="progress-percent">{percentage}%</span>
                      </div>
                      <div className="achievement-progress-track">
                        <div
                          className={`achievement-progress-fill ${
                            isUnlocked ? 'complete' : ''
                          }`}
                          style={{ width: `${Math.min(100, percentage)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  <div className="card-actions">
                    {isClaimed ? (
                      <span className="badge-claimed">
                        Claimed ✓
                      </span>
                    ) : isReadyToClaim ? (
                      <button
                        type="button"
                        className="btn btn-claim"
                        disabled={isClaiming}
                        onClick={() => handleClaim(achievement)}
                      >
                        {isClaiming ? 'Claiming...' : `Claim +${achievement.rewardCoins} Coins`}
                      </button>
                    ) : (
                      <span className="badge-locked">
                        🔒 Locked
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default AchievementsPage;
