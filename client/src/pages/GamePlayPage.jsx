import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { WormGameEngine } from '../components/game/WormGameEngine';
import GameCanvas from '../components/game/GameCanvas';
import GameControls from '../components/game/GameControls';
import { VictoryDialog, FailureDialog } from '../components/game/GameDialogs';
import RewardedAdModal from '../components/game/RewardedAdModal';
import levelService from '../services/levelService';
import dailyChallengeService from '../services/dailyChallengeService';
import walletService from '../services/walletService';
import inventoryService from '../services/inventoryService';
import { useWallet } from '../context/WalletContext.jsx';
import api from '../services/api';
import adService from '../services/adService';
import { formatMysteryEffectDescription } from '../utils/mysteryApple';
import audioManager from '../utils/audioManager';

const ITEM_PRICES = {
  UNDO: 40,
  HINT: 50,
  BOOSTER: 100,
};

export default function GamePlayPage({
  sessionData,
  levelData,
  isDailyChallenge = false,
  challengeDate = null,
  pendingNavigation,
  onConfirmExit,
  onNextLevel,
  onRestartSession,
}) {
  const effectiveIsDaily = Boolean(isDailyChallenge || sessionData?.isDailyChallenge);
  const [dailyStreak, setDailyStreak] = useState(null);
  const [engine, setEngine] = useState(null);
  const [sessionStartTime, setSessionStartTime] = useState(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const initialStatus = sessionData?.status || sessionData?.session?.status || 'ACTIVE';
  const backendSessionStatusRef = useRef(initialStatus);
  const [backendSessionStatus, setBackendSessionStatus] = useState(initialStatus);

  const initialSessionId = sessionData?._id || sessionData?.id || sessionData?.session?._id;
  const activeSessionIdRef = useRef(initialSessionId);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);

  const engineRef = useRef(null);
  const sessionStartTimeRef = useRef(Date.now());
  const lastInitializedSessionIdRef = useRef(null);
  const lastInitializedLevelNumberRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [backendRewards, setBackendRewards] = useState(null);
  const [backendWallet, setBackendWallet] = useState(null);

  const [isRestarting, setIsRestarting] = useState(false);
  const [restartError, setRestartError] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);
  const [uncertainNotice, setUncertainNotice] = useState(null);
  const [navigationError, setNavigationError] = useState(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isReconcilingModal, setIsReconcilingModal] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [isMuted, setIsMuted] = useState(audioManager.isMuted());

  const handleToggleMute = useCallback(() => {
    const next = audioManager.toggleMute();
    setIsMuted(next);
  }, []);

  const [showDrawer, setShowDrawer] = useState(false);
  const [, setRenderTrigger] = useState(0);

  // Rewarded Ad Economy State
  const [activeAdPlacement, setActiveAdPlacement] = useState(null);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);
  const [isDoubleCoinsClaimed, setIsDoubleCoinsClaimed] = useState(false);
  const [isDoubleScoreClaimed, setIsDoubleScoreClaimed] = useState(false);
  const [revivesUsedInSession, setRevivesUsedInSession] = useState(sessionData?.revivesUsed || 0);
  const [isAdsAvailable, setIsAdsAvailable] = useState(false);

  useEffect(() => {
    let isMounted = true;
    adService
      .getAdAvailability()
      .then((avail) => {
        if (isMounted) setIsAdsAvailable(Boolean(avail));
      })
      .catch(() => {
        if (isMounted) setIsAdsAvailable(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const { balance: contextBalance, updateBalance } = useWallet();
  const walletBalance = typeof contextBalance === 'number' ? contextBalance : 0;
  const updateBalanceRef = useRef(updateBalance);
  useEffect(() => {
    updateBalanceRef.current = updateBalance;
  }, [updateBalance]);

  const [inventory, setInventory] = useState({ UNDO: 0, HINT: 0, BOOSTER: 0 });
  const [isUndoLoading, setIsUndoLoading] = useState(false);
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [isBoosterLoading, setIsBoosterLoading] = useState(false);

  const pendingPurchaseKeysRef = useRef({
    UNDO: null,
    HINT: null,
    BOOSTER: null,
  });

  const levelNumber = levelData?.levelNumber || sessionData?.levelNumber || 1;

  const terminalOperationRef = useRef(null);
  const isTerminalRef = useRef(false);

  // FIFO Checkpoint Queue and error tracking
  const checkpointQueueRef = useRef([]);
  const isProcessingCheckpointQueueRef = useRef(false);
  const inFlightCheckpointRef = useRef(null);
  const activeProcessingCheckpointRef = useRef(null);
  const confirmedCheckpointMovesRef = useRef(0);
  const checkpointDrainErrorRef = useRef(null);
  const queuedExitDestinationRef = useRef(null);

  const updateBackendStatus = useCallback((status) => {
    backendSessionStatusRef.current = status;
    setBackendSessionStatus(status);
  }, []);

  const refreshUserEconomy = useCallback(async () => {
    try {
      const [walletRes, invRes] = await Promise.all([
        walletService.getWallet().catch(() => api.get('/wallet')),
        inventoryService.getInventory().catch(() => api.get('/inventory')),
      ]);

      const bal = walletRes?.data?.balance ?? walletRes?.balance;
      if (bal !== undefined && Number.isFinite(Number(bal))) {
        updateBalanceRef.current?.(Number(bal));
      }

      const invMap = { UNDO: 0, HINT: 0, BOOSTER: 0 };
      const rawItems = invRes?.data?.items || invRes?.items || invRes?.data;
      if (rawItems && typeof rawItems === 'object') {
        if (Array.isArray(rawItems)) {
          for (const item of rawItems) {
            if (item.itemType && invMap[item.itemType] !== undefined) {
              invMap[item.itemType] = item.quantity || 0;
            }
          }
        } else {
          for (const key of ['UNDO', 'HINT', 'BOOSTER']) {
            if (rawItems[key]) {
              invMap[key] = rawItems[key].quantity || 0;
            }
          }
        }
      }
      setInventory(invMap);
    } catch (_err) {
      // Non-fatal economy polling error
    }
  }, []);

  // Safe Terminal-Only Checkpoint Queue Compaction
  // When entering terminal drain (COMPLETING, FAILING, LEAVING), collapses redundant unsent intermediate
  // pending checkpoints down to the newest terminal snapshot, while strictly preserving any in-flight request.
  const compactTerminalCheckpointQueue = useCallback(() => {
    const isAllowedTerminalDrain =
      terminalOperationRef.current === 'COMPLETING' ||
      terminalOperationRef.current === 'FAILING' ||
      terminalOperationRef.current === 'LEAVING';

    if (!isAllowedTerminalDrain) {
      return;
    }

    const queue = checkpointQueueRef.current;
    if (!Array.isArray(queue) || queue.length <= 1) {
      return;
    }

    const hasInFlightOrActive =
      isProcessingCheckpointQueueRef.current &&
      (inFlightCheckpointRef.current !== null || activeProcessingCheckpointRef.current !== null);

    if (hasInFlightOrActive) {
      // In-flight/active item is guaranteed at queue[0]. Must never remove, replace or mutate it.
      if (queue.length > 2) {
        const activeItem = queue[0];
        let newest = queue[queue.length - 1];
        for (let i = queue.length - 1; i >= 1; i--) {
          if (queue[i] && (newest === null || queue[i].movesTaken >= newest.movesTaken)) {
            newest = queue[i];
          }
        }
        if (newest && newest !== activeItem && newest.movesTaken > activeItem.movesTaken) {
          checkpointQueueRef.current = [activeItem, newest];
        } else if (newest && newest.movesTaken <= activeItem.movesTaken) {
          checkpointQueueRef.current = [activeItem];
        }
      }
    } else {
      // Worker is idle or between items. No request is currently in-flight.
      // Entire queue consists of unsent pending snapshots.
      let newest = queue[queue.length - 1];
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i] && (newest === null || queue[i].movesTaken >= newest.movesTaken)) {
          newest = queue[i];
        }
      }
      if (newest) {
        checkpointQueueRef.current = [newest];
      }
    }
  }, []);

  // Process FIFO Checkpoint Queue in strict order without dropping failed checkpoints
  const processCheckpointQueue = useCallback(async () => {
    if (isProcessingCheckpointQueueRef.current) return;
    const currentId = activeSessionIdRef.current;
    const isAllowedTerminalDrain = () =>
      terminalOperationRef.current === 'COMPLETING' ||
      terminalOperationRef.current === 'FAILING' ||
      terminalOperationRef.current === 'LEAVING';

    if (
      !currentId ||
      backendSessionStatusRef.current !== 'ACTIVE' ||
      (isTerminalRef.current && !isAllowedTerminalDrain())
    ) {
      return;
    }

    isProcessingCheckpointQueueRef.current = true;
    checkpointDrainErrorRef.current = null;

    try {
      while (checkpointQueueRef.current.length > 0) {
        if (
          backendSessionStatusRef.current !== 'ACTIVE' ||
          (isTerminalRef.current && !isAllowedTerminalDrain())
        ) {
          break;
        }

        // Apply terminal compaction dynamically between items if in terminal operation
        if (isAllowedTerminalDrain()) {
          compactTerminalCheckpointQueue();
        }

        const nextCp = checkpointQueueRef.current[0];

        if (nextCp.movesTaken <= confirmedCheckpointMovesRef.current) {
          checkpointQueueRef.current.shift();
          continue;
        }

        activeProcessingCheckpointRef.current = nextCp;
        let saved = false;
        let lastErr = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            inFlightCheckpointRef.current = nextCp;
            const res = await levelService.saveCheckpoint(currentId, nextCp);
            if (res && (res.success || res.checkpoint)) {
              confirmedCheckpointMovesRef.current = nextCp.movesTaken;
              checkpointQueueRef.current.shift();
              saved = true;
              checkpointDrainErrorRef.current = null;
              break;
            } else {
              lastErr = new Error(res?.message || 'Server rejected checkpoint write');
            }
          } catch (err) {
            lastErr = err;
            // Circuit breaker: immediately stop retrying if rate-limited
            if (err.status === 429 || err.statusCode === 429 || err.message?.includes('Too many requests')) {
              break;
            }
          } finally {
            inFlightCheckpointRef.current = null;
          }
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }

        activeProcessingCheckpointRef.current = null;

        if (!saved) {
          checkpointDrainErrorRef.current = lastErr || new Error('Checkpoint failed to persist after 3 attempts');
          break;
        }
      }
    } finally {
      inFlightCheckpointRef.current = null;
      activeProcessingCheckpointRef.current = null;
      isProcessingCheckpointQueueRef.current = false;
    }
  }, [compactTerminalCheckpointQueue]);

  const queueCheckpoint = useCallback(
    (checkpointData) => {
      if (
        isTerminalRef.current ||
        terminalOperationRef.current ||
        backendSessionStatusRef.current !== 'ACTIVE'
      ) {
        return;
      }
      checkpointQueueRef.current.push(checkpointData);
      processCheckpointQueue();
    },
    [processCheckpointQueue]
  );

  // Confirms all pending checkpoints are persisted or raises blocking error
  const drainCheckpointQueue = useCallback(async () => {
    // Reset any prior drain error when worker is idle so retries can cleanly proceed
    if (!isProcessingCheckpointQueueRef.current) {
      checkpointDrainErrorRef.current = null;
    }

    compactTerminalCheckpointQueue();

    if (!isProcessingCheckpointQueueRef.current && checkpointQueueRef.current.length > 0) {
      processCheckpointQueue();
    }

    let attempts = 0;
    while ((isProcessingCheckpointQueueRef.current || checkpointQueueRef.current.length > 0) && attempts < 80) {
      if (checkpointDrainErrorRef.current && !isProcessingCheckpointQueueRef.current) {
        break;
      }
      if (!isProcessingCheckpointQueueRef.current && checkpointQueueRef.current.length > 0 && !checkpointDrainErrorRef.current) {
        processCheckpointQueue();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }

    if (checkpointDrainErrorRef.current) {
      const msg = checkpointDrainErrorRef.current.message || 'Server connection error during checkpoint save';
      throw new Error(msg);
    }

    if (checkpointQueueRef.current.length > 0 || isProcessingCheckpointQueueRef.current) {
      throw new Error('Checkpoint persistence timed out with unsaved moves in queue');
    }

    return true;
  }, [processCheckpointQueue, compactTerminalCheckpointQueue]);

  useEffect(() => {
    if (!levelData) return;

    const incomingSessionId = sessionData?._id || sessionData?.id || sessionData?.session?._id;
    const incomingLevelNumber = levelData?.levelNumber;

    if (
      incomingSessionId &&
      incomingSessionId === activeSessionIdRef.current &&
      incomingLevelNumber === lastInitializedLevelNumberRef.current
    ) {
      return;
    }

    if (terminalOperationRef.current === 'RESTARTING') {
      return;
    }

    lastInitializedSessionIdRef.current = incomingSessionId;
    lastInitializedLevelNumberRef.current = incomingLevelNumber;
    activeSessionIdRef.current = incomingSessionId;
    setActiveSessionId(incomingSessionId);

    const newEngine = new WormGameEngine(levelData, sessionData);

    const cp = sessionData?.checkpoint || sessionData?.session?.checkpoint;
    if (cp) {
      newEngine.restoreFromCheckpoint(cp);
      confirmedCheckpointMovesRef.current = cp.movesTaken || 0;
    } else {
      confirmedCheckpointMovesRef.current = 0;
    }

    const extra = sessionData?.extraMovesAllowed || sessionData?.session?.extraMovesAllowed || 0;
    if (extra) {
      newEngine.setExtraMovesAllowed(extra);
    }

    engineRef.current = newEngine;
    setEngine(newEngine);

    const stat = sessionData?.status || sessionData?.session?.status || 'ACTIVE';
    updateBackendStatus(stat);

    const now = Date.now();
    sessionStartTimeRef.current = now;
    setSessionStartTime(now);
    setElapsedSeconds(0);

    setBackendRewards(null);
    setBackendWallet(null);
    setSubmitError(null);
    setIsRestarting(false);
    setRestartError(null);
    setRecoveryError(null);
    setUncertainNotice(null);
    setNavigationError(null);
    setModalFeedback(null);
    setActionFeedback(null);

    terminalOperationRef.current = null;
    isTerminalRef.current = false;
    checkpointQueueRef.current = [];
    isProcessingCheckpointQueueRef.current = false;
    inFlightCheckpointRef.current = null;
    activeProcessingCheckpointRef.current = null;
    checkpointDrainErrorRef.current = null;
    queuedExitDestinationRef.current = null;

    refreshUserEconomy();
  }, [levelData, sessionData, updateBackendStatus, refreshUserEconomy]);

  useEffect(() => {
    if (!engine || engine.status !== 'PLAYING' || isTerminalRef.current) return;

    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [engine, backendSessionStatus]);

  const reconcileSessionWithBackend = useCallback(async () => {
    const currentId = activeSessionIdRef.current;
    if (!currentId) return 'UNCERTAIN';

    try {
      const res = await levelService.getGameSession(currentId);
      const sess = res?.data || res;
      if (sess && sess.status) {
        if (sess.status === 'COMPLETED') {
          updateBackendStatus('COMPLETED');
          setUncertainNotice(null);
          return 'COMPLETED';
        }
        if (sess.status === 'FAILED' || sess.status === 'ABANDONED') {
          updateBackendStatus('FAILED');
          setUncertainNotice(null);
          return 'FAILED';
        }
        if (sess.status === 'ACTIVE') {
          if (
            backendSessionStatusRef.current !== 'COMPLETED' &&
            backendSessionStatusRef.current !== 'FAILED'
          ) {
            updateBackendStatus('ACTIVE');
          }
          setUncertainNotice(null);
          return 'ACTIVE';
        }
      }
    } catch (_err) {
      // Unreachable
    }

    if (
      backendSessionStatusRef.current !== 'COMPLETED' &&
      backendSessionStatusRef.current !== 'FAILED'
    ) {
      updateBackendStatus('UNCERTAIN');
    }
    return backendSessionStatusRef.current;
  }, [updateBackendStatus]);

  const executeLeaveGame = useCallback(
    async (initialDestination) => {
      if (terminalOperationRef.current && terminalOperationRef.current !== 'LEAVING') {
        queuedExitDestinationRef.current = initialDestination;
        return;
      }

      terminalOperationRef.current = 'LEAVING';
      setIsLeaving(true);
      setNavigationError(null);
      if (!queuedExitDestinationRef.current) {
        queuedExitDestinationRef.current = initialDestination;
      }

      try {
        const currentId = activeSessionIdRef.current;
        let currentStatus = backendSessionStatusRef.current;

        if (currentStatus === 'UNCERTAIN') {
          currentStatus = await reconcileSessionWithBackend();
        }

        if (currentStatus === 'COMPLETED' || currentStatus === 'FAILED' || currentStatus === 'ABANDONED') {
          terminalOperationRef.current = null;
          setIsLeaving(false);
          const target = queuedExitDestinationRef.current || initialDestination;
          queuedExitDestinationRef.current = null;
          onConfirmExit(target);
          return;
        }

        if (!currentId) {
          terminalOperationRef.current = null;
          setIsLeaving(false);
          const target = queuedExitDestinationRef.current || initialDestination;
          queuedExitDestinationRef.current = null;
          onConfirmExit(target);
          return;
        }

        await drainCheckpointQueue();
        const duration = Math.max(1, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
        const movesCount = engineRef.current?.movesCount || 0;

        let failSucceeded = false;
        try {
          const res = await levelService.failSession(currentId, {
            failureReason: 'ABANDONED',
            moves: movesCount,
            durationSeconds: duration,
          });
          if (res && (res.success || res.status === 'FAILED' || res.data?.status === 'FAILED')) {
            updateBackendStatus('FAILED');
            failSucceeded = true;
          }
        } catch (_abandonErr) {
          // Fallback
        }

        if (!failSucceeded) {
          const verified = await reconcileSessionWithBackend();
          if (verified === 'FAILED' || verified === 'ABANDONED' || verified === 'COMPLETED') {
            failSucceeded = true;
          }
        }

        if (failSucceeded) {
          terminalOperationRef.current = null;
          setIsLeaving(false);
          const target = queuedExitDestinationRef.current || initialDestination;
          queuedExitDestinationRef.current = null;
          onConfirmExit(target);
        } else {
          throw new Error('Session is still active on server. Abandonment unverified.');
        }
      } catch (err) {
        terminalOperationRef.current = null;
        setIsLeaving(false);
        const target = queuedExitDestinationRef.current || initialDestination;
        setNavigationError({
          message: err.message,
          destination: target,
        });
      }
    },
    [reconcileSessionWithBackend, onConfirmExit, updateBackendStatus, drainCheckpointQueue]
  );

  const processQueuedNavigation = useCallback(async () => {
    const dest = queuedExitDestinationRef.current;
    if (!dest) return;

    let status = backendSessionStatusRef.current;
    const currentId = activeSessionIdRef.current;

    if (status === 'UNCERTAIN') {
      status = await reconcileSessionWithBackend();
    }

    if (status === 'COMPLETED' || status === 'FAILED' || status === 'ABANDONED' || !currentId) {
      queuedExitDestinationRef.current = null;
      onConfirmExit(dest);
      return;
    }

    if (status === 'ACTIVE') {
      executeLeaveGame(dest);
      return;
    }

    setNavigationError({
      message: 'Session status could not be verified. Please reconcile status before leaving.',
      destination: dest,
    });
  }, [reconcileSessionWithBackend, onConfirmExit, executeLeaveGame]);

  const fetchAndApplyServerRewards = useCallback(async (currentId) => {
    try {
      const sessionCheck = await levelService.getGameSession(currentId);
      const sess = sessionCheck?.data || sessionCheck;

      const stars = sess.starsEarned ?? sess.starsAwarded;
      const coins = sess.coinsEarned ?? sess.coinsAwarded;
      const score = sess.score;

      if (typeof stars === 'number' && typeof coins === 'number' && typeof score === 'number') {
        const goldenApples = sess.goldenApplesCollected ?? sess.rewardBreakdown?.goldenApplesCount ?? 0;
        const goldenCoins = sess.rewardBreakdown?.goldenApplesCoins ?? (goldenApples > 0 ? goldenApples * 10 : 0);
        const megaApples = sess.megaApplesCollected ?? sess.rewardBreakdown?.megaApplesCount ?? 0;
        const timeApples = sess.timeApplesCollected ?? sess.rewardBreakdown?.timeApplesCount ?? 0;
        const timeBonusMoves = sess.rewardBreakdown?.timeBonusMoves ?? (timeApples * (sess.level?.timeAppleBonusMoves || 5));
        const mysteryApples = sess.mysteryApplesCollected ?? sess.rewardBreakdown?.mysteryApplesCount ?? 0;
        const mysteryEffects = sess.rewardBreakdown?.mysteryEffects ?? sess.checkpoint?.mysteryEffectsApplied ?? [];

        setBackendRewards({
          stars,
          coins,
          score,
          goldenApples,
          goldenCoins,
          megaApples,
          timeApples,
          timeBonusMoves,
          mysteryApples,
          mysteryEffects,
        });

        try {
          const walletRes = await api.get('/wallet');
          if (walletRes && (walletRes.success || walletRes.balance !== undefined)) {
            const bal = walletRes.data?.balance ?? walletRes.balance;
            setBackendWallet({ balance: bal });
            if (bal !== undefined && Number.isFinite(Number(bal))) {
              updateBalanceRef.current?.(Number(bal));
            }
          }
        } catch (_wErr) {
          // Non-fatal
        }

        setSubmitError(null);
        return true;
      }
      return false;
    } catch (_recErr) {
      return false;
    }
  }, []);

  const handleFailSession = useCallback(
    async (reason) => {
      const currentId = activeSessionIdRef.current;
      if (
        terminalOperationRef.current ||
        backendSessionStatusRef.current === 'FAILED' ||
        backendSessionStatusRef.current === 'ABANDONED' ||
        backendSessionStatusRef.current === 'COMPLETED' ||
        !currentId
      ) {
        return;
      }

      terminalOperationRef.current = 'FAILING';
      isTerminalRef.current = true;

      try {
        await drainCheckpointQueue();
      } catch (_drainErr) {
        // Proceed with failure report even if checkpoint queue had sync issue
      }

      const duration = Math.max(1, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
      const movesCount = engineRef.current?.movesCount || 0;

      try {
        const res = await levelService.failSession(currentId, {
          failureReason: reason || 'OUT_OF_MOVES',
          moves: movesCount,
          durationSeconds: duration,
        });

        if (res && (res.success || res.status === 'FAILED' || res.data?.status === 'FAILED')) {
          updateBackendStatus('FAILED');
          setUncertainNotice(null);
        } else {
          throw new Error(res?.message || 'Failure status unconfirmed.');
        }
      } catch (err) {
        const reconciled = await reconcileSessionWithBackend();
        if (reconciled !== 'FAILED' && reconciled !== 'ABANDONED' && reconciled !== 'COMPLETED') {
          updateBackendStatus('UNCERTAIN');
          setUncertainNotice(
            `Connection lost while reporting failure: ${err.message || 'Server did not respond'}. Gameplay locked. Click Reconcile to verify.`
          );
        }
      } finally {
        terminalOperationRef.current = null;
        await processQueuedNavigation();
      }
    },
    [reconcileSessionWithBackend, processQueuedNavigation, updateBackendStatus, drainCheckpointQueue]
  );

  const handleCompleteSession = useCallback(async () => {
    const currentId = activeSessionIdRef.current;
    const currentEngine = engineRef.current;

    if (terminalOperationRef.current || submitting || !currentId || !currentEngine) {
      return;
    }

    if (backendSessionStatusRef.current === 'COMPLETED') {
      fetchAndApplyServerRewards(currentId);
      return;
    }

    if (backendSessionStatusRef.current === 'FAILED' || backendSessionStatusRef.current === 'ABANDONED') {
      setSubmitError('This session was recorded as failed on the server and cannot be completed. Please restart the level.');
      return;
    }

    terminalOperationRef.current = 'COMPLETING';
    isTerminalRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    // Ensure the final winning checkpoint is in queue before draining if not yet confirmed
    const latestEngineMoves = currentEngine.movesCount;
    if (latestEngineMoves > confirmedCheckpointMovesRef.current) {
      const alreadyQueued = checkpointQueueRef.current.some(
        (cp) => cp && cp.movesTaken >= latestEngineMoves
      );
      if (!alreadyQueued) {
        checkpointQueueRef.current.push(currentEngine.getCheckpointState());
      }
    }

    // Safely compact any unsent pending checkpoints for terminal drain
    compactTerminalCheckpointQueue();

    // 1. MUST drain and confirm the final winning checkpoint reaches the server before completion
    try {
      await drainCheckpointQueue();
    } catch (drainErr) {
      terminalOperationRef.current = null;
      isTerminalRef.current = false;
      setSubmitting(false);
      setSubmitError(`Failed to sync final move to server: ${drainErr.message}. Click Retry to synchronize.`);
      return;
    }

    // Guard: ensure the final move has actually been acknowledged by the server before proceeding
    if (confirmedCheckpointMovesRef.current < currentEngine.movesCount) {
      terminalOperationRef.current = null;
      isTerminalRef.current = false;
      setSubmitting(false);
      setSubmitError('Failed to sync final move to server: Final move was not acknowledged. Click Retry to synchronize.');
      return;
    }

    const duration = Math.max(1, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));

    try {
      let response;
      if (effectiveIsDaily) {
        try {
          response = await dailyChallengeService.completeDailyChallenge(currentId, {
            moves: currentEngine.movesCount,
            durationSeconds: duration,
            applesCollected: currentEngine.applesEaten,
          });
        } catch (dcErr) {
          console.warn('Daily challenge completion endpoint failed, falling back to session complete:', dcErr);
          response = await levelService.completeSession(currentId, {
            moves: currentEngine.movesCount,
            durationSeconds: duration,
            applesCollected: currentEngine.applesEaten,
          });
        }
      } else {
        response = await levelService.completeSession(currentId, {
          moves: currentEngine.movesCount,
          durationSeconds: duration,
          applesCollected: currentEngine.applesEaten,
        });
      }

      const resData = response.data || response;
      if (resData && (resData.rewards || resData.session?.status === 'COMPLETED' || resData.completion)) {
        if (resData.streak) {
          setDailyStreak(resData.streak);
        } else if (resData.rewards?.dailyStreak) {
          setDailyStreak({ currentStreak: resData.rewards.dailyStreak });
        }

        const sess = resData.session || {};
        const rew = resData.rewards || {};
        const goldenApples = rew.goldenApples ?? sess.goldenApplesCollected ?? sess.rewardBreakdown?.goldenApplesCount ?? 0;
        const goldenCoins = rew.goldenCoins ?? sess.rewardBreakdown?.goldenApplesCoins ?? (goldenApples > 0 ? goldenApples * 10 : 0);
        const megaApples = rew.megaApples ?? sess.megaApplesCollected ?? sess.rewardBreakdown?.megaApplesCount ?? 0;
        const timeApples = rew.timeApples ?? sess.timeApplesCollected ?? sess.rewardBreakdown?.timeApplesCount ?? 0;
        const timeBonusMoves = rew.timeBonusMoves ?? sess.rewardBreakdown?.timeBonusMoves ?? (timeApples * (sess.level?.timeAppleBonusMoves || 5));
        const mysteryApples = rew.mysteryApples ?? sess.mysteryApplesCollected ?? sess.rewardBreakdown?.mysteryApplesCount ?? 0;
        const mysteryEffects = rew.mysteryEffects ?? sess.rewardBreakdown?.mysteryEffects ?? sess.checkpoint?.mysteryEffectsApplied ?? [];

        setBackendRewards({
          stars: rew.stars ?? sess.starsEarned ?? sess.starsAwarded ?? 1,
          coins: rew.coins ?? sess.coinsEarned ?? sess.coinsAwarded ?? 25,
          score: rew.score ?? sess.score ?? 500,
          goldenApples,
          goldenCoins,
          megaApples,
          timeApples,
          timeBonusMoves,
          mysteryApples,
          mysteryEffects,
          ...(rew.dailyStreak ? { dailyStreak: rew.dailyStreak } : {}),
        });
        setBackendWallet(resData.wallet || null);
        if (resData.wallet?.balance !== undefined && Number.isFinite(Number(resData.wallet.balance))) {
          updateBalanceRef.current?.(Number(resData.wallet.balance));
        }
        updateBackendStatus('COMPLETED');
        refreshUserEconomy();
      } else {
        throw new Error(response?.message || 'Server did not return confirmed rewards.');
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || '';
      const reconciled = await reconcileSessionWithBackend();

      if (reconciled === 'COMPLETED') {
        updateBackendStatus('COMPLETED');
        await fetchAndApplyServerRewards(currentId);
      } else if (reconciled === 'ACTIVE') {
        isTerminalRef.current = false;
        updateBackendStatus('ACTIVE');
        setSubmitError(errMsg || 'Completion request rejected by server. Session remains active. Click Retry.');
      } else {
        updateBackendStatus('UNCERTAIN');
        setSubmitError('Verification network failure. Session state uncertain. Click Retry.');
      }
    } finally {
      terminalOperationRef.current = null;
      setSubmitting(false);
      await processQueuedNavigation();
    }
  }, [
    submitting,
    effectiveIsDaily,
    fetchAndApplyServerRewards,
    reconcileSessionWithBackend,
    processQueuedNavigation,
    updateBackendStatus,
    compactTerminalCheckpointQueue,
    drainCheckpointQueue,
    refreshUserEconomy,
  ]);

  // Movement Dispatcher
  const handleMove = useCallback(
    (directionKey) => {
      const currentEngine = engineRef.current;
      if (
        !currentEngine ||
        currentEngine.status !== 'PLAYING' ||
        terminalOperationRef.current ||
        backendSessionStatusRef.current !== 'ACTIVE' ||
        isTerminalRef.current
      ) {
        return;
      }

      const result = currentEngine.move(directionKey);
      if (!result.moved) return;

      // Visual Action Feedback & Audio Dispatch
      if (result.isGoldenApple) {
        audioManager.playAppleCollect('golden');
        setActionFeedback('✨ Golden Apple collected! +50 Score & +10 Coins');
      } else if (result.isMegaApple) {
        audioManager.playAppleCollect('mega');
        setActionFeedback('🌟 Mega Apple collected! +2 Worm Growth & +100 Score');
      } else if (result.isTimeApple) {
        audioManager.playAppleCollect('time');
        const bonusMoves = result.timeBonusMoves || 5;
        setActionFeedback(`⏱️ Time Apple collected! +${bonusMoves} Moves & +100 Score`);
      } else if (result.isMysteryApple) {
        audioManager.playAppleCollect('mystery');
        const desc = result.mysteryEffect ? formatMysteryEffectDescription(result.mysteryEffect) : 'Mystery effect applied!';
        setActionFeedback(`✨ Mystery Apple collected! ${desc}`);
      } else if (result.collectedApple) {
        audioManager.playAppleCollect('normal');
        setActionFeedback('🍎 Apple collected! +1 Worm Growth & +100 Score');
      } else if (result.collectedKey) {
        audioManager.playKeyCollect();
        setActionFeedback('🔑 Key collected! Gate unlocked.');
      } else if (result.filledPit) {
        audioManager.playPitFill();
        setActionFeedback('🪨 Pit bridged with boulder! Safe to cross.');
      } else if (result.pushedStone) {
        audioManager.playStonePush();
        setActionFeedback('🪨 Pushed boulder.');
      } else {
        audioManager.playStep();
        setActionFeedback(null);
      }
      setRenderTrigger((prev) => prev + 1);

      if (result.status === 'WON') {
        audioManager.playVictory();
        // Enqueue the final winning checkpoint immediately
        queueCheckpoint(currentEngine.getCheckpointState());
        // Celebration delay to allow the player to see the portal vortex suction animation
        setTimeout(() => {
          handleCompleteSession();
        }, 550);
      } else if (result.status === 'FAILED') {
        audioManager.playHazardCollision(result.failureReason);
        handleFailSession(result.failureReason);
      } else {
        queueCheckpoint(currentEngine.getCheckpointState());
      }
    },
    [handleCompleteSession, handleFailSession, queueCheckpoint]
  );

  const handleBuyItem = async (itemType) => {
    const cost = ITEM_PRICES[itemType];
    if (walletBalance < cost) {
      setActionFeedback(`Insufficient VELoop coins to purchase ${itemType}. Required: 🪙${cost}, available: 🪙${walletBalance}`);
      return false;
    }

    if (!pendingPurchaseKeysRef.current[itemType]) {
      pendingPurchaseKeysRef.current[itemType] = `buy_${itemType}_${activeSessionIdRef.current}_${Date.now()}`;
    }
    const idempotencyKey = pendingPurchaseKeysRef.current[itemType];

    try {
      const res = await walletService.purchaseItem(itemType, idempotencyKey);

      if (res && (res.success || res.item || res.data)) {
        pendingPurchaseKeysRef.current[itemType] = null;
        const newBal = res.data?.balance;
        if (newBal !== undefined && Number.isFinite(Number(newBal))) {
          updateBalanceRef.current?.(Number(newBal));
        }
        await refreshUserEconomy();
        return true;
      }
      setActionFeedback(res?.message || `Failed to purchase ${itemType}.`);
      return false;
    } catch (err) {
      setActionFeedback(`Purchase failed: ${err.message || 'Server connection error'}`);
      return false;
    }
  };

  const handleUndo = async () => {
    const currentEngine = engineRef.current;
    const currentId = activeSessionIdRef.current;
    if (
      !currentEngine ||
      currentEngine.movesCount === 0 ||
      backendSessionStatusRef.current !== 'ACTIVE' ||
      terminalOperationRef.current ||
      isTerminalRef.current ||
      isUndoLoading ||
      !currentId
    ) {
      return;
    }

    setIsUndoLoading(true);
    setActionFeedback(null);
    try {
      if ((inventory.UNDO || 0) <= 0) {
        const purchased = await handleBuyItem('UNDO');
        if (!purchased) {
          setIsUndoLoading(false);
          return;
        }
      }

      // Block Undo if pending checkpoint persistence fails
      await drainCheckpointQueue();

      const undoKey = `undo_act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await levelService.applyUndo(currentId, undoKey);
      const data = res.data || res;

      if (data && data.restoredCheckpoint) {
        currentEngine.restoreFromCheckpoint(data.restoredCheckpoint);
        confirmedCheckpointMovesRef.current = currentEngine.movesCount;
        checkpointQueueRef.current = [];
        setRenderTrigger((p) => p + 1);
        setActionFeedback(`↩ Undo applied! Restored to move ${currentEngine.movesCount}.`);
      } else {
        setActionFeedback('↩ Undo applied successfully.');
      }
      await refreshUserEconomy();
    } catch (err) {
      setActionFeedback(`Undo failed: ${err.message}`);
      setModalFeedback(`Undo blocked: ${err.message}`);
    } finally {
      setIsUndoLoading(false);
    }
  };

  const handleRecoveryUndo = async () => {
    const currentEngine = engineRef.current;
    const currentId = activeSessionIdRef.current;
    if (
      !currentEngine ||
      currentEngine.movesCount === 0 ||
      (backendSessionStatusRef.current !== 'FAILED' && backendSessionStatusRef.current !== 'ACTIVE') ||
      terminalOperationRef.current ||
      isUndoLoading ||
      !currentId
    ) {
      return;
    }

    setIsUndoLoading(true);
    setRecoveryError(null);
    setActionFeedback(null);

    try {
      if ((inventory.UNDO || 0) <= 0) {
        const purchased = await handleBuyItem('UNDO');
        if (!purchased) {
          setRecoveryError(`Insufficient VELoop coins to purchase Undo item (cost: 🪙${ITEM_PRICES.UNDO}).`);
          setIsUndoLoading(false);
          return;
        }
      }

      checkpointQueueRef.current = [];
      checkpointDrainErrorRef.current = null;

      const undoKey = `undo_rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await levelService.applyUndo(currentId, undoKey);
      const data = res.data || res;

      if (currentEngine.undoStack.length > 0) {
        currentEngine.undo();
      }
      if (data && data.restoredCheckpoint) {
        currentEngine.restoreFromCheckpoint(data.restoredCheckpoint);
      }
      currentEngine.status = 'PLAYING';
      currentEngine.failureReason = null;
      confirmedCheckpointMovesRef.current = currentEngine.movesCount;
      checkpointQueueRef.current = [];

      isTerminalRef.current = false;
      terminalOperationRef.current = null;
      updateBackendStatus('ACTIVE');
      setRenderTrigger((p) => p + 1);
      setActionFeedback(`↩ Recovered from failure! Restored to move ${currentEngine.movesCount}.`);
      setRecoveryError(null);
      await refreshUserEconomy();
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Recovery failed';
      setRecoveryError(errMsg);
      setActionFeedback(`Recovery failed: ${errMsg}`);
    } finally {
      setIsUndoLoading(false);
    }
  };

  const handleBooster = async () => {
    const currentEngine = engineRef.current;
    const currentId = activeSessionIdRef.current;
    if (
      !currentEngine ||
      backendSessionStatusRef.current !== 'ACTIVE' ||
      terminalOperationRef.current ||
      isTerminalRef.current ||
      isBoosterLoading ||
      !currentId
    ) {
      return;
    }

    setIsBoosterLoading(true);
    setActionFeedback(null);
    try {
      if ((inventory.BOOSTER || 0) <= 0) {
        const purchased = await handleBuyItem('BOOSTER');
        if (!purchased) {
          setIsBoosterLoading(false);
          return;
        }
      }

      const boosterKey = `boost_act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await levelService.applyBooster(currentId, 'EXTRA_MOVES', boosterKey);
      const data = res.data || res;

      if (data && data.totalExtraMovesAllowed !== undefined) {
        currentEngine.setExtraMovesAllowed(data.totalExtraMovesAllowed);
        setRenderTrigger((p) => p + 1);
        const added = data.extraMovesAdded || 5;
        setActionFeedback(`⚡ Booster applied! +${added} moves added (${currentEngine.movesRemaining} moves remaining).`);
      } else {
        setActionFeedback('⚡ Booster applied successfully.');
      }
      await refreshUserEconomy();
    } catch (err) {
      console.error('Failed to apply booster:', err);
      setActionFeedback(`Booster failed: ${err.message || 'Could not apply extra moves'}`);
    } finally {
      setIsBoosterLoading(false);
    }
  };

  const handleHint = async () => {
    const currentEngine = engineRef.current;
    const currentId = activeSessionIdRef.current;
    if (
      !currentEngine ||
      backendSessionStatusRef.current !== 'ACTIVE' ||
      terminalOperationRef.current ||
      isTerminalRef.current ||
      isHintLoading ||
      !currentId
    ) {
      return;
    }

    setIsHintLoading(true);
    setActionFeedback(null);
    try {
      if ((inventory.HINT || 0) <= 0) {
        const purchased = await handleBuyItem('HINT');
        if (!purchased) {
          setIsHintLoading(false);
          return;
        }
      }

      const hintKey = `hint_act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await levelService.requestHint(currentId, hintKey);
      const data = res.data || res;

      if (data && data.solutionMoves && Array.isArray(data.solutionMoves)) {
        const hintMsg = `💡 Hint: Next suggested moves are [${data.solutionMoves.join(', ')}]`;
        setActionFeedback(hintMsg);
        setModalFeedback(hintMsg);
      } else {
        setActionFeedback('💡 Hint: No solution moves available for current state.');
      }
      await refreshUserEconomy();
    } catch (err) {
      console.error('Failed to request hint:', err);
      setActionFeedback(`Hint failed: ${err.message || 'Could not generate hint'}`);
    } finally {
      setIsHintLoading(false);
    }
  };

  const handlersRef = useRef({ handleMove, handleUndo });
  useLayoutEffect(() => {
    handlersRef.current = { handleMove, handleUndo };
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          handlersRef.current.handleMove?.('UP');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          handlersRef.current.handleMove?.('DOWN');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          handlersRef.current.handleMove?.('LEFT');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          handlersRef.current.handleMove?.('RIGHT');
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          handlersRef.current.handleUndo?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Open Rewarded Ad modal for specific placement
  const handleOpenRewardedAd = (placement) => {
    if (!isAdsAvailable) {
      setActionFeedback('Rewarded ads are currently unavailable.');
      setTimeout(() => setActionFeedback(null), 3000);
      return;
    }
    setActiveAdPlacement(placement);
    setIsAdModalOpen(true);
  };

  // Called when RewardedAdModal successfully claims a verified reward
  const handleRewardGranted = (grantResult) => {
    const rewardType = grantResult?.rewardType;
    const details = grantResult?.grantDetails || {};

    if (rewardType === 'REVIVE') {
      const currentEngine = engineRef.current;
      if (currentEngine) {
        currentEngine.revive();
        updateBackendStatus('ACTIVE');
        setRevivesUsedInSession((prev) => prev + 1);
        setRenderTrigger((r) => r + 1);
        setActionFeedback('💚 Revived! Continue your run from the safe checkpoint.');
        setTimeout(() => setActionFeedback(null), 4000);
      }
    } else if (rewardType === 'EXTRA_MOVES') {
      const currentEngine = engineRef.current;
      const movesAdded = details.extraMovesAdded || 5;
      if (currentEngine) {
        currentEngine.addExtraMoves(movesAdded);
        updateBackendStatus('ACTIVE');
        setRenderTrigger((r) => r + 1);
        setActionFeedback(`🎯 +${movesAdded} Extra Moves added to your puzzle!`);
        setTimeout(() => setActionFeedback(null), 4000);
      }
    } else if (rewardType === 'DOUBLE_COINS') {
      setIsDoubleCoinsClaimed(true);
      if (details.totalCoinsEarned) {
        setBackendRewards((prev) => prev ? { ...prev, coins: details.totalCoinsEarned } : prev);
      }
      setActionFeedback(`🪙 Doubled! +${details.bonusCoins || ''} Bonus Coins credited to your wallet.`);
      setTimeout(() => setActionFeedback(null), 4000);
    } else if (rewardType === 'DOUBLE_SCORE') {
      setIsDoubleScoreClaimed(true);
      if (details.scoreDoubled) {
        setBackendRewards((prev) => prev ? { ...prev, score: details.scoreDoubled } : prev);
      }
      setActionFeedback(`🏆 2X Score verified and updated on server!`);
      setTimeout(() => setActionFeedback(null), 4000);
    } else if (rewardType === 'BOOSTER') {
      const currentEngine = engineRef.current;
      if (currentEngine && details.boosterGranted) {
        currentEngine.applyBoosterEffect(details.boosterGranted);
        setRenderTrigger((r) => r + 1);
        setActionFeedback(`⚡ Magic Booster activated for this run!`);
        setTimeout(() => setActionFeedback(null), 4000);
      }
    }
  };

  const handleRestart = async () => {
    // 1. Prevent concurrent or conflicting operations
    if (terminalOperationRef.current || isRestarting) return;
    terminalOperationRef.current = 'RESTARTING';
    setIsRestarting(true);
    setRestartError(null);
    setRecoveryError(null);
    if (typeof setActionFeedback === 'function') setActionFeedback(null);

    const oldSessionId = activeSessionIdRef.current;
    let currentStatus = backendSessionStatusRef.current;
    const isPlaying = engineRef.current?.status === 'PLAYING';

    try {
      // 2. Reconcile if session status is currently uncertain
      if (currentStatus === 'UNCERTAIN') {
        currentStatus = await reconcileSessionWithBackend();
      }

      // Safety Guard: Stop immediately if status remains uncertain
      if (currentStatus === 'UNCERTAIN') {
        throw new Error(
          'Session status cannot be verified with the server. Please check your connection and click "Reconcile Status" before restarting.'
        );
      }

      // 3. Drain checkpoint queue ONLY for ACTIVE sessions currently in play.
      // For FAILED or COMPLETED sessions, queued checkpoints are obsolete and must not block restart.
      if (currentStatus === 'ACTIVE' && isPlaying && !isTerminalRef.current) {
        try {
          await drainCheckpointQueue();
        } catch (drainErr) {
          throw new Error(`Restart blocked: ${drainErr.message}`);
        }
      } else {
        checkpointQueueRef.current = [];
        checkpointDrainErrorRef.current = null;
      }

      const duration = Math.max(1, Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));

      // 4. If session is ACTIVE, attempt explicit failure recording
      if (currentStatus === 'ACTIVE' && oldSessionId) {
        try {
          const res = await levelService.failSession(oldSessionId, {
            failureReason: 'MANUAL_RESTART',
            moves: engineRef.current?.movesCount || 0,
            durationSeconds: duration,
          });
          if (res && (res.success || res.status === 'FAILED' || res.data?.status === 'FAILED')) {
            updateBackendStatus('FAILED');
            currentStatus = 'FAILED';
          }
        } catch (_failErr) {
          // If explicit failSession fails, check backend state
          const rec = await reconcileSessionWithBackend();
          if (rec === 'UNCERTAIN') {
            throw new Error(
              'Failed to record session restart and could not verify server status. Please click "Reconcile Status" before proceeding.'
            );
          }
          if (rec === 'FAILED' || rec === 'ABANDONED' || rec === 'COMPLETED') {
            currentStatus = rec;
            updateBackendStatus(rec);
          }
          // Note: If rec === 'ACTIVE', backend startSession will atomically abandon it.
        }
      }

      // 5. Verify restart handler is configured
      if (!onRestartSession) {
        throw new Error('Restart handler is missing from page configuration.');
      }

      // 6. Request authoritative fresh session from server
      const newSession = await onRestartSession(levelNumber);
      const newSessionId = newSession?._id || newSession?.id || newSession?.session?._id;

      if (!newSessionId || newSessionId === oldSessionId) {
        throw new Error('Failed to obtain a distinct new session ID from server.');
      }

      // 7. Initialize clean engine and reset all client state
      const freshEngine = new WormGameEngine(levelData, newSession);
      const now = Date.now();

      activeSessionIdRef.current = newSessionId;
      setActiveSessionId(newSessionId);
      lastInitializedSessionIdRef.current = newSessionId;
      engineRef.current = freshEngine;
      sessionStartTimeRef.current = now;
      updateBackendStatus('ACTIVE');

      setEngine(freshEngine);
      setSessionStartTime(now);
      setElapsedSeconds(0);

      isTerminalRef.current = false;
      confirmedCheckpointMovesRef.current = 0;
      checkpointQueueRef.current = [];
      checkpointDrainErrorRef.current = null;
      setRenderTrigger((t) => t + 1);
    } catch (err) {
      setRestartError(err.message);
      if (typeof setActionFeedback === 'function') {
        setActionFeedback(err.message || 'Failed to restart level.');
      }
    } finally {
      terminalOperationRef.current = null;
      setIsRestarting(false);
      await processQueuedNavigation();
    }
  };

  const handleLeaveGame = useCallback(
    (destination = 'LEVELS') => {
      if (terminalOperationRef.current) {
        queuedExitDestinationRef.current = destination;
        return;
      }
      executeLeaveGame(destination);
    },
    [executeLeaveGame]
  );

  useEffect(() => {
    if (pendingNavigation) {
      handleLeaveGame(pendingNavigation);
    }
  }, [pendingNavigation, handleLeaveGame]);

  if (!levelData || !engine) {
    return (
      <div className="game-loading-screen">
        <div className="loading-spinner" />
        <p>Initializing Level {levelNumber} Engine...</p>
      </div>
    );
  }

  const movesLeft = engine.movesRemaining;

  return (
    <div className="gameplay-page">
      <header className="game-hud">
        <div className="hud-left">
          <button
            type="button"
            className="btn btn-secondary back-btn"
            style={{ marginBottom: 0 }}
            onClick={() => handleLeaveGame('LEVELS')}
            title="Exit to Level Map"
          >
            ← Map
          </button>
          <div className="hud-level-info">
            <h2 className="hud-level-title">Level {levelNumber}</h2>
            <span className="milestone-badge" style={{ marginBottom: 0 }}>
              {levelData.difficulty?.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="hud-center">
          <div className="hud-stat-pill stat-moves">
            <span className="stat-pill-label">Moves Left</span>
            <span className={`stat-pill-val ${movesLeft <= 5 ? 'danger-text' : ''}`}>
              {movesLeft} / {engine.effectiveMoveLimit}
            </span>
          </div>

          <div className="hud-stat-pill stat-apples" title="Apples Collected / Total Apples">
            <span className="stat-pill-label">Apples</span>
            <span className="stat-pill-val green-text">
              {engine.applesEaten} / {engine.totalApplesCount}
            </span>
          </div>

          {Boolean(engine.goldenApplesEaten) && (
            <div className="hud-stat-pill stat-golden">
              <span className="stat-pill-label">Golden</span>
              <span className="stat-pill-val gold-text">{engine.goldenApplesEaten} 🍏</span>
            </div>
          )}

          {Boolean(engine.megaApplesEaten) && (
            <div className="hud-stat-pill stat-mega">
              <span className="stat-pill-label">Mega</span>
              <span className="stat-pill-val magenta-text">{engine.megaApplesEaten} 🌟</span>
            </div>
          )}

          {Boolean(engine.timeApplesEaten) && (
            <div className="hud-stat-pill stat-time-apple">
              <span className="stat-pill-label">Bonus Moves</span>
              <span className="stat-pill-val cyan-text">
                +{engine.timeApplesEaten * (engine.timeAppleBonusMoves || 5)} ⏱️
              </span>
            </div>
          )}

          {Boolean(engine.mysteryApplesEaten) && (
            <div className="hud-stat-pill stat-mystery">
              <span className="stat-pill-label">Mystery</span>
              <span className="stat-pill-val purple-text">
                {engine.mysteryApplesEaten} ✨
              </span>
            </div>
          )}

          <div className="hud-stat-pill stat-timer">
            <span className="stat-pill-label">Time</span>
            <span className="stat-pill-val">{elapsedSeconds}s</span>
          </div>
        </div>

        <div className="hud-right">
          <div className="hud-thresholds-card">
            <span className="thresholds-header">Star Goals</span>
            <div className="hud-thresholds">
              {engine.starThresholds?.threeStars != null ? (
                <span className={`threshold-item ${engine.movesCount <= engine.starThresholds.threeStars ? 'active-star' : 'missed-star'}`}>
                  ⭐⭐⭐ ≤ {engine.starThresholds.threeStars}
                </span>
              ) : null}
              {engine.starThresholds?.twoStars != null ? (
                <span className={`threshold-item ${engine.movesCount <= engine.starThresholds.twoStars ? 'active-star' : 'missed-star'}`}>
                  ⭐⭐ ≤ {engine.starThresholds.twoStars}
                </span>
              ) : null}
              {engine.starThresholds == null && (
                <span className="threshold-unavailable" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  Thresholds N/A
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {uncertainNotice && (
        <div className="game-alert game-alert-warning">
          <div className="alert-content">
            <span className="alert-icon">⚠️</span>
            <span className="alert-message">{uncertainNotice}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary alert-btn"
            onClick={reconcileSessionWithBackend}
            disabled={isReconcilingModal || isLeaving || submitting || isRestarting}
          >
            🔄 Reconcile Status with Server
          </button>
        </div>
      )}

      {submitError && (
        <div className="game-alert game-alert-error">
          <div className="alert-content">
            <span className="alert-icon">⚠️</span>
            <span className="alert-message">{submitError}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary alert-btn"
            onClick={handleCompleteSession}
            disabled={submitting}
          >
            🔄 Retry Completion
          </button>
        </div>
      )}

      {actionFeedback && (
        <div className="game-alert game-alert-info">
          <div className="alert-content">
            <span className="alert-icon">ℹ️</span>
            <span className="alert-message">{actionFeedback}</span>
          </div>
          <button
            type="button"
            className="alert-close-btn"
            onClick={() => setActionFeedback(null)}
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      <div className="game-objective-card">
        <div className="objective-badge">
          <span className="objective-icon">🎯</span>
          <span className="objective-label">GOAL</span>
        </div>
        <div className="objective-desc">
          {engine.getObjectiveDescription()}
        </div>
      </div>

      <div className="game-board-area">
        <GameCanvas engine={engine} onMove={handleMove} onCellClick={() => {}} />
      </div>

      <div className="game-footer-controls">
        <GameControls
          onMove={handleMove}
          onUndo={handleUndo}
          onHint={handleHint}
          onBooster={handleBooster}
          onRestart={handleRestart}
          canUndo={engine.movesCount > 0 && engine.status === 'PLAYING' && backendSessionStatus === 'ACTIVE' && !isLeaving && !submitting && !isRestarting}
          disabled={engine.status !== 'PLAYING' || backendSessionStatus !== 'ACTIVE' || submitting || isRestarting || isLeaving}
          inventory={inventory}
          walletBalance={walletBalance}
          prices={ITEM_PRICES}
          isUndoLoading={isUndoLoading}
          isHintLoading={isHintLoading}
          isBoosterLoading={isBoosterLoading}
          movesRemaining={movesLeft}
          movesLimit={engine.effectiveMoveLimit}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          totalKeys={engine.totalKeysCount || 0}
          collectedKeysCount={engine.collectedKeys?.size || 0}
          totalApples={engine.totalApplesCount || 0}
          collectedApplesCount={engine.applesEaten || 0}
          applesEaten={engine.applesEaten || 0}
        />
      </div>

      {navigationError && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Session Exit Notice</h2>
            <p>{navigationError.message}</p>
            {modalFeedback && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: '6px', backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', color: '#93c5fd', fontSize: '0.9rem' }}>
                ℹ️ {modalFeedback}
              </div>
            )}
            <div className="victory-actions" style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => executeLeaveGame(queuedExitDestinationRef.current || navigationError.destination)}
                disabled={isReconcilingModal || isLeaving || submitting || isRestarting}
              >
                🔄 Retry Abandonment
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  setIsReconcilingModal(true);
                  try {
                    await reconcileSessionWithBackend();
                  } finally {
                    setIsReconcilingModal(false);
                  }
                }}
                disabled={isReconcilingModal || isLeaving || submitting || isRestarting}
              >
                {isReconcilingModal ? 'Checking...' : '🔍 Reconcile Status'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setNavigationError(null);
                  setModalFeedback(null);
    setActionFeedback(null);
                  queuedExitDestinationRef.current = null;
                }}
              >
                Stay in Game
              </button>
            </div>
          </div>
        </div>
      )}

      {showDrawer && (
        <div className="modal-backdrop" onClick={() => setShowDrawer(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Level {levelNumber} Details</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowDrawer(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="level-spec-grid">
                <div className="spec-item">
                  <span className="spec-label">Session ID</span>
                  <span className="spec-val" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{activeSessionId}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Backend Status</span>
                  <span className="spec-val">{backendSessionStatus}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Grid</span>
                  <span className="spec-val">{engine.cols} × {engine.rows}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Apples Remaining</span>
                  <span className="spec-val">{engine.apples.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <VictoryDialog
        isOpen={engine.status === 'WON'}
        levelNumber={levelNumber}
        moves={engine.movesCount}
        duration={elapsedSeconds}
        submitting={submitting}
        backendRewards={backendRewards}
        backendWallet={backendWallet}
        submitError={submitError}
        onRetrySubmit={handleCompleteSession}
        onNextLevel={() => {
          if (effectiveIsDaily) {
            handleLeaveGame('DAILY');
          } else {
            onNextLevel(levelNumber + 1);
          }
        }}
        onLevelSelect={() => handleLeaveGame(effectiveIsDaily ? 'DAILY' : 'LEVELS')}
        isLastLevel={levelNumber >= 50}
        isDoubleCoinsClaimed={isDoubleCoinsClaimed}
        isDoubleScoreClaimed={isDoubleScoreClaimed}
        onWatchAdDoubleScore={() => handleOpenRewardedAd('POST_WIN_DOUBLE_SCORE')}
        onWatchAdDoubleCoins={() => handleOpenRewardedAd('POST_WIN_DOUBLE_COIN')}
        isDailyChallenge={effectiveIsDaily}
        dailyStreak={dailyStreak}
        adsAvailable={isAdsAvailable}
      />

      <FailureDialog
        isOpen={engine.status === 'FAILED'}
        levelNumber={levelNumber}
        reason={engine.failureReason}
        moves={engine.movesCount}
        duration={elapsedSeconds}
        isRestarting={isRestarting}
        restartError={restartError}
        onRestart={handleRestart}
        onLevelSelect={() => handleLeaveGame(effectiveIsDaily ? 'DAILY' : 'LEVELS')}
        canRevive={revivesUsedInSession < 1}
        revivesUsed={revivesUsedInSession}
        onWatchAdRevive={() => handleOpenRewardedAd('GAME_OVER_REVIVE')}
        onWatchAdExtraMoves={() => handleOpenRewardedAd('MOVE_EXHAUSTED_EXTRA')}
        adsAvailable={isAdsAvailable}
        canUndo={
          engine.status === 'FAILED' &&
          ['SELF_COLLISION', 'CRUSHED', 'HIT_SPIKE', 'FALLEN_OFF_GRID', 'OUT_OF_MOVES', 'TRAPPED'].includes(engine.failureReason) &&
          engine.movesCount > 0 &&
          backendSessionStatus !== 'COMPLETED' &&
          backendSessionStatus !== 'ABANDONED' &&
          !isRestarting &&
          !submitting
        }
        undoCount={inventory.UNDO || 0}
        isUndoing={isUndoLoading}
        undoError={recoveryError}
        onUndo={handleRecoveryUndo}
      />

      {/* VELoop Rewarded Ad Player & SSV Verification Modal */}
      <RewardedAdModal
        isOpen={isAdModalOpen}
        placement={activeAdPlacement}
        sessionId={activeSessionId}
        adsAvailable={isAdsAvailable}
        onClose={() => setIsAdModalOpen(false)}
        onRewardGranted={handleRewardGranted}
      />
    </div>
  );
}

GamePlayPage.propTypes = {
  sessionData: PropTypes.object,
  levelData: PropTypes.object,
  isDailyChallenge: PropTypes.bool,
  challengeDate: PropTypes.string,
  pendingNavigation: PropTypes.string,
  onConfirmExit: PropTypes.func.isRequired,
  onNextLevel: PropTypes.func.isRequired,
  onRestartSession: PropTypes.func.isRequired,
};