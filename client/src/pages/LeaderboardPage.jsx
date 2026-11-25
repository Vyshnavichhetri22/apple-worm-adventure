/**
 * @file LeaderboardPage.jsx
 * @description Global server-backed Leaderboard for Apple Worm Adventure.
 * Authoritatively displays player rankings by High Score or Stars with pagination,
 * user highlight, and personal rank banner.
 */

import React, { useState, useEffect, useCallback } from 'react';
import leaderboardService from '../services/leaderboardService.js';
import { useAuth } from '../context/AuthContext.jsx';

export function LeaderboardPage({ onNavigate }) {
  const { user } = useAuth();
  const [metric, setMetric] = useState('totalScore');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await leaderboardService.getLeaderboard({
        metric,
        page,
        limit,
      });

      if (response && response.success) {
        setLeaderboardData(response);
      } else {
        setErrorMessage('Failed to load leaderboard data.');
      }
    } catch (err) {
      console.error('Leaderboard fetch error:', err);
      setErrorMessage(err.message || 'Unable to retrieve leaderboard rankings.');
    } finally {
      setIsLoading(false);
    }
  }, [metric, page, limit]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const handleMetricChange = (newMetric) => {
    if (newMetric !== metric) {
      setMetric(newMetric);
      setPage(1);
    }
  };

  const getRankBadge = (rank) => {
    if (rank === 1) return <span className="rank-badge gold" title="1st Place">🥇 1</span>;
    if (rank === 2) return <span className="rank-badge silver" title="2nd Place">🥈 2</span>;
    if (rank === 3) return <span className="rank-badge bronze" title="3rd Place">🥉 3</span>;
    return <span className="rank-badge standard">#{rank}</span>;
  };

  const myEntry = leaderboardData?.myEntry;
  const rankings = leaderboardData?.leaderboard || [];
  const totalPages = leaderboardData?.totalPages || 1;
  const totalPlayers = leaderboardData?.totalPlayers || 0;

  return (
    <div className="leaderboard-page-container">
      {/* Page Header */}
      <div className="leaderboard-header">
        <div className="header-nav">
          <button
            type="button"
            className="btn btn-secondary back-btn"
            onClick={() => onNavigate('HOME')}
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="leaderboard-title-section">
          <div className="leaderboard-icon">🏆</div>
          <h1 className="leaderboard-title">Global Leaderboard</h1>
          <p className="leaderboard-subtitle">
            Authoritative player rankings verified across all 50 puzzle levels
          </p>
        </div>

        {/* Metric Selector Tabs */}
        <div className="metric-tabs" role="tablist" aria-label="Ranking Metric">
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'totalScore'}
            className={`metric-tab ${metric === 'totalScore' ? 'active' : ''}`}
            onClick={() => handleMetricChange('totalScore')}
          >
            🏆 High Score
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'totalStars'}
            className={`metric-tab ${metric === 'totalStars' ? 'active' : ''}`}
            onClick={() => handleMetricChange('totalStars')}
          >
            ⭐ Total Stars
          </button>
        </div>
      </div>

      {/* Pinned User Rank Card */}
      {myEntry && (
        <section className="my-rank-banner" aria-label="Your Ranking">
          <div className="my-rank-content">
            <div className="my-rank-position">
              <span className="my-rank-label">Your Global Rank</span>
              <div className="my-rank-number">
                {getRankBadge(myEntry.rank)}
              </div>
            </div>

            <div className="my-rank-stats">
              <div className="my-stat-item">
                <span className="stat-label">Player</span>
                <span className="stat-val">{myEntry.username}</span>
              </div>
              <div className="my-stat-item">
                <span className="stat-label">Career Score</span>
                <span className="stat-val score-highlight">
                  {myEntry.totalScore.toLocaleString()}
                </span>
              </div>
              <div className="my-stat-item">
                <span className="stat-label">Stars Earned</span>
                <span className="stat-val stars-highlight">
                  ⭐ {myEntry.totalStars}
                </span>
              </div>
              <div className="my-stat-item">
                <span className="stat-label">Levels Cleared</span>
                <span className="stat-val">
                  {myEntry.completedLevelsCount} / 50
                </span>
              </div>
              <div className="my-stat-item">
                <span className="stat-label">Apples Munch</span>
                <span className="stat-val">
                  🍎 {myEntry.totalApplesEaten}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Leaderboard Table / Content */}
      <div className="leaderboard-table-card">
        {isLoading ? (
          <div className="leaderboard-loading">
            <div className="loading-spinner" aria-hidden="true"></div>
            <p>Retrieving authoritative leaderboard...</p>
          </div>
        ) : errorMessage ? (
          <div className="leaderboard-error">
            <span className="error-icon">⚠️</span>
            <p>{errorMessage}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={fetchLeaderboard}
            >
              Try Again
            </button>
          </div>
        ) : rankings.length === 0 ? (
          <div className="leaderboard-empty">
            <span className="empty-icon">🐛</span>
            <h3>No Rankings Yet</h3>
            <p>Complete your first puzzle level to claim the #1 spot on the leaderboard!</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('LEVELS')}
            >
              Play Levels Now
            </button>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="leaderboard-table" aria-label="Global Rankings Table">
                <thead>
                  <tr>
                    <th scope="col" className="col-rank">Rank</th>
                    <th scope="col" className="col-player">Player</th>
                    <th scope="col" className="col-score">
                      {metric === 'totalScore' ? 'Score ★' : 'Score'}
                    </th>
                    <th scope="col" className="col-stars">
                      {metric === 'totalStars' ? 'Stars ★' : 'Stars'}
                    </th>
                    <th scope="col" className="col-levels">Levels</th>
                    <th scope="col" className="col-apples">Apples</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((item) => {
                    const isCurrentUser =
                      user &&
                      (item.userId === user.id ||
                        item.userId === user._id ||
                        item.userId === user.userId ||
                        item.username === user.username);

                    return (
                      <tr
                        key={item.userId || item.rank}
                        className={`leaderboard-row ${isCurrentUser ? 'current-user-row' : ''}`}
                      >
                        <td className="col-rank">
                          {getRankBadge(item.rank)}
                        </td>
                        <td className="col-player">
                          <div className="player-cell">
                            <span className="player-avatar-icon">
                              {item.role === 'admin' ? '🛡️' : '🐛'}
                            </span>
                            <span className="player-username">
                              {item.username}
                              {isCurrentUser && (
                                <span className="you-pill">YOU</span>
                              )}
                              {item.role === 'admin' && (
                                <span className="admin-pill">ADMIN</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="col-score">
                          <span className="score-val">
                            {item.totalScore.toLocaleString()}
                          </span>
                        </td>
                        <td className="col-stars">
                          <span className="stars-val">
                            ⭐ {item.totalStars}
                          </span>
                        </td>
                        <td className="col-levels">
                          <span className="levels-val">
                            {item.completedLevelsCount} / 50
                          </span>
                        </td>
                        <td className="col-apples">
                          <span className="apples-val">
                            🍎 {item.totalApplesEaten}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="leaderboard-pagination">
              <span className="pagination-info">
                Showing Page {page} of {totalPages} ({totalPlayers} Total Adventurers)
              </span>

              <div className="pagination-buttons">
                <button
                  type="button"
                  className="btn btn-secondary pagination-btn"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary pagination-btn"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default LeaderboardPage;
