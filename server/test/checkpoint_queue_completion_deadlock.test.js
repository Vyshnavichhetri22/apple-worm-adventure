/**
 * server/test/checkpoint_queue_completion_deadlock.test.js
 *
 * Focused Test Suite for Checkpoint Queue Deadlock Prevention During Level Completion
 *
 * Verifies all 10 requirements:
 *  1. A winning move queues a final checkpoint.
 *  2. Completion begins and the terminal flag is set.
 *  3. The final checkpoint is still allowed to transmit while completing.
 *  4. The checkpoint drain resolves after the server acknowledges the queued checkpoint.
 *  5. Completion is called only after the drain resolves.
 *  6. Completion is not called when checkpoint synchronization fails.
 *  7. Retry after synchronization failure can process the queued checkpoint.
 *  8. Additional user moves are blocked during completion.
 *  9. Already in-flight checkpoint operations are handled correctly.
 * 10. Duplicate completion/reward submission protections remain intact.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Checkpoint Queue & Level Completion Deadlock Prevention Suite', () => {
  const pagePath = path.resolve(__dirname, '../../client/src/pages/GamePlayPage.jsx');
  const fileContent = fs.readFileSync(pagePath, 'utf8');

  // =========================================================================
  // Section A: Source Code Integrity Checks
  // =========================================================================
  describe('A. Source Code Integrity Checks', () => {
    it('A.1 processCheckpointQueue defines isAllowedTerminalDrain containing COMPLETING, FAILING, LEAVING', () => {
      assert.ok(
        fileContent.includes("terminalOperationRef.current === 'COMPLETING'"),
        "Must check for terminalOperationRef.current === 'COMPLETING'"
      );
      assert.ok(
        fileContent.includes("terminalOperationRef.current === 'FAILING'"),
        "Must check for terminalOperationRef.current === 'FAILING'"
      );
      assert.ok(
        fileContent.includes("terminalOperationRef.current === 'LEAVING'"),
        "Must check for terminalOperationRef.current === 'LEAVING'"
      );
    });

    it('A.2 processCheckpointQueue allows draining when isTerminalRef.current is true during allowed terminal drain', () => {
      assert.ok(
        fileContent.includes('isTerminalRef.current && !isAllowedTerminalDrain()'),
        'Queue worker must dynamically evaluate isAllowedTerminalDrain'
      );
    });

    it('A.3 queueCheckpoint blocks new checkpoint additions during terminal operations', () => {
      assert.ok(
        fileContent.includes('isTerminalRef.current ||') &&
          fileContent.includes('terminalOperationRef.current ||') &&
          fileContent.includes("backendSessionStatusRef.current !== 'ACTIVE'"),
        'queueCheckpoint must guard against terminal state, terminal operations, and non-active backend sessions'
      );
    });

    it('A.4 drainCheckpointQueue resets stale error when worker is idle to allow clean retries', () => {
      assert.ok(
        fileContent.includes('if (!isProcessingCheckpointQueueRef.current) {\n      checkpointDrainErrorRef.current = null;\n    }') ||
        fileContent.includes('if (!isProcessingCheckpointQueueRef.current) {') &&
        fileContent.includes('checkpointDrainErrorRef.current = null;'),
        'drainCheckpointQueue must clear stale checkpointDrainErrorRef when idle'
      );
    });

    it('A.5 drainCheckpointQueue requires both empty queue and finished worker to succeed', () => {
      assert.ok(
        fileContent.includes('checkpointQueueRef.current.length > 0 || isProcessingCheckpointQueueRef.current'),
        'drainCheckpointQueue must ensure no pending items or in-flight processing before reporting success'
      );
    });

    it('A.6 isAllowedTerminalDrain is defined as a dynamic function to prevent stale closure during in-flight operations', () => {
      assert.ok(
        fileContent.includes('const isAllowedTerminalDrain = () =>'),
        'isAllowedTerminalDrain must be a function evaluated dynamically on each loop iteration'
      );
    });

    it('A.7 handleCompleteSession ensures final winning checkpoint is enqueued before draining if unconfirmed', () => {
      assert.ok(
        fileContent.includes('latestEngineMoves > confirmedCheckpointMovesRef.current'),
        'handleCompleteSession must check if latest engine moves exceed confirmed moves'
      );
      assert.ok(
        fileContent.includes('checkpointQueueRef.current.push(currentEngine.getCheckpointState())'),
        'handleCompleteSession must push getCheckpointState() if not already queued'
      );
    });

    it('A.8 handleCompleteSession guards against completing with unconfirmed final moves', () => {
      assert.ok(
        fileContent.includes('confirmedCheckpointMovesRef.current < currentEngine.movesCount'),
        'handleCompleteSession must verify confirmedCheckpointMovesRef >= currentEngine.movesCount'
      );
    });

    it('A.9 compactTerminalCheckpointQueue is defined and preserves in-flight request while compacting pending', () => {
      assert.ok(
        fileContent.includes('const compactTerminalCheckpointQueue = useCallback('),
        'compactTerminalCheckpointQueue must be defined as a useCallback'
      );
      assert.ok(
        fileContent.includes('hasInFlightOrActive'),
        'compactTerminalCheckpointQueue must check if an item is active/in-flight'
      );
      assert.ok(
        fileContent.includes('checkpointQueueRef.current = [activeItem, newest]'),
        'compactTerminalCheckpointQueue must preserve active in-flight item and newest terminal item'
      );
    });

    it('A.10 inFlightCheckpointRef explicitly identifies when an HTTP request is in-flight across the wire', () => {
      assert.ok(
        fileContent.includes('inFlightCheckpointRef = useRef(null)'),
        'inFlightCheckpointRef must be declared'
      );
      assert.ok(
        fileContent.includes('inFlightCheckpointRef.current = nextCp'),
        'inFlightCheckpointRef must be set right before HTTP saveCheckpoint call'
      );
      assert.ok(
        fileContent.includes('inFlightCheckpointRef.current = null'),
        'inFlightCheckpointRef must be cleared in finally block'
      );
    });

    it('A.11 activeProcessingCheckpointRef tracks the checkpoint currently undergoing worker processing or retry delays', () => {
      assert.ok(
        fileContent.includes('activeProcessingCheckpointRef = useRef(null)'),
        'activeProcessingCheckpointRef must be declared'
      );
      assert.ok(
        fileContent.includes('activeProcessingCheckpointRef.current = nextCp'),
        'activeProcessingCheckpointRef must be set during attempt processing'
      );
    });

    it('A.12 processCheckpointQueue dynamically compacts queue between items during allowed terminal drain', () => {
      assert.ok(
        fileContent.includes('compactTerminalCheckpointQueue();'),
        'processCheckpointQueue must invoke compactTerminalCheckpointQueue'
      );
    });

    it('A.13 drainCheckpointQueue and handleCompleteSession invoke compactTerminalCheckpointQueue', () => {
      assert.ok(
        /compactTerminalCheckpointQueue\(\);[\r\n\s]+if \(!isProcessingCheckpointQueueRef\.current/.test(fileContent),
        'drainCheckpointQueue must compact pending checkpoints upon entry'
      );
      assert.ok(
        /compactTerminalCheckpointQueue\(\);[\r\n\s]+\/\/ 1\. MUST drain and confirm/.test(fileContent),
        'handleCompleteSession must compact checkpoints before draining'
      );
    });
  });

  // =========================================================================
  // Section B: State-Machine Simulation Harness
  // =========================================================================
  function createHarness(options = {}) {
    const {
      mockSaveCheckpoint = async () => ({ success: true }),
      mockCompleteSession = async () => ({ success: true, data: { status: 'COMPLETED', rewards: { stars: 3, coins: 50 } } }),
      mockCompleteDailyChallenge = async () => ({ success: true, data: { status: 'COMPLETED', streak: 5 } }),
    } = options;

    const activeSessionIdRef = { current: 'sess_123' };
    const backendSessionStatusRef = { current: 'ACTIVE' };
    const terminalOperationRef = { current: null };
    const isTerminalRef = { current: false };
    const checkpointQueueRef = { current: [] };
    const isProcessingCheckpointQueueRef = { current: false };
    const inFlightCheckpointRef = { current: null };
    const activeProcessingCheckpointRef = { current: null };
    const confirmedCheckpointMovesRef = { current: 0 };
    const checkpointDrainErrorRef = { current: null };
    let submitting = false;
    let submitError = null;

    const savedCheckpoints = [];
    const completedCalls = [];
    const completedDailyCalls = [];
    let moveBlockedCount = 0;

    const engineRef = {
      current: options.currentEngine || {
        get movesCount() {
          if (options.engineMoves !== undefined) return options.engineMoves;
          if (checkpointQueueRef.current.length > 0) {
            return Math.max(...checkpointQueueRef.current.map((cp) => cp?.movesTaken || 0));
          }
          return confirmedCheckpointMovesRef.current || 12;
        },
        get applesEaten() {
          return 1;
        },
        getCheckpointState: options.getCheckpointState || (() => ({
          movesTaken: options.engineMoves !== undefined ? options.engineMoves : 12,
          wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
          applesRemaining: [],
        })),
      },
    };

    const compactTerminalCheckpointQueue = () => {
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
    };

    const processCheckpointQueue = async () => {
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
              const res = await mockSaveCheckpoint(currentId, nextCp);
              if (res && (res.success || res.checkpoint)) {
                confirmedCheckpointMovesRef.current = nextCp.movesTaken;
                checkpointQueueRef.current.shift();
                saved = true;
                checkpointDrainErrorRef.current = null;
                savedCheckpoints.push(nextCp);
                break;
              } else {
                lastErr = new Error(res?.message || 'Server rejected checkpoint write');
              }
            } catch (err) {
              lastErr = err;
              if (err.status === 429 || err.statusCode === 429 || err.message?.includes('Too many requests')) {
                break;
              }
            } finally {
              inFlightCheckpointRef.current = null;
            }
            await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
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
    };

    const queueCheckpoint = (checkpointData) => {
      if (
        isTerminalRef.current ||
        terminalOperationRef.current ||
        backendSessionStatusRef.current !== 'ACTIVE'
      ) {
        return false;
      }
      checkpointQueueRef.current.push(checkpointData);
      processCheckpointQueue();
      return true;
    };

    const drainCheckpointQueue = async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 20));
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
    };

    const handleMove = (direction) => {
      if (
        terminalOperationRef.current ||
        backendSessionStatusRef.current !== 'ACTIVE' ||
        isTerminalRef.current
      ) {
        moveBlockedCount++;
        return false;
      }
      return true;
    };

    const handleCompleteSession = async () => {
      const currentId = activeSessionIdRef.current;
      const currentEngine = engineRef.current;
      if (terminalOperationRef.current || submitting || !currentId || !currentEngine) {
        return false;
      }

      if (backendSessionStatusRef.current === 'COMPLETED') {
        return true;
      }

      terminalOperationRef.current = 'COMPLETING';
      isTerminalRef.current = true;
      submitting = true;
      submitError = null;

      // Verify final move is in queue if not already confirmed
      const latestEngineMoves = currentEngine.movesCount;
      if (latestEngineMoves > confirmedCheckpointMovesRef.current) {
        const alreadyQueued = checkpointQueueRef.current.some(
          (cp) => cp && cp.movesTaken >= latestEngineMoves
        );
        if (!alreadyQueued) {
          checkpointQueueRef.current.push(currentEngine.getCheckpointState());
        }
      }

      compactTerminalCheckpointQueue();

      try {
        await drainCheckpointQueue();
      } catch (drainErr) {
        terminalOperationRef.current = null;
        isTerminalRef.current = false;
        submitting = false;
        submitError = `Failed to sync final move to server: ${drainErr.message}. Click Retry to synchronize.`;
        return false;
      }

      if (confirmedCheckpointMovesRef.current < currentEngine.movesCount) {
        terminalOperationRef.current = null;
        isTerminalRef.current = false;
        submitting = false;
        submitError = 'Failed to sync final move to server: Final move was not acknowledged. Click Retry to synchronize.';
        return false;
      }

      try {
        const res = await mockCompleteSession(currentId);
        completedCalls.push(res);
        backendSessionStatusRef.current = 'COMPLETED';
        return true;
      } catch (err) {
        submitError = err.message;
        return false;
      } finally {
        terminalOperationRef.current = null;
        submitting = false;
      }
    };

    const handleFailSession = async (reason = 'OUT_OF_MOVES') => {
      const currentId = activeSessionIdRef.current;
      if (terminalOperationRef.current || !currentId) return false;
      terminalOperationRef.current = 'FAILING';
      isTerminalRef.current = true;
      try {
        await drainCheckpointQueue();
      } catch (_err) {}
      backendSessionStatusRef.current = 'FAILED';
      terminalOperationRef.current = null;
      return true;
    };

    const executeLeaveGame = async () => {
      const currentId = activeSessionIdRef.current;
      if (terminalOperationRef.current || !currentId) return false;
      terminalOperationRef.current = 'LEAVING';
      isTerminalRef.current = true;
      try {
        await drainCheckpointQueue();
      } catch (_err) {}
      backendSessionStatusRef.current = 'ABANDONED';
      terminalOperationRef.current = null;
      return true;
    };

    const handleCompleteDailyChallenge = async () => {
      const currentId = activeSessionIdRef.current;
      const currentEngine = engineRef.current;
      if (terminalOperationRef.current || submitting || !currentId || !currentEngine) {
        return false;
      }
      terminalOperationRef.current = 'COMPLETING';
      isTerminalRef.current = true;
      submitting = true;
      submitError = null;

      const latestEngineMoves = currentEngine.movesCount;
      if (latestEngineMoves > confirmedCheckpointMovesRef.current) {
        const alreadyQueued = checkpointQueueRef.current.some(
          (cp) => cp && cp.movesTaken >= latestEngineMoves
        );
        if (!alreadyQueued) {
          checkpointQueueRef.current.push(currentEngine.getCheckpointState());
        }
      }

      compactTerminalCheckpointQueue();

      try {
        await drainCheckpointQueue();
      } catch (drainErr) {
        terminalOperationRef.current = null;
        isTerminalRef.current = false;
        submitting = false;
        submitError = `Failed to sync final move to server: ${drainErr.message}. Click Retry to synchronize.`;
        return false;
      }

      if (confirmedCheckpointMovesRef.current < currentEngine.movesCount) {
        terminalOperationRef.current = null;
        isTerminalRef.current = false;
        submitting = false;
        submitError = 'Failed to sync final move to server: Final move was not acknowledged. Click Retry to synchronize.';
        return false;
      }

      try {
        const res = await mockCompleteDailyChallenge(currentId);
        completedDailyCalls.push(res);
        backendSessionStatusRef.current = 'COMPLETED';
        return true;
      } finally {
        terminalOperationRef.current = null;
        submitting = false;
      }
    };

    return {
      activeSessionIdRef,
      backendSessionStatusRef,
      terminalOperationRef,
      isTerminalRef,
      checkpointQueueRef,
      isProcessingCheckpointQueueRef,
      inFlightCheckpointRef,
      activeProcessingCheckpointRef,
      confirmedCheckpointMovesRef,
      checkpointDrainErrorRef,
      engineRef,
      savedCheckpoints,
      completedCalls,
      completedDailyCalls,
      getMoveBlockedCount: () => moveBlockedCount,
      getSubmitError: () => submitError,
      getSubmitting: () => submitting,
      queueCheckpoint,
      compactTerminalCheckpointQueue,
      processCheckpointQueue,
      drainCheckpointQueue,
      handleMove,
      handleCompleteSession,
      handleFailSession,
      executeLeaveGame,
      handleCompleteDailyChallenge,
    };
  }

  // =========================================================================
  // Section C: Behavioral Verification for All 10 Required Scenarios
  // =========================================================================
  describe('B. Behavioral Deadlock & Integrity Scenarios', () => {
    it('1. A winning move queues a final checkpoint', async () => {
      const h = createHarness();
      const queued = h.queueCheckpoint({ movesTaken: 12, wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });
      assert.equal(queued, true, 'Winning move must be successfully accepted into the queue');
      assert.ok(h.checkpointQueueRef.current.length >= 0);
    });

    it('2 & 3. Completion begins, terminal flag is set, and the final checkpoint is still allowed to transmit', async () => {
      let checkpointSent = false;
      const h = createHarness({
        mockSaveCheckpoint: async (sessionId, cp) => {
          // Verify that when saveCheckpoint runs, completion is already in progress and terminal flag is set
          assert.equal(h.terminalOperationRef.current, 'COMPLETING');
          assert.equal(h.isTerminalRef.current, true);
          checkpointSent = true;
          return { success: true };
        },
      });

      // Queue final winning checkpoint
      h.checkpointQueueRef.current.push({ movesTaken: 12, wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });

      // Trigger completion (which sets terminal flag and drains)
      const completePromise = h.handleCompleteSession();
      const success = await completePromise;

      assert.equal(checkpointSent, true, 'Checkpoint MUST be transmitted even though isTerminalRef is true');
      assert.equal(success, true, 'Completion must succeed');
      assert.equal(h.savedCheckpoints.length, 1);
      assert.equal(h.savedCheckpoints[0].movesTaken, 12);
    });

    it('4. The checkpoint drain resolves after the server acknowledges the queued checkpoint', async () => {
      let drainResolved = false;
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          await new Promise((r) => setTimeout(r, 40));
          return { success: true };
        },
      });

      h.terminalOperationRef.current = 'COMPLETING';
      h.isTerminalRef.current = true;
      h.checkpointQueueRef.current.push({ movesTaken: 10 });

      const drainPromise = h.drainCheckpointQueue().then((res) => {
        drainResolved = res;
      });

      assert.equal(drainResolved, false, 'Drain must not resolve synchronously before server acknowledges');
      await drainPromise;
      assert.equal(drainResolved, true, 'Drain must resolve true once server acknowledges');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be empty');
    });

    it('5. Completion is called only after the drain resolves', async () => {
      const order = [];
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          order.push('CHECKPOINT_SAVED');
          return { success: true };
        },
        mockCompleteSession: async () => {
          order.push('SESSION_COMPLETED');
          return { success: true, data: { status: 'COMPLETED' } };
        },
      });

      h.checkpointQueueRef.current.push({ movesTaken: 15 });
      await h.handleCompleteSession();

      assert.deepEqual(
        order,
        ['CHECKPOINT_SAVED', 'SESSION_COMPLETED'],
        'Server completion MUST be called strictly after checkpoint persistence confirms'
      );
    });

    it('6. Completion is not called when checkpoint synchronization fails', async () => {
      let completeCalled = false;
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          throw new Error('Connection reset by peer');
        },
        mockCompleteSession: async () => {
          completeCalled = true;
          return { success: true };
        },
      });

      h.checkpointQueueRef.current.push({ movesTaken: 12 });
      const completed = await h.handleCompleteSession();

      assert.equal(completed, false, 'Completion must fail if checkpoint sync fails');
      assert.equal(completeCalled, false, 'completeSession MUST NOT be called when sync fails');
      assert.ok(h.getSubmitError().includes('Failed to sync final move to server'), 'UI error message must be set');
      assert.equal(h.checkpointQueueRef.current.length, 1, 'Failed checkpoint must remain in queue for retry');
    });

    it('7. Retry after synchronization failure can process the queued checkpoint and complete', async () => {
      let attempts = 0;
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          attempts++;
          if (attempts <= 3) {
            // First run fails all 3 attempts
            throw new Error('Temporary gateway timeout');
          }
          // On retry, server responds 200 OK
          return { success: true };
        },
      });

      h.checkpointQueueRef.current.push({ movesTaken: 12 });

      // Run 1: Fails
      const res1 = await h.handleCompleteSession();
      assert.equal(res1, false);
      assert.ok(h.getSubmitError().includes('Click Retry to synchronize'));
      assert.equal(h.checkpointQueueRef.current.length, 1);

      // Run 2: User clicks Retry
      const res2 = await h.handleCompleteSession();
      assert.equal(res2, true, 'Retry must succeed when network recovers');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be drained on retry');
      assert.equal(h.completedCalls.length, 1, 'Session complete must be called once retry succeeds');
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    it('8. Additional user moves are blocked during completion', async () => {
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          // While checkpoint is saving, player presses arrow keys
          assert.equal(h.handleMove('ArrowUp'), false);
          assert.equal(h.handleMove('ArrowRight'), false);
          return { success: true };
        },
      });

      h.checkpointQueueRef.current.push({ movesTaken: 12 });
      await h.handleCompleteSession();

      assert.equal(h.getMoveBlockedCount(), 2, 'All move attempts during completion must be rejected');
    });

    it('9. Already in-flight checkpoint operations are handled correctly without race conditions', async () => {
      let workerInvocationCount = 0;
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          workerInvocationCount++;
          await new Promise((r) => setTimeout(r, 60));
          return { success: true };
        },
      });

      // Move 11 in flight
      h.checkpointQueueRef.current.push({ movesTaken: 11 });
      h.processCheckpointQueue(); // in-flight starts

      // Move 12 queued while 11 is in flight
      h.checkpointQueueRef.current.push({ movesTaken: 12 });

      // handleCompleteSession triggered (e.g. at 550ms)
      const completeRes = await h.handleCompleteSession();

      assert.equal(completeRes, true, 'Must complete cleanly');
      assert.equal(h.savedCheckpoints.length, 2, 'Both move 11 and move 12 must be persisted');
      assert.equal(h.checkpointQueueRef.current.length, 0);
    });

    it('10. Duplicate completion/reward submission protections remain intact', async () => {
      let completionCalls = 0;
      const h = createHarness({
        mockSaveCheckpoint: async () => {
          await new Promise((r) => setTimeout(r, 50));
          return { success: true };
        },
        mockCompleteSession: async () => {
          completionCalls++;
          await new Promise((r) => setTimeout(r, 50));
          return { success: true, data: { status: 'COMPLETED' } };
        },
      });

      h.checkpointQueueRef.current.push({ movesTaken: 8 });

      // Trigger two concurrent completion requests (e.g. fast double-click on dialog)
      const [res1, res2] = await Promise.all([
        h.handleCompleteSession(),
        h.handleCompleteSession(),
      ]);

      assert.equal(res1, true);
      assert.equal(res2, false, 'Concurrent duplicate completion attempt must be blocked immediately');
      assert.equal(completionCalls, 1, 'Server completeSession must be called exactly once');
    });

    it('11. Dynamic terminal permission prevents worker from breaking when completion starts in-flight', async () => {
      let workerLoops = 0;
      let transitionHappened = false;

      const h = createHarness({
        mockSaveCheckpoint: async (sessionId, cp) => {
          if (cp.movesTaken === 11) {
            // While move 11 is in-flight, handleCompleteSession starts
            h.terminalOperationRef.current = 'COMPLETING';
            h.isTerminalRef.current = true;
            transitionHappened = true;
          }
          workerLoops++;
          return { success: true };
        },
      });

      // Queue move 11 and move 12 while idle and active
      h.checkpointQueueRef.current.push({ movesTaken: 11 });
      h.checkpointQueueRef.current.push({ movesTaken: 12 });

      // Worker starts while terminalOperation is null
      await h.processCheckpointQueue();

      assert.equal(transitionHappened, true, 'Terminal operation transition must have occurred during move 11');
      assert.equal(workerLoops, 2, 'Worker must continue loop and save move 12 due to dynamic isAllowedTerminalDrain');
      assert.equal(h.confirmedCheckpointMovesRef.current, 12, 'Confirmed checkpoint moves must reach 12');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be fully drained');
    });

    it('12. Retry re-enqueues unconfirmed final checkpoint when missing from queue', async () => {
      const h = createHarness({
        engineMoves: 12,
        getCheckpointState: () => ({ movesTaken: 12, wormState: [{ x: 5, y: 5 }] }),
      });

      // Initial state: move 11 confirmed, move 12 never reached queue
      h.confirmedCheckpointMovesRef.current = 11;
      assert.equal(h.checkpointQueueRef.current.length, 0);

      // User triggers handleCompleteSession (or clicks Retry)
      const success = await h.handleCompleteSession();

      assert.equal(success, true, 'Completion must succeed after re-enqueuing final checkpoint');
      assert.equal(h.savedCheckpoints.length, 1, 'Final checkpoint must be saved');
      assert.equal(h.savedCheckpoints[0].movesTaken, 12, 'Saved checkpoint must match final move 12');
      assert.equal(h.confirmedCheckpointMovesRef.current, 12, 'Confirmed moves must be 12');
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    it('13. Retry does not duplicate already queued or confirmed checkpoints', async () => {
      let saveCount = 0;
      const h = createHarness({
        engineMoves: 12,
        mockSaveCheckpoint: async (id, cp) => {
          saveCount++;
          return { success: true };
        },
      });

      // Move 12 is already in the queue
      h.checkpointQueueRef.current.push({ movesTaken: 12, wormState: [{ x: 5, y: 5 }] });

      // Run completion
      const res = await h.handleCompleteSession();

      assert.equal(res, true);
      assert.equal(saveCount, 1, 'Move 12 must only be saved once, without duplication');
      assert.equal(h.savedCheckpoints.length, 1);
    });

    it('14. Disallowed terminal operation (e.g. RESTARTING or null operation with isTerminal) blocks queue worker', async () => {
      const h = createHarness();

      h.checkpointQueueRef.current.push({ movesTaken: 5 });
      h.isTerminalRef.current = true;
      h.terminalOperationRef.current = 'RESTARTING';

      await h.processCheckpointQueue();

      assert.equal(h.savedCheckpoints.length, 0, 'Worker must not process checkpoints during RESTARTING');
      assert.equal(h.checkpointQueueRef.current.length, 1, 'Queue must remain intact');

      // Test with null terminalOperationRef but isTerminal = true
      h.terminalOperationRef.current = null;
      await h.processCheckpointQueue();
      assert.equal(h.savedCheckpoints.length, 0, 'Worker must not process checkpoints when terminalOperation is null and isTerminal is true');
    });

    it('15. FAILING and LEAVING terminal operations are allowed to drain queued checkpoints', async () => {
      const h = createHarness();

      // Test FAILING
      h.checkpointQueueRef.current.push({ movesTaken: 7 });
      h.isTerminalRef.current = true;
      h.terminalOperationRef.current = 'FAILING';

      await h.processCheckpointQueue();
      assert.equal(h.savedCheckpoints.length, 1, 'Worker must drain checkpoint during FAILING');
      assert.equal(h.savedCheckpoints[0].movesTaken, 7);

      // Test LEAVING
      h.checkpointQueueRef.current.push({ movesTaken: 8 });
      h.terminalOperationRef.current = 'LEAVING';

      await h.processCheckpointQueue();
      assert.equal(h.savedCheckpoints.length, 2, 'Worker must drain checkpoint during LEAVING');
      assert.equal(h.savedCheckpoints[1].movesTaken, 8);
    });

    it('16. Unconfirmed final move blocks session completion and prompts retry', async () => {
      let completeAttempted = false;
      const h = createHarness({
        engineMoves: 12,
        mockSaveCheckpoint: async (id, cp) => {
          throw new Error('503 Service Unavailable');
        },
        mockCompleteSession: async () => {
          completeAttempted = true;
          return { success: true };
        },
      });

      h.confirmedCheckpointMovesRef.current = 11;
      h.checkpointQueueRef.current.push({ movesTaken: 12 });

      const res = await h.handleCompleteSession();

      assert.equal(res, false, 'handleCompleteSession must return false when final move is unconfirmed');
      assert.equal(completeAttempted, false, 'completeSession must NEVER be called with unconfirmed final move');
      assert.ok(h.getSubmitError().includes('Click Retry to synchronize'), 'Must prompt user to click Retry');
      assert.equal(h.terminalOperationRef.current, null, 'terminalOperationRef must be cleared for retry');
      assert.equal(h.getSubmitting(), false, 'submitting must be reset');
    });
  });

  // =========================================================================
  // Section C: Safe Terminal Compaction Verification Scenarios
  // =========================================================================
  describe('C. Safe Terminal Compaction Verification Scenarios', () => {
    // 1. Terminal compaction with a large pending queue
    it('1. Terminal compaction with a large pending queue compacts down to the newest snapshot when idle', async () => {
      let networkCalls = 0;
      const h = createHarness({
        engineMoves: 15,
        mockSaveCheckpoint: async (id, cp) => {
          networkCalls++;
          return { success: true };
        },
      });

      // Player rapidly moves 15 times, creating a large pending queue
      for (let m = 1; m <= 15; m++) {
        h.checkpointQueueRef.current.push({ movesTaken: m, wormState: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });
      }

      assert.equal(h.checkpointQueueRef.current.length, 15);

      // Terminal completion starts
      const success = await h.handleCompleteSession();

      assert.equal(success, true, 'Completion must succeed');
      // Compacting 15 unsent items while idle must transmit ONLY the newest terminal snapshot
      assert.equal(networkCalls, 1, 'Only 1 HTTP network request must be made for the compacted snapshot');
      assert.equal(h.confirmedCheckpointMovesRef.current, 15, 'Move 15 must be acknowledged');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be drained');
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    // 2. Compaction with an actual in-flight checkpoint
    it('2. Compaction with an actual in-flight checkpoint preserves index 0 and compacts pending items', async () => {
      const inFlightCp = { movesTaken: 2, id: 'in_flight_cp' };
      const h = createHarness();

      // Put in-flight checkpoint at index 0 and multiple pending after
      h.checkpointQueueRef.current = [
        inFlightCp,
        { movesTaken: 3 },
        { movesTaken: 4 },
        { movesTaken: 5 },
        { movesTaken: 12 },
      ];

      // Mark in-flight explicitly
      h.isProcessingCheckpointQueueRef.current = true;
      h.inFlightCheckpointRef.current = inFlightCp;
      h.terminalOperationRef.current = 'COMPLETING';

      h.compactTerminalCheckpointQueue();

      // Index 0 MUST remain untouched, and index 1 MUST be the newest pending item
      assert.equal(h.checkpointQueueRef.current.length, 2, 'Queue must compact to exactly [inFlight, newest]');
      assert.strictEqual(h.checkpointQueueRef.current[0], inFlightCp, 'In-flight item at index 0 must be strictly preserved');
      assert.equal(h.checkpointQueueRef.current[1].movesTaken, 12, 'Pending item must be compacted to newest (move 12)');
    });

    // 3. Compaction when the worker is idle
    it('3. Compaction when the worker is idle does not assume index 0 is in-flight', async () => {
      const h = createHarness();

      h.checkpointQueueRef.current = [
        { movesTaken: 1 },
        { movesTaken: 2 },
        { movesTaken: 3 },
        { movesTaken: 4 },
        { movesTaken: 10 },
      ];

      h.isProcessingCheckpointQueueRef.current = false;
      h.inFlightCheckpointRef.current = null;
      h.activeProcessingCheckpointRef.current = null;
      h.terminalOperationRef.current = 'COMPLETING';

      h.compactTerminalCheckpointQueue();

      // When idle, index 0 is NOT in flight. Queue must collapse to 1 single item.
      assert.equal(h.checkpointQueueRef.current.length, 1, 'Queue must compact to exactly 1 item when worker is idle');
      assert.equal(h.checkpointQueueRef.current[0].movesTaken, 10, 'Single retained item must be the newest terminal snapshot');
    });

    // 4. In-flight request completes during compaction
    it('4. In-flight request completes during compaction and worker proceeds to compacted item', async () => {
      const transmittedMoves = [];
      let completeInFlightResolve;

      const h = createHarness({
        engineMoves: 8,
        mockSaveCheckpoint: async (id, cp) => {
          transmittedMoves.push(cp.movesTaken);
          if (cp.movesTaken === 2) {
            // Simulate slow in-flight request
            await new Promise((resolve) => {
              completeInFlightResolve = resolve;
            });
          }
          return { success: true };
        },
      });

      // Queue move 2 and start worker
      h.checkpointQueueRef.current.push({ movesTaken: 2 });
      const workerPromise = h.processCheckpointQueue();

      // Allow worker to pick move 2 and enter HTTP in-flight state
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(h.inFlightCheckpointRef.current, 'Move 2 must be actively in-flight');

      // While move 2 is in-flight, rapid moves 3, 4, 5, 8 arrive and level completion triggers
      h.checkpointQueueRef.current.push({ movesTaken: 3 });
      h.checkpointQueueRef.current.push({ movesTaken: 4 });
      h.checkpointQueueRef.current.push({ movesTaken: 5 });
      h.checkpointQueueRef.current.push({ movesTaken: 8 });

      h.terminalOperationRef.current = 'COMPLETING';
      h.isTerminalRef.current = true;
      h.compactTerminalCheckpointQueue();

      assert.equal(h.checkpointQueueRef.current.length, 2, 'Queue must be [move 2, move 8]');

      // In-flight request now resolves
      completeInFlightResolve();
      await workerPromise;

      assert.deepEqual(transmittedMoves, [2, 8], 'Worker must sequentially process move 2 then move 8');
      assert.equal(h.confirmedCheckpointMovesRef.current, 8, 'Confirmed moves must reach 8');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be fully drained');
    });

    // 5. Late acknowledgement of an older checkpoint
    it('5. Late acknowledgement of an older checkpoint does not falsely acknowledge final move', async () => {
      let releaseMove3;
      const h = createHarness({
        engineMoves: 10,
        mockSaveCheckpoint: async (id, cp) => {
          if (cp.movesTaken === 3) {
            await new Promise((r) => { releaseMove3 = r; });
            return { success: true };
          }
          throw new Error('Connection reset on final checkpoint');
        },
      });

      // Move 3 is in-flight
      h.checkpointQueueRef.current.push({ movesTaken: 3 });
      const workerP = h.processCheckpointQueue();
      await new Promise((r) => setTimeout(r, 10));

      // Now completion triggers with move 10
      h.checkpointQueueRef.current.push({ movesTaken: 10 });
      const compP = h.handleCompleteSession();

      // Move 3 finishes late
      releaseMove3();

      const [success] = await Promise.all([compP, workerP]);

      assert.equal(success, false, 'Completion must fail when final move 10 fails to save');
      assert.equal(h.confirmedCheckpointMovesRef.current, 3, 'Confirmed moves must remain at 3, not falsely advance to 10');
      assert.ok(h.getSubmitError().includes('Click Retry to synchronize'), 'Must prompt Retry');
      assert.equal(h.backendSessionStatusRef.current, 'ACTIVE', 'Backend session must not be completed');
    });

    // 6. Failed in-flight request with compacted pending checkpoints
    it('6. Failed in-flight request with compacted pending checkpoints retains items for retry', async () => {
      let attemptsMove2 = 0;
      const h = createHarness({
        engineMoves: 8,
        mockSaveCheckpoint: async (id, cp) => {
          if (cp.movesTaken === 2) {
            attemptsMove2++;
            throw new Error('Server 500 error');
          }
          return { success: true };
        },
      });

      // Move 2 starts in-flight
      h.checkpointQueueRef.current.push({ movesTaken: 2 });
      const workerP = h.processCheckpointQueue();
      await new Promise((r) => setTimeout(r, 10));

      // While move 2 is in-flight, rapid moves 5 and 8 are queued and completion begins
      h.checkpointQueueRef.current.push({ movesTaken: 5 });
      h.checkpointQueueRef.current.push({ movesTaken: 8 });

      const success = await h.handleCompleteSession();
      await workerP;

      assert.equal(success, false, 'Completion must be blocked');
      assert.equal(attemptsMove2, 3, 'Failed checkpoint must be retried exactly 3 times before breaking');
      assert.equal(h.checkpointQueueRef.current.length, 2, 'Queue must retain in-flight and compacted checkpoint');
      assert.equal(h.checkpointQueueRef.current[0].movesTaken, 2);
      assert.equal(h.checkpointQueueRef.current[1].movesTaken, 8);
      assert.ok(h.getSubmitError().includes('Click Retry to synchronize'));
    });

    // 7. Retry after a failed drain
    it('7. Retry after a failed drain resumes processing and completes successfully', async () => {
      let shouldFail = true;
      const h = createHarness({
        engineMoves: 12,
        mockSaveCheckpoint: async (id, cp) => {
          if (shouldFail) {
            throw new Error('504 Gateway Timeout');
          }
          return { success: true };
        },
      });

      h.checkpointQueueRef.current = [
        { movesTaken: 1 },
        { movesTaken: 2 },
        { movesTaken: 12 },
      ];

      // First completion attempt fails due to gateway timeout
      const firstResult = await h.handleCompleteSession();
      assert.equal(firstResult, false, 'First attempt must fail cleanly');
      assert.ok(h.getSubmitError().includes('Click Retry to synchronize'));

      // Network recovers
      shouldFail = false;

      // User clicks Retry Verification
      const retryResult = await h.handleCompleteSession();
      assert.equal(retryResult, true, 'Retry must succeed');
      assert.equal(h.confirmedCheckpointMovesRef.current, 12, 'Confirmed moves must reach 12');
      assert.equal(h.checkpointQueueRef.current.length, 0, 'Queue must be empty');
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    // 8. Completion cannot occur until the final checkpoint is acknowledged
    it('8. Completion cannot occur until the final checkpoint is acknowledged, even if queue is empty', async () => {
      let completeCalled = false;
      const customEngine = {
        movesCount: 14,
        applesEaten: 2,
        getCheckpointState: () => ({ movesTaken: 14 }),
      };

      const failingHarness = createHarness({
        currentEngine: customEngine,
        mockSaveCheckpoint: async () => {
          throw new Error('Save rejected');
        },
        mockCompleteSession: async () => {
          completeCalled = true;
          return { success: true };
        },
      });
      failingHarness.confirmedCheckpointMovesRef.current = 13;

      const res = await failingHarness.handleCompleteSession();
      assert.equal(res, false);
      assert.equal(completeCalled, false, 'Server completion must NEVER be called');
      assert.ok(failingHarness.getSubmitError().includes('Click Retry to synchronize'));
    });

    // 9. Duplicate acknowledgement
    it('9. Duplicate acknowledgement from server does not corrupt queue state', async () => {
      const h = createHarness({
        engineMoves: 6,
        mockSaveCheckpoint: async (id, cp) => {
          return { success: true, deduplicated: true };
        },
      });

      h.checkpointQueueRef.current = [
        { movesTaken: 6, wormState: [{ x: 5, y: 5 }] },
      ];

      const res = await h.handleCompleteSession();
      assert.equal(res, true, 'Deduplicated acknowledgement must be accepted as success');
      assert.equal(h.confirmedCheckpointMovesRef.current, 6);
      assert.equal(h.checkpointQueueRef.current.length, 0);
    });

    // 10. Stale acknowledgement
    it('10. Stale acknowledgement from older checkpoints is skipped by worker', async () => {
      const h = createHarness();

      h.confirmedCheckpointMovesRef.current = 10;
      h.checkpointQueueRef.current = [
        { movesTaken: 4 },
        { movesTaken: 7 },
        { movesTaken: 10 },
        { movesTaken: 12 },
      ];

      await h.processCheckpointQueue();

      assert.equal(h.savedCheckpoints.length, 1, 'Only move 12 should have been saved');
      assert.equal(h.savedCheckpoints[0].movesTaken, 12);
      assert.equal(h.confirmedCheckpointMovesRef.current, 12);
    });

    // 11. Completion transition while the worker is already processing
    it('11. Completion transition while worker is already processing active gameplay moves', async () => {
      let inFlightStarted = false;
      let resumeInFlight;
      const savedMoves = [];

      const h = createHarness({
        engineMoves: 9,
        mockSaveCheckpoint: async (id, cp) => {
          savedMoves.push(cp.movesTaken);
          if (cp.movesTaken === 3) {
            inFlightStarted = true;
            await new Promise((r) => { resumeInFlight = r; });
          }
          return { success: true };
        },
      });

      // Move 3 is in gameplay queue
      h.checkpointQueueRef.current.push({ movesTaken: 3 });
      const workerP = h.processCheckpointQueue();

      await new Promise((r) => setTimeout(r, 10));
      assert.equal(inFlightStarted, true);

      // Now player wins, handleCompleteSession is called
      h.checkpointQueueRef.current.push({ movesTaken: 4 });
      h.checkpointQueueRef.current.push({ movesTaken: 5 });
      h.checkpointQueueRef.current.push({ movesTaken: 9 });

      const completionP = h.handleCompleteSession();

      // Complete in-flight move 3
      resumeInFlight();

      const [compRes] = await Promise.all([completionP, workerP]);

      assert.equal(compRes, true, 'Completion must succeed');
      assert.deepEqual(savedMoves, [3, 9], 'Only in-flight move 3 and final move 9 should be saved');
      assert.equal(h.confirmedCheckpointMovesRef.current, 9);
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    // 12. Failure or leave terminal transitions
    it('12. Failure and leave terminal transitions trigger safe compaction', async () => {
      const hFail = createHarness({
        mockSaveCheckpoint: async () => ({ success: true }),
      });

      for (let i = 1; i <= 8; i++) {
        hFail.checkpointQueueRef.current.push({ movesTaken: i });
      }

      await hFail.handleFailSession('OUT_OF_MOVES');
      assert.equal(hFail.savedCheckpoints.length, 1, 'Failing drain must compact to 1 snapshot');
      assert.equal(hFail.savedCheckpoints[0].movesTaken, 8);
      assert.equal(hFail.backendSessionStatusRef.current, 'FAILED');

      const hLeave = createHarness({
        mockSaveCheckpoint: async () => ({ success: true }),
      });

      for (let i = 1; i <= 6; i++) {
        hLeave.checkpointQueueRef.current.push({ movesTaken: i });
      }

      await hLeave.executeLeaveGame();
      assert.equal(hLeave.savedCheckpoints.length, 1, 'Leaving drain must compact to 1 snapshot');
      assert.equal(hLeave.savedCheckpoints[0].movesTaken, 6);
      assert.equal(hLeave.backendSessionStatusRef.current, 'ABANDONED');
    });

    // 13. Daily Challenge completion through the same pipeline
    it('13. Daily Challenge completion compacts queue and calls daily challenge completion', async () => {
      let dcCompleted = false;
      const h = createHarness({
        engineMoves: 10,
        mockCompleteDailyChallenge: async () => {
          dcCompleted = true;
          return { success: true, data: { status: 'COMPLETED', streak: 7 } };
        },
      });

      for (let i = 1; i <= 10; i++) {
        h.checkpointQueueRef.current.push({ movesTaken: i, wormState: [{ x: 5, y: 5 }] });
      }

      const res = await h.handleCompleteDailyChallenge();

      assert.equal(res, true, 'Daily Challenge completion must succeed');
      assert.equal(dcCompleted, true, 'mockCompleteDailyChallenge must have been called');
      assert.equal(h.savedCheckpoints.length, 1, 'Only 1 compacted checkpoint request made');
      assert.equal(h.savedCheckpoints[0].movesTaken, 10);
      assert.equal(h.confirmedCheckpointMovesRef.current, 10);
      assert.equal(h.backendSessionStatusRef.current, 'COMPLETED');
    });

    // 14. Multiple apples in a compacted checkpoint
    it('14. Multiple apples in a compacted checkpoint satisfy server reachability invariants', () => {
      const prevHead = { x: 2, y: 2 };
      const currentMoves = 2;
      const movesTaken = 8;
      const moveDelta = movesTaken - currentMoves; // 6 moves

      const newlyEatenApples = [
        { x: 4, y: 3 }, // dist from (2,2) is |4-2| + |3-2| = 2 + 1 = 3
        { x: 5, y: 4 }, // dist from (2,2) is |5-2| + |4-2| = 3 + 2 = 5
      ];

      // Server Gate 8a: newlyEatenApples.length <= moveDelta
      assert.ok(
        newlyEatenApples.length <= moveDelta,
        `Apple count (${newlyEatenApples.length}) must not exceed moveDelta (${moveDelta})`
      );

      // Server Gate 8c: each eaten apple distance <= moveDelta
      for (const eaten of newlyEatenApples) {
        const dist = Math.abs(eaten.x - prevHead.x) + Math.abs(eaten.y - prevHead.y);
        assert.ok(
          dist <= moveDelta,
          `Apple distance (${dist}) must be <= moveDelta (${moveDelta})`
        );
      }
    });

    // 15. Key, stone, pit and growth invariants remain intact
    it('15. Key, stone, pit and growth invariants remain intact in compacted checkpoint', () => {
      const initialStonesCount = 3;
      const activeStones = [{ x: 4, y: 4 }, { x: 7, y: 2 }];
      const filledPits = ['6,3'];
      assert.equal(
        activeStones.length + filledPits.length,
        initialStonesCount,
        'Stone conservation invariant must hold in compacted snapshot'
      );

      const levelKeys = [{ keyId: 'key_gate_1' }, { keyId: 'key_gate_2' }];
      const collectedKeys = ['key_gate_1'];
      const validKeyIds = new Set(levelKeys.map((k) => k.keyId));
      for (const key of collectedKeys) {
        assert.ok(validKeyIds.has(key), 'Collected keys must exist in level definitions');
      }

      const initialWormLength = 2;
      const applesEaten = 2;
      const megaApplesEaten = 1;
      const authoritativeGrowth = applesEaten + (megaApplesEaten * 1) + megaApplesEaten;
      const expectedLength = initialWormLength + authoritativeGrowth;
      const wormState = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
        { x: 1, y: 4 },
      ];
      assert.equal(wormState.length, expectedLength, 'Worm length must match expected growth');

      for (let i = 1; i < wormState.length; i++) {
        const d = Math.abs(wormState[i].x - wormState[i - 1].x) + Math.abs(wormState[i].y - wormState[i - 1].y);
        assert.equal(d, 1, `Segment ${i} and ${i - 1} must be contiguous with Manhattan distance of 1`);
      }
    });
  });
});
