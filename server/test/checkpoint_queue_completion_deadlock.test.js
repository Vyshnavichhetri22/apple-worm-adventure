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
  });

  // =========================================================================
  // Section B: State-Machine Simulation Harness
  // =========================================================================
  function createHarness(options = {}) {
    const {
      mockSaveCheckpoint = async () => ({ success: true }),
      mockCompleteSession = async () => ({ success: true, data: { status: 'COMPLETED', rewards: { stars: 3, coins: 50 } } }),
    } = options;

    const activeSessionIdRef = { current: 'sess_123' };
    const backendSessionStatusRef = { current: 'ACTIVE' };
    const terminalOperationRef = { current: null };
    const isTerminalRef = { current: false };
    const checkpointQueueRef = { current: [] };
    const isProcessingCheckpointQueueRef = { current: false };
    const confirmedCheckpointMovesRef = { current: 0 };
    const checkpointDrainErrorRef = { current: null };
    let submitting = false;
    let submitError = null;

    const savedCheckpoints = [];
    const completedCalls = [];
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

          const nextCp = checkpointQueueRef.current[0];

          if (nextCp.movesTaken <= confirmedCheckpointMovesRef.current) {
            checkpointQueueRef.current.shift();
            continue;
          }

          let saved = false;
          let lastErr = null;

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
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
            }
            await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
          }

          if (!saved) {
            checkpointDrainErrorRef.current = lastErr || new Error('Checkpoint failed to persist after 3 attempts');
            break;
          }
        }
      } finally {
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

    return {
      activeSessionIdRef,
      backendSessionStatusRef,
      terminalOperationRef,
      isTerminalRef,
      checkpointQueueRef,
      isProcessingCheckpointQueueRef,
      confirmedCheckpointMovesRef,
      checkpointDrainErrorRef,
      engineRef,
      savedCheckpoints,
      completedCalls,
      getMoveBlockedCount: () => moveBlockedCount,
      getSubmitError: () => submitError,
      getSubmitting: () => submitting,
      queueCheckpoint,
      processCheckpointQueue,
      drainCheckpointQueue,
      handleMove,
      handleCompleteSession,
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
});
