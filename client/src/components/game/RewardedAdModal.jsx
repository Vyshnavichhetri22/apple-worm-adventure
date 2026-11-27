/**
 * @file RewardedAdModal.jsx
 * @description Interactive Rewarded Ad player modal for Apple Worm Adventure.
 * Simulates a video ad with real-time countdown, anti-skip enforcement,
 * server-side SSV verification, and animated reward claim celebration.
 */

import React, { useState, useEffect, useRef } from 'react';
import adService from '../../services/adService.js';
import { useWallet } from '../../context/WalletContext.jsx';

const AD_DURATION_SECONDS = 4;

const PLACEMENT_INFO = {
  GAME_OVER_REVIVE: {
    title: 'Second Chance Revive',
    badge: '💚 REVIVE',
    rewardLabel: 'Restore to your last safe checkpoint and keep slithering!',
  },
  POST_WIN_DOUBLE_COIN: {
    title: 'Double Coins Bonus',
    badge: '🪙 2X COINS',
    rewardLabel: 'Double the coins earned from this cleared level!',
  },
  POST_WIN_DOUBLE_SCORE: {
    title: 'Double Score Bonus',
    badge: '🏆 2X SCORE',
    rewardLabel: 'Double your high score for this level run!',
  },
  MOVE_EXHAUSTED_EXTRA: {
    title: 'Extra Moves Boost',
    badge: '🎯 +5 MOVES',
    rewardLabel: 'Add +5 extra moves to keep working towards the portal!',
  },
  STORE_FREE_COINS: {
    title: 'Free Daily Coins',
    badge: '🪙 +25 COINS',
    rewardLabel: 'Earn 25 bonus VELoop coins directly to your wallet!',
  },
  SESSION_BOOSTER: {
    title: 'Magic Apple Booster',
    badge: '⚡ BOOSTER',
    rewardLabel: 'Activate a powerful magnet booster for this puzzle!',
  },
};

