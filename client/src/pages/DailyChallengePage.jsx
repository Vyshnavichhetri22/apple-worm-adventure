/**
 * @file DailyChallengePage.jsx
 * @description Dedicated Daily Challenge & Streak view for Apple Worm Adventure.
 * Authoritatively previews today's UTC challenge puzzle, tracks consecutive completion
 * streaks, displays claimable milestone rewards, and launches daily challenge gameplay.
 */

import React, { useState, useEffect, useCallback } from 'react';
import dailyChallengeService from '../services/dailyChallengeService.js';
import { useWallet } from '../context/WalletContext.jsx';

export function DailyChallengePage({ onNavigate, onStartDailyChallenge }) {
  const [challengeData, setChallengeData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [claimingDays, setClaimingDays] = useState(null);
  const [claimNotification, setClaimNotification] = useState(null);

  const { updateBalance, refreshWallet } = useWallet();

  const loadDailyChallenge = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await dailyChallengeService.getTodayChallenge();
      if (response && response.success) {
        setChallengeData(response);
      } else {
        setErrorMessage('Failed to retrieve today\'s daily challenge.');
      }
    } catch (err) {
      console.error('Failed to load daily challenge:', err);
      setErrorMessage(err.message || 'Unable to connect to the challenge service.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDailyChallenge();
  }, [loadDailyChallenge]);

  const handleClaimMilestone = async (days) => {
    if (claimingDays) return;
    setClaimingDays(days);
    setClaimNotification(null);

    try {
      const response = await dailyChallengeService.claimStreakMilestone(days);
      if (response && response.success) {
        // Optimistically update local milestone status
        setChallengeData((prev) => {
          if (!prev) return prev;
          const updatedMilestones = (prev.streak?.milestones || []).map((m) =>
            m.days === days ? { ...m, claimed: true, canClaim: false } : m
          );
          return {
            ...prev,
            streak: {
              ...prev.streak,
              claimedMilestones: [...(prev.streak?.claimedMilestones || []), days],
              milestones: updatedMilestones,
            },
          };
        });

        // Sync wallet balance
        if (response.wallet?.balance !== undefined) {
          updateBalance(response.wallet.balance);
        } else {
          refreshWallet();
        }

        setClaimNotification({
          days,
          coins: response.rewardCoins,
        });

        setTimeout(() => setClaimNotification(null), 5000);
      } else {
        alert(response?.message || 'Failed to claim milestone reward.');
      }
    } catch (err) {
      console.error('Claim milestone error:', err);
      alert(err.message || 'Failed to claim milestone reward.');
    } finally {
      setClaimingDays(null);
    }
  };

  const streak = challengeData?.streak || {};
  const currentStreak = streak.currentStreak || 0;
  const longestStreak = streak.longestStreak || 0;
  const isCompleted = challengeData?.isCompleted || false;
  const level = challengeData?.level;
  const completion = challengeData?.completion;
  const milestones = streak.milestones || [];

  return (
    <div className="daily-challenge-page-container">
      {/* Header */}
      <div className="daily-challenge-header">
        <div className="header-nav">
          <button
            type="button"
            className="btn btn-secondary back-btn"
            onClick={() => onNavigate('HOME')}
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="daily-challenge-title-section">
          <div className="daily-challenge-icon">📅</div>
          <h1 className="daily-challenge-title">Daily Challenge & Streak</h1>
          <p className="daily-challenge-subtitle">
            Conquer today's puzzle to earn +150 Coins, build consecutive streaks, and unlock major milestone rewards!
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="challenge-loading-card">
          <div className="loading-spinner" aria-hidden="true"></div>
          <p>Fetching today's challenge puzzle and streak data...</p>
        </div>
      ) : errorMessage ? (
        <div className="challenge-error-card">
          <span className="error-icon">⚠️</span>
          <p>{errorMessage}</p>
          <button type="button" className="btn btn-primary" onClick={loadDailyChallenge}>
            Try Again
          </button>
        </div>
      ) : (
        <>
          {/* Claim Toast Notification */}
          {claimNotification && (
            <div className="claim-notification-banner" role="alert">
              <span className="notification-icon">🎉</span>
              <div className="notification-text">
                <strong>Milestone Reward Claimed!</strong>
                <p>
                  Claimed +{claimNotification.coins} Coins for reaching the {claimNotification.days}-day streak milestone!
                </p>
              </div>
            </div>
          )}

          {/* Streak Overview Banner */}
          <section className="streak-overview-banner" aria-label="Streak Overview">
            <div className="streak-stat-box current">
              <span className="streak-icon">🔥</span>
              <div className="streak-meta">
                <span className="streak-count">{currentStreak} {currentStreak === 1 ? 'Day' : 'Days'}</span>
                <span className="streak-label">Current Streak</span>
              </div>
            </div>

            <div className="streak-stat-box longest">
              <span className="streak-icon">⚡</span>
              <div className="streak-meta">
                <span className="streak-count">{longestStreak} {longestStreak === 1 ? 'Day' : 'Days'}</span>
                <span className="streak-label">Longest Streak</span>
              </div>
            </div>

            <div className="streak-stat-box status">
              <span className="streak-icon">{isCompleted ? '✅' : '⏳'}</span>
              <div className="streak-meta">
                <span className="streak-count status-text">
                  {isCompleted ? 'Completed Today' : 'Ready to Play'}
                </span>
                <span className="streak-label">
                  {challengeData.date} (UTC)
                </span>
              </div>
            </div>
          </section>

          {/* Today's Challenge Main Card */}
          <section className="today-challenge-card" aria-label="Today's Challenge">
            <div className="challenge-card-header">
              <div className="challenge-date-tag">
                <span>📅 Challenge Date: <strong>{challengeData.date}</strong> (UTC)</span>
              </div>
              <div className="challenge-reward-tag" title="Daily Completion Reward">
                <span>Reward: +{challengeData.rewardCoins}</span>
                <span className="coin-emoji">🪙</span>
              </div>
            </div>

            <div className="challenge-card-body">
              <div className="challenge-level-info">
                <div className="level-badge-row">
                  <span className="level-chip">Level {challengeData.levelNumber}</span>
                  <span className={`difficulty-badge ${level?.difficulty || 'medium'}`}>
                    {level?.difficulty || 'Medium'}
                  </span>
                </div>
                <h2 className="challenge-level-title">{level?.title || `Level ${challengeData.levelNumber}`}</h2>

                <div className="challenge-specs-grid">
                  <div className="spec-item">
                    <span className="spec-label">Grid Layout</span>
                    <span className="spec-val">
                      {level?.grid?.cols || 12} × {level?.grid?.rows || 10}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Move Limit</span>
                    <span className="spec-val">
                      {level?.moveLimit ? `${level.moveLimit} moves` : 'Unrestricted'}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Apples on Grid</span>
                    <span className="spec-val">🍎 {level?.applesCount || 0}</span>
                  </div>
                  {level?.keysCount > 0 && (
                    <div className="spec-item">
                      <span className="spec-label">Security Keys</span>
                      <span className="spec-val">🔑 {level.keysCount}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Completion summary if already completed */}
              {isCompleted && completion && (
                <div className="completion-summary-box">
                  <div className="summary-badge">✓ Puzzle Solved</div>
                  <div className="summary-metrics">
                    <span>Score: <strong>{completion.score}</strong></span>
                    <span>Moves: <strong>{completion.moves}</strong></span>
                    <span>Time: <strong>{completion.durationSeconds}s</strong></span>
                  </div>
                  <p className="summary-note">
                    +150 Coins credited to your wallet. You can replay to improve your time or score!
                  </p>
                </div>
              )}
            </div>

            <div className="challenge-card-footer">
              <button
                type="button"
                className={`btn btn-play-challenge ${isCompleted ? 'btn-replay' : 'btn-primary-large'}`}
                onClick={() => onStartDailyChallenge(challengeData.date)}
              >
                <span className="play-icon">▶</span>
                <span>{isCompleted ? 'Replay Challenge' : 'Play Today\'s Challenge'}</span>
              </button>
            </div>
          </section>

          {/* Streak Milestone Rewards Track */}
          <section className="milestones-section" aria-label="Streak Milestones">
            <div className="milestones-header">
              <h3 className="milestones-title">Streak Milestone Rewards</h3>
              <p className="milestones-subtitle">
                Maintain your consecutive daily streak to claim bonus coin caches!
              </p>
            </div>

            <div className="milestones-grid">
              {milestones.map((m) => {
                const isClaimed = m.claimed;
                const canClaim = m.canClaim;
                const isClaiming = claimingDays === m.days;
                const progressPct = Math.min(100, Math.round((currentStreak / m.days) * 100));

                return (
                  <div
                    key={m.days}
                    className={`milestone-card ${
                      isClaimed ? 'claimed' : canClaim ? 'unlocked' : 'locked'
                    }`}
                  >
                    <div className="milestone-top">
                      <span className="milestone-badge-icon" aria-hidden="true">{m.icon}</span>
                      <div className="milestone-coins">
                        <span>+{m.rewardCoins}</span>
                        <span className="coin-emoji">🪙</span>
                      </div>
                    </div>

                    <h4 className="milestone-name">{m.label}</h4>
                    <p className="milestone-desc">Complete {m.days} consecutive daily challenges.</p>

                    <div className="milestone-progress-bar">
                      <div
                        className="milestone-progress-fill"
                        style={{ width: `${progressPct}%` }}
                      ></div>
                    </div>
                    <span className="milestone-progress-text">
                      {Math.min(currentStreak, m.days)} / {m.days} Days ({progressPct}%)
                    </span>

                    <div className="milestone-actions">
                      {isClaimed ? (
                        <span className="badge-claimed">Claimed ✓</span>
                      ) : canClaim ? (
                        <button
                          type="button"
                          className="btn btn-claim-milestone"
                          disabled={isClaiming}
                          onClick={() => handleClaimMilestone(m.days)}
                        >
                          {isClaiming ? 'Claiming...' : `Claim +${m.rewardCoins} Coins`}
                        </button>
                      ) : (
                        <span className="badge-locked">
                          🔒 Locked ({m.days - currentStreak} days left)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Informational Guidelines Card */}
          <section className="challenge-rules-card" aria-label="Daily Rules">
            <h4>💡 How the Daily Challenge Works</h4>
            <ul>
              <li><strong>One Global Puzzle:</strong> Every player in the world receives the exact same daily challenge level for each UTC calendar day.</li>
              <li><strong>Independent Access:</strong> You can play today's challenge puzzle regardless of how many regular adventure levels you have completed.</li>
              <li><strong>Consecutive Streak:</strong> Completing the challenge on the next UTC calendar day advances your streak by 1. Missing a calendar day resets your streak to 1.</li>
              <li><strong>Daily Coin Reward:</strong> Earn +150 VELoop Coins on your first completion each day, with additional milestone bonuses at 3, 7, 14, and 30 days!</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

export default DailyChallengePage;
