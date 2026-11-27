/**
 * @file RewardCenterPage.jsx
 * @description Dedicated VELoop Reward Center view.
 * Displays today's reward opportunities, active daily/hourly caps, cooldown countdowns,
 * instant free coins claim via rewarded ad, and full reward transaction history.
 */

import React, { useState, useEffect } from 'react';
import adService from '../services/adService.js';
import RewardedAdModal from '../components/game/RewardedAdModal.jsx';
import { useWallet } from '../context/WalletContext.jsx';

export function RewardCenterPage({ onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activePlacement, setActivePlacement] = useState(null);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState(null);
  const [adsAvailable, setAdsAvailable] = useState(false);

  const { balance } = useWallet();

  const loadRewardCenterData = async () => {
    try {
      const [sumRes, histRes, configRes] = await Promise.all([
        adService.getOpportunitySummary().catch(() => null),
        adService.getRewardHistory({ limit: 15 }).catch(() => []),
        adService.getEconomyConfig().catch(() => null),
      ]);

      if (sumRes) setSummary(sumRes);
      if (Array.isArray(histRes)) setHistory(histRes);

      const isAvail = Boolean(
        configRes?.adsAvailable ??
        configRes?.availability?.available ??
        sumRes?.adsAvailable ??
        sumRes?.availability?.available ??
        false
      );
      setAdsAvailable(isAvail);
    } catch (err) {
      console.error('Failed to load reward center data:', err);
      setAdsAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRewardCenterData();
    const interval = setInterval(loadRewardCenterData, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleWatchStoreCoins = () => {
    if (!adsAvailable) return;
    setActivePlacement('STORE_FREE_COINS');
    setIsAdModalOpen(true);
  };

  const handleRewardGranted = (grantResult) => {
    setFeedbackNotice('🎉 Reward verified! Coins credited to your wallet.');
    loadRewardCenterData();
    setTimeout(() => setFeedbackNotice(null), 5000);
  };

  const limits = summary?.limits || {};
  const usage = summary?.usage || {};
  const isEligible = usage.isEligible ?? true;
  const cooldownSecs = usage.cooldownRemainingSeconds || 0;

  return (
    <div className="home-container" style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header Banner */}
      <section className="hero-banner" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <span className="hero-badge" style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>
              VELoop Rewards Hub
            </span>
            <h1 style={{ fontSize: '1.8rem', margin: '0.4rem 0', color: '#f8fafc' }}>
              🎁 Reward Center
            </h1>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.95rem' }}>
              Watch optional rewarded ads to power up your puzzles, multiply victory scores, and earn free coins!
            </p>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '10px',
              padding: '0.75rem 1.25rem',
              textAlign: 'right',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Wallet Balance</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#facc15' }}>
              🪙 {(typeof balance === 'number' ? balance : 0).toLocaleString()} Coins
            </div>
          </div>
        </div>
      </section>

      {feedbackNotice && (
        <div
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid #22c55e',
            color: '#86efac',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            textAlign: 'center',
            fontWeight: '600',
          }}
        >
          {feedbackNotice}
        </div>
      )}

      {/* Daily Quota & Cooldown Status Card */}
      <section style={{ marginBottom: '2rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div className="stat-card" style={{ padding: '1rem' }}>
            <span style={{ fontSize: '1.8rem' }}>📅</span>
            <div>
              <span className="stat-value" style={{ fontSize: '1.3rem' }}>
                {isLoading ? '...' : `${usage.dailyRemaining ?? 20} / ${limits.maxAdsPerDay ?? 20}`}
              </span>
              <span className="stat-label">Daily Ads Remaining</span>
            </div>
          </div>

          <div className="stat-card" style={{ padding: '1rem' }}>
            <span style={{ fontSize: '1.8rem' }}>⏱️</span>
            <div>
              <span className="stat-value" style={{ fontSize: '1.3rem', color: cooldownSecs > 0 ? '#fbbf24' : '#4ade80' }}>
                {isLoading ? '...' : cooldownSecs > 0 ? `${cooldownSecs}s Active` : 'Ready'}
              </span>
              <span className="stat-label">Ad Cooldown Status</span>
            </div>
          </div>

          <div className="stat-card" style={{ padding: '1rem' }}>
            <span style={{ fontSize: '1.8rem' }}>🪙</span>
            <div>
              <span className="stat-value" style={{ fontSize: '1.3rem', color: '#facc15' }}>
                +{limits.baseCoinReward ?? 25}
              </span>
              <span className="stat-label">Coins Per Watched Ad</span>
            </div>
          </div>
        </div>
      </section>

      {/* Informational Offline/Unavailable Notice */}
      {!isLoading && !adsAvailable && (
        <div
          style={{
            backgroundColor: 'rgba(51, 65, 85, 0.4)',
            border: '1px solid rgba(100, 116, 139, 0.4)',
            color: '#cbd5e1',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          <span>ℹ️</span>
          <span>Rewarded video offers are currently unavailable in this environment. Regular gameplay and store purchases remain fully active.</span>
        </div>
      )}

      {/* Featured Instant Ad Watcher */}
      <section
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#60a5fa', textTransform: 'uppercase' }}>
            ⭐ Daily Free Opportunity
          </span>
          <h2 style={{ fontSize: '1.3rem', margin: '0.3rem 0', color: '#f8fafc' }}>
            Claim Free VELoop Coins
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem', margin: 0 }}>
            Watch a brief sponsored video to receive +{limits.baseCoinReward ?? 25} Coins instantly credited to your wallet.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '0.95rem',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: (!isLoading && adsAvailable && isEligible) ? '#2563eb' : '#475569',
            borderColor: (!isLoading && adsAvailable && isEligible) ? '#3b82f6' : '#64748b',
            cursor: (!isLoading && adsAvailable && isEligible) ? 'pointer' : 'not-allowed',
          }}
          disabled={isLoading || !adsAvailable || !isEligible}
          onClick={handleWatchStoreCoins}
        >
          <span>📺</span>
          <span>
            {isLoading
              ? 'Checking...'
              : !adsAvailable
              ? 'Ads Unavailable'
              : cooldownSecs > 0
              ? `Cooldown (${cooldownSecs}s)`
              : (usage.dailyRemaining ?? 1) <= 0
              ? 'Daily Limit Reached'
              : 'Watch Ad for Coins (+25)'}
          </span>
        </button>
      </section>

      {/* Today's Opportunities Grid (PDF Section 103) */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
          Today's In-Game Opportunities
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">💚</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Second Chance Revive</h3>
            <p>Triggered on level failure. Watch a short ad to continue from your last safe checkpoint.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Game Over Modal</span>
          </div>

          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">🪙</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Double Coins Multiplier</h3>
            <p>Triggered on level victory. Watch an ad to double all standard and golden apple coins earned.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Victory Modal</span>
          </div>

          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">🏆</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Double Score Multiplier</h3>
            <p>Triggered on level victory. Upgrade your final clear score by 2X on the global leaderboard.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Victory Modal</span>
          </div>

          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">🎯</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Extra Moves (+5)</h3>
            <p>Triggered when move limit is reached. Add +5 extra moves to solve tight puzzles.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Out of Moves Modal</span>
          </div>

          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">💡</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Free Puzzle Hint</h3>
            <p>Get immediate path recommendations and apple routes without spending wallet coins.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Game Controls Bar</span>
          </div>

          <div className="hub-card" style={{ cursor: 'default' }}>
            <div className="hub-header">
              <span className="hub-icon">⚡</span>
              <span
                className={adsAvailable ? "badge badge-success" : "badge"}
                style={!adsAvailable ? { backgroundColor: 'rgba(100, 116, 139, 0.25)', color: '#94a3b8' } : {}}
              >
                {adsAvailable ? "Active In Game" : "Unavailable"}
              </span>
            </div>
            <h3>Apple Magnet Booster</h3>
            <p>Activate magnetic apple collection for the session to reach distant apples safely.</p>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Placement: Booster Drawer</span>
          </div>
        </div>
      </section>

      {/* Reward History Ledger (PDF Section 71) */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="section-title" style={{ fontSize: '1.25rem', margin: 0 }}>
            Reward Transaction History
          </h2>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            onClick={loadRewardCenterData}
          >
            🔄 Refresh
          </button>
        </div>

        {history.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              borderRadius: '8px',
              color: '#94a3b8',
              border: '1px dashed #334155',
            }}
          >
            No rewarded ad transactions recorded yet. Complete a level or watch an ad to earn rewards!
          </div>
        ) : (
          <div
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              borderRadius: '8px',
              border: '1px solid #334155',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'rgba(30, 41, 59, 0.8)', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Reward Type</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Placement</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Reward Value</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Date / Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx) => (
                  <tr key={tx.opportunityId} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.5)', color: '#f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>
                      {tx.rewardType === 'REVIVE' && '💚 Revive'}
                      {tx.rewardType === 'EXTRA_MOVES' && '🎯 +5 Moves'}
                      {tx.rewardType === 'DOUBLE_COINS' && '🪙 2X Coins'}
                      {tx.rewardType === 'DOUBLE_SCORE' && '🏆 2X Score'}
                      {tx.rewardType === 'COIN_REWARD' && '🪙 Free Coins'}
                      {tx.rewardType === 'BOOSTER' && '⚡ Booster'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>
                      {tx.placement?.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#facc15', fontWeight: '600' }}>
                      {tx.rewardType === 'DOUBLE_COINS' && `+${tx.grantDetails?.bonusCoins || tx.rewardAmount || 0} Coins`}
                      {tx.rewardType === 'COIN_REWARD' && `+${tx.grantDetails?.coinsAwarded || tx.rewardAmount || 25} Coins`}
                      {tx.rewardType === 'EXTRA_MOVES' && `+${tx.grantDetails?.extraMovesAdded || 5} Moves`}
                      {tx.rewardType === 'DOUBLE_SCORE' && '2X Score Multiplier'}
                      {tx.rewardType === 'REVIVE' && 'Session Restored'}
                      {tx.rewardType === 'BOOSTER' && 'Apple Magnet'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        style={{
                          fontSize: '0.78rem',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(34, 197, 94, 0.15)',
                          color: '#4ade80',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          fontWeight: '600',
                        }}
                      >
                        ✓ {tx.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#94a3b8' }}>
                      {tx.grantedAt ? new Date(tx.grantedAt).toLocaleString() : new Date(tx.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Rewarded Ad Player Modal */}
      <RewardedAdModal
        isOpen={isAdModalOpen}
        placement={activePlacement}
        adsAvailable={adsAvailable}
        onClose={() => setIsAdModalOpen(false)}
        onRewardGranted={handleRewardGranted}
      />
    </div>
  );
}

export default RewardCenterPage;