export function RewardedAdModal({
  isOpen,
  placement,
  sessionId = null,
  boosterType = 'APPLE_MAGNET',
  adsAvailable = null,
  onClose,
  onRewardGranted,
}) {
  const [phase, setPhase] = useState('INIT'); // 'INIT' | 'PLAYING' | 'VERIFYING' | 'CLAIMED' | 'ERROR'
  const [opportunity, setOpportunity] = useState(null);
  const [countdown, setCountdown] = useState(AD_DURATION_SECONDS);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const { updateBalance } = useWallet();
  const timerRef = useRef(null);
  const isStartedRef = useRef(false);

  const placementData = PLACEMENT_INFO[placement] || {
    title: 'Rewarded Ad Opportunity',
    badge: '🎁 REWARD',
    rewardLabel: 'Watch this sponsored ad to earn special rewards!',
  };

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && placement) {
      setPhase('INIT');
      setCountdown(AD_DURATION_SECONDS);
      setProgress(0);
      setErrorMessage(null);
      setRewardResult(null);
      setShowConfirmClose(false);
      isStartedRef.current = false;

      // Automatically initiate opportunity request
      startAdFlow();
    } else {
      clearInterval(timerRef.current);
    }

    return () => {
      clearInterval(timerRef.current);
    };
  }, [isOpen, placement, sessionId]);

  const startAdFlow = async () => {
    try {
      setPhase('INIT');

      // Server-authoritative availability check before initiating ad playback
      const isAvailable = typeof adsAvailable === 'boolean'
        ? adsAvailable
        : await adService.getAdAvailability();

      if (!isAvailable) {
        setPhase('ERROR');
        setErrorMessage('Rewarded ads are currently unavailable in this environment.');
        return; // Do NOT start the timer or request opportunity
      }

      const opp = await adService.requestOpportunity({
        placement,
        sessionId,
        boosterType,
      });

      setOpportunity(opp);

      // Signal ad start
      await adService.startAd(opp.opportunityId);
      isStartedRef.current = true;
      setPhase('PLAYING');

      // Start Countdown Timer
      const startTime = Date.now();
      const totalMs = AD_DURATION_SECONDS * 1000;

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));

        setCountdown(remaining);
        setProgress(pct);

        if (elapsed >= totalMs) {
          clearInterval(timerRef.current);
          handleAdPlaybackComplete(opp);
        }
      }, 100);
    } catch (err) {
      setPhase('ERROR');
      setErrorMessage(err.message || 'Unable to request ad opportunity. Cooldown or limit may be active.');
    }
  };

  const handleAdPlaybackComplete = async (opp) => {
    try {
      setPhase('VERIFYING');

      // Trigger server-side SSV verification & reward granting
      const res = await adService.simulateWatch(opp.opportunityId);

      setRewardResult(res?.data || res);
      setPhase('CLAIMED');

      // If coins were granted, refresh local wallet context
      if (res?.data?.grantDetails?.walletBalance !== undefined) {
        updateBalance(res.data.grantDetails.walletBalance);
      } else if (res?.data?.grantDetails?.balanceAfter !== undefined) {
        updateBalance(res.data.grantDetails.balanceAfter);
      }

      // Notify parent component
      if (typeof onRewardGranted === 'function') {
        onRewardGranted(res?.data || res);
      }
    } catch (err) {
      setPhase('ERROR');
      setErrorMessage(err.message || 'Reward verification failed. Please try again.');
    }
  };

  const handleAttemptClose = () => {
    if (phase === 'PLAYING' && countdown > 0) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const confirmForfeitClose = () => {
    clearInterval(timerRef.current);
    setShowConfirmClose(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop rewarded-ad-backdrop" style={{ zIndex: 9999 }}>
      <div className="modal-card rewarded-ad-modal" style={{ maxWidth: '480px', width: '92%' }}>
        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                fontSize: '0.75rem',
                fontWeight: '700',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'rgba(34, 197, 94, 0.18)',
                color: '#4ade80',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                marginBottom: '4px',
              }}
            >
              {placementData.badge}
            </span>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>{placementData.title}</h3>
          </div>

          <button
            type="button"
            onClick={handleAttemptClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.4rem',
              cursor: 'pointer',
              padding: '4px',
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Phase: INIT */}
        {phase === 'INIT' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: '#cbd5e1' }}>Connecting to VELoop Ad Server & reserving quota...</p>
          </div>
        )}

        {/* Phase: PLAYING */}
        {phase === 'PLAYING' && (
          <div>
            {/* Mock Video Canvas Frame */}
            <div
              style={{
                position: 'relative',
                height: '200px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                border: '1px solid #334155',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem', animation: 'bounce 1s infinite' }}>
                📺
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#f1f5f9' }}>
                VELoop Rewards Partner Ad
              </div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '4px' }}>
                Support the game to claim: {placementData.badge}
              </div>

              {/* Countdown Pill */}
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  background: 'rgba(0, 0, 0, 0.75)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '0.8rem',
                  color: '#fbbf24',
                  fontWeight: '600',
                  border: '1px solid rgba(251, 191, 36, 0.4)',
                }}
              >
                Reward in {countdown}s
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{ height: '8px', background: '#334155', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #10b981 0%, #22c55e 100%)',
                  transition: 'width 0.1s linear',
                }}
              />
            </div>

            <p style={{ fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center', margin: 0 }}>
              Keep this window open to receive your verified reward.
            </p>
          </div>
        )}

        {/* Phase: VERIFYING */}
        {phase === 'VERIFYING' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 1rem' }} />
            <h4 style={{ color: '#f8fafc', marginBottom: '0.5rem' }}>Verifying Ad Completion</h4>
            <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
              Validating cryptographic SSV token on VELoop Server...
            </p>
          </div>
        )}

        {/* Phase: CLAIMED */}
        {phase === 'CLAIMED' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🎉</div>
            <h3 style={{ color: '#4ade80', margin: '0 0 0.5rem' }}>Reward Verified & Claimed!</h3>
            <p style={{ color: '#f1f5f9', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
              {placementData.rewardLabel}
            </p>

            {rewardResult?.grantDetails && (
              <div
                style={{
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.9rem',
                  color: '#86efac',
                }}
              >
                {rewardResult.rewardType === 'REVIVE' && '💚 Level revived! Continue slithering.'}
                {rewardResult.rewardType === 'EXTRA_MOVES' && `🎯 +${rewardResult.grantDetails.extraMovesAdded || 5} Moves added!`}
                {rewardResult.rewardType === 'DOUBLE_COINS' && `🪙 Doubled! +${rewardResult.grantDetails.bonusCoins || 0} Bonus Coins credited.`}
                {rewardResult.rewardType === 'DOUBLE_SCORE' && `🏆 Doubled! Score upgraded to ${rewardResult.grantDetails.scoreDoubled || '2X'}.`}
                {rewardResult.rewardType === 'COIN_REWARD' && `🪙 +${rewardResult.grantDetails.coinsAwarded || 25} Coins added to your wallet.`}
                {rewardResult.rewardType === 'BOOSTER' && '⚡ Magic booster granted for this session!'}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem' }}
              onClick={onClose}
            >
              Continue Playing ▶
            </button>
          </div>
        )}

        {/* Phase: ERROR */}
        {phase === 'ERROR' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
            <h4 style={{ color: '#f87171', margin: '0 0 0.5rem' }}>Ad Opportunity Unavailable</h4>
            <p style={{ color: '#cbd5e1', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              {errorMessage}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={onClose}
              >
                Cancel
              </button>
              {adsAvailable !== false && !errorMessage?.includes('unavailable') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={startAdFlow}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Confirmation Modal when user clicks close during playback */}
        {showConfirmClose && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.95)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.5rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏸️</div>
            <h4 style={{ color: '#f8fafc', margin: '0 0 0.5rem' }}>Close Ad Early?</h4>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              If you close the ad before the timer finishes, you will forfeit this reward opportunity.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => setShowConfirmClose(false)}
              >
                Resume Ad ({countdown}s left)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={confirmForfeitClose}
              >
                Forfeit Reward
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RewardedAdModal;
