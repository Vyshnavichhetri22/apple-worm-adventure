/**
 * Procedural WebAudio Sound System for Apple Worm Adventure.
 * 
 * Generates all game sound effects procedurally using oscillators, noise buffers,
 * gain envelopes, and biquad filters. Zero external audio file dependencies.
 * Complies with browser autoplay policies by lazy-initializing the AudioContext
 * on the first user interaction.
 */

class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.hasUserInteracted = false;

    // Load persisted mute preference from localStorage
    try {
      const saved = localStorage.getItem('apple_worm_sfx_muted');
      if (saved !== null) {
        this.muted = saved === 'true';
      }
    } catch (_e) {
      this.muted = false;
    }
  }

  /**
   * Initializes or resumes the AudioContext on user gesture.
   */
  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.hasUserInteracted = true;
  }

  isMuted() {
    return this.muted;
  }

  setMuted(value) {
    this.muted = Boolean(value);
    try {
      localStorage.setItem('apple_worm_sfx_muted', String(this.muted));
    } catch (_e) {}
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Safe helper to execute an audio synthesis routine.
   * Catches any browser environment errors silently.
   */
  _play(fn) {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx || this.ctx.state !== 'running') return;
      fn(this.ctx, this.ctx.currentTime);
    } catch (_err) {
      // Graceful fallback: audio failure never interrupts gameplay
    }
  }

  /**
   * Procedural Apple Collection Chime:
   * Unique synthesized pitch and harmonic tone for each collectible apple type.
   */
  playAppleCollect(appleType = 'normal') {
    this._play((ctx, t) => {
      switch (appleType) {
        case 'golden': {
          // Bright dual bell with golden sparkle shimmer
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(880, t); // A5
          osc1.frequency.exponentialRampToValueAtTime(1320, t + 0.12);

          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(1760, t + 0.04);
          osc2.frequency.exponentialRampToValueAtTime(2640, t + 0.22);

          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start(t);
          osc2.start(t + 0.04);
          osc1.stop(t + 0.35);
          osc2.stop(t + 0.35);
          break;
        }

        case 'mega': {
          // Rich, resonant power chord for +2 mega growth
          [330, 440, 660].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.2);

            gain.gain.setValueAtTime(0.12, t + idx * 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(t + idx * 0.03);
            osc.stop(t + 0.32);
          });
          break;
        }

        case 'time': {
          // Crisp, high-frequency crystal ping (clock pulse)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1046, t); // C6
          osc.frequency.setValueAtTime(1568, t + 0.08); // G6

          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.25);
          break;
        }

        case 'mystery': {
          // Cosmic vibrato frequency modulation sweep
          const osc = ctx.createOscillator();
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          const gain = ctx.createGain();

          lfo.frequency.setValueAtTime(24, t);
          lfoGain.gain.setValueAtTime(60, t);
          lfo.connect(osc.frequency);

          osc.type = 'sine';
          osc.frequency.setValueAtTime(523, t);
          osc.frequency.exponentialRampToValueAtTime(1046, t + 0.28);

          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

          osc.connect(gain);
          gain.connect(ctx.destination);

          lfo.start(t);
          osc.start(t);
          lfo.stop(t + 0.32);
          osc.stop(t + 0.32);
          break;
        }

        case 'normal':
        default: {
          // Clean cheerful pop chime (F#5 -> A5)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(587, t);
          osc.frequency.exponentialRampToValueAtTime(880, t + 0.1);

          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.18);
          break;
        }
      }
    });
  }

  /**
   * Procedural Key Collection:
   * Bright, metallic ascending two-tone bell chime.
   */
  playKeyCollect() {
    this._play((ctx, t) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(1046.5, t); // C6
      osc1.frequency.exponentialRampToValueAtTime(1318.5, t + 0.1); // E6

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(2093, t + 0.08); // C7
      osc2.frequency.exponentialRampToValueAtTime(2637, t + 0.22); // E7

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t + 0.08);
      osc1.stop(t + 0.35);
      osc2.stop(t + 0.35);
    });
  }

  /**
   * Procedural Gate Unlocking:
   * Heavy stone sliding and mechanical latch opening.
   */
  playGateUnlock() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.18);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, t);
      filter.frequency.exponentialRampToValueAtTime(1800, t + 0.18);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  /**
   * Procedural Stone Push:
   * Earthy gravel scrape and low rumble.
   */
  playStonePush() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  /**
   * Procedural Pit Bridging / Stone Drop:
   * Deep hollow thud as the boulder fills the pit.
   */
  playPitFill() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);

      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  /**
   * Procedural Subtle Worm Movement Step:
   * Ultra-soft, low amplitude tap (non-intrusive).
   */
  playStep() {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.035);

      gain.gain.setValueAtTime(0.04, t); // Very quiet
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.035);
    });
  }

  /**
   * Procedural Hazard Collision / Failure Thud:
   * Punchy impact followed by descending chromatic bass drop.
   */
  playHazardCollision(reason = 'HIT_SPIKE') {
    this._play((ctx, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = reason === 'HIT_SPIKE' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, t);
      filter.frequency.exponentialRampToValueAtTime(120, t + 0.35);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  /**
   * Procedural Victory Fanfare:
   * Joyful 4-note ascending chord arpeggio with sparkling harmonic release.
   */
  playVictory() {
    this._play((ctx, t) => {
      // Arpeggio notes: C5, E5, G5, C6
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = t + i * 0.1;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.45);
      });

      // Shimmer chord release on C6
      const chord = [1046.5, 1318.5, 1568.0];
      chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = t + 0.42;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.7);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.7);
      });
    });
  }
}

export const audioManager = new AudioManager();
export default audioManager;
