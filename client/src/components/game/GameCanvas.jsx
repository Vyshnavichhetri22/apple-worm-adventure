import React, { useRef, useEffect } from 'react';

/**
 * Traces an organic 2-lobe indented apple silhouette path with top stem notch and bottom indent.
 * Centered around (cx, cy) with radius r.
 */
function traceApplePath(ctx, cx, cy, r) {
  ctx.beginPath();
  // Start at top stem indentation
  ctx.moveTo(cx, cy - r * 0.55);
  // Left shoulder lobe
  ctx.bezierCurveTo(cx - r * 0.45, cy - r * 0.95, cx - r * 1.05, cy - r * 0.6, cx - r * 0.95, cy + r * 0.1);
  // Left body down to bottom-left lobe
  ctx.bezierCurveTo(cx - r * 0.9, cy + r * 0.65, cx - r * 0.5, cy + r * 0.95, cx - r * 0.15, cy + r * 0.85);
  // Bottom indentation (calyx)
  ctx.lineTo(cx, cy + r * 0.75);
  // Bottom-right lobe
  ctx.lineTo(cx + r * 0.15, cy + r * 0.85);
  // Right body up to right shoulder lobe
  ctx.bezierCurveTo(cx + r * 0.5, cy + r * 0.95, cx + r * 0.9, cy + r * 0.65, cx + r * 0.95, cy + r * 0.1);
  // Right shoulder lobe back to top stem indentation
  ctx.bezierCurveTo(cx + r * 1.05, cy - r * 0.6, cx + r * 0.45, cy - r * 0.95, cx, cy - r * 0.55);
  ctx.closePath();
}

/**
 * Draws an organic tapered leaf with a curved spine.
 */
function drawLeaf(ctx, startX, startY, tipX, tipY, color, width) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo((startX + tipX) / 2 + width, (startY + tipY) / 2 - width, tipX, tipY);
  ctx.quadraticCurveTo((startX + tipX) / 2 - width, (startY + tipY) / 2 + width, startX, startY);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws an animated 4-point sparkle star.
 */
function drawSparkle(ctx, x, y, size, angle) {
  if (size <= 0.8) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(0, 0, size * 0.3, 0);
  ctx.quadraticCurveTo(0, 0, 0, size);
  ctx.quadraticCurveTo(0, 0, -size * 0.3, 0);
  ctx.quadraticCurveTo(0, 0, 0, -size);
  ctx.fill();

  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Resolves burst particle colors based on apple collectible type.
 */
function getParticleColors(type) {
  switch (type) {
    case 'golden':
      return { main: '#facc15', sparkle: '#fef08a' };
    case 'mega':
      return { main: '#d946ef', sparkle: '#f5d0fe' };
    case 'time':
      return { main: '#06b6d4', sparkle: '#cffafe' };
    case 'mystery':
      return { main: '#8b5cf6', sparkle: '#ede9fe' };
    case 'normal':
    default:
      return { main: '#ef4444', sparkle: '#fca5a5' };
  }
}

/**
 * Responsive HTML5 Canvas renderer for the Apple Worm grid.
 * Features Retina resolution scaling, textured obstacles, expressive worm facial
 * direction, swirling portal animations, organic animated floating apples, and particle bursts.
 */
export function GameCanvas({ engine, onMove, onCellClick }) {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const particlesRef = useRef([]);
  const floatingTextsRef = useRef([]);
  const prevApplesRef = useRef(null);
  const prevStatusRef = useRef(engine?.status || 'PLAYING');
  const prevKeysRef = useRef(engine?.collectedKeys?.size || 0);
  const prevPitsRef = useRef(engine?.filledPits?.size || 0);
  const shakeTimerRef = useRef(0);
  const shakeIntensityRef = useRef(0);
  const victoryTimerRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  // Touch & Swipe gesture tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const isSwipingRef = useRef(false);
  const lastSwipeTimeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;

    const ctx = canvas.getContext('2d');
    let portalAngle = 0;

    // Reset tracking on engine mount/switch
    prevApplesRef.current = engine.apples
      ? engine.apples.map((a) => ({ x: a.x, y: a.y, type: a.type || 'normal' }))
      : [];
    prevStatusRef.current = engine.status || 'PLAYING';
    prevKeysRef.current = engine.collectedKeys?.size || 0;
    prevPitsRef.current = engine.filledPits?.size || 0;
    shakeTimerRef.current = 0;
    victoryTimerRef.current = 0;
    floatingTextsRef.current = [];

    const render = () => {
      const { cols, rows, worm, direction, apples, stones, keys, obstacles, portal, filledPits } = engine;

      const now = performance.now();
      const dt = Math.min(50, Math.max(1, now - (lastTimeRef.current || now)));
      lastTimeRef.current = now;
      const timeSec = now / 1000;

      // 1. Calculate responsive cell size based on container dimensions
      const containerWidth = canvas.parentElement?.clientWidth || window.innerWidth || 400;
      const isMobileScreen = window.innerWidth <= 600 || window.innerHeight <= 700;
      const maxAvailableHeight = isMobileScreen
        ? Math.min(window.innerHeight * 0.44, 380)
        : window.innerHeight * 0.55;

      const horizontalPadding = isMobileScreen ? 8 : 16;
      const rawCellWidth = Math.floor((containerWidth - horizontalPadding) / cols);
      const rawCellHeight = Math.floor((maxAvailableHeight - 12) / rows);
      const minCell = cols > 14 ? 18 : 20;
      const cellSize = Math.max(minCell, Math.min(rawCellWidth, rawCellHeight, 46));

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = cols * cellSize;
      const displayHeight = rows * cellSize;

      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // State change detection: Screen shake on failure/hazard collision
      if (engine.status === 'FAILED' && prevStatusRef.current !== 'FAILED') {
        shakeTimerRef.current = 320;
        shakeIntensityRef.current = 6.5;

        // Spawn hazard impact particles at head position
        const failHead = worm[0];
        if (failHead) {
          const impactX = failHead.x * cellSize + cellSize / 2;
          const impactY = failHead.y * cellSize + cellSize / 2;
          const isSpike = engine.failureReason === 'HIT_SPIKE';
          for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spd = (cellSize * 0.05) * (0.8 + Math.random());
            particlesRef.current.push({
              x: impactX,
              y: impactY,
              vx: Math.cos(angle) * spd,
              vy: Math.sin(angle) * spd,
              size: cellSize * 0.08,
              color: isSpike ? '#ef4444' : '#f97316',
              sparkleColor: '#fef08a',
              maxLife: 380,
              age: 0,
            });
          }
        }
      }
      if (engine.status === 'WON' && prevStatusRef.current !== 'WON') {
        victoryTimerRef.current = 0;
      }
      prevStatusRef.current = engine.status;

      // Apply screen shake translation
      if (shakeTimerRef.current > 0) {
        shakeTimerRef.current -= dt;
        const progress = Math.max(0, shakeTimerRef.current / 320);
        const curIntensity = shakeIntensityRef.current * progress;
        const shakeX = (Math.random() - 0.5) * curIntensity * 2;
        const shakeY = (Math.random() - 0.5) * curIntensity * 2;
        ctx.translate(shakeX, shakeY);
      }

      // Background grid
      ctx.fillStyle = '#0f141c';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Subtle checkered tile pattern
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#141a24' : '#111720';
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }

      // Draw Moving Block Patrol Tracks
      obstacles.forEach((obs) => {
        if (obs.type === 'moving_block' && obs.range && obs.axis) {
          ctx.save();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);

          const startX = obs.x * cellSize + cellSize / 2;
          const startY = obs.y * cellSize + cellSize / 2;
          const endX = (obs.axis === 'horizontal' ? obs.x + obs.range : obs.x) * cellSize + cellSize / 2;
          const endY = (obs.axis === 'vertical' ? obs.y + obs.range : obs.y) * cellSize + cellSize / 2;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
          ctx.beginPath();
          ctx.arc(startX, startY, 2.5, 0, Math.PI * 2);
          ctx.arc(endX, endY, 2.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      });

      // Draw Obstacles (Walls, Spikes, Pits, Gates, Moving Blocks)
      obstacles.forEach((obs) => {
        const obsPos = obs.type === 'moving_block'
          ? (engine.getMovingBlockPosition ? engine.getMovingBlockPosition(obs, engine.moves) : { x: obs.x, y: obs.y })
          : { x: obs.x, y: obs.y };
        const x = obsPos.x * cellSize;
        const y = obsPos.y * cellSize;
        const isFilledPit = obs.type === 'pit' && filledPits.has(`${obs.x},${obs.y}`);

        if (obs.type === 'wall') {
          // Beveled stone brick
          ctx.fillStyle = '#334155';
          ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

          // Top/Left highlight
          ctx.fillStyle = '#475569';
          ctx.fillRect(x + 1, y + 1, cellSize - 2, 3);
          ctx.fillRect(x + 1, y + 1, 3, cellSize - 2);

          // Bottom/Right shadow
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x + 1, y + cellSize - 4, cellSize - 2, 3);
          ctx.fillRect(x + cellSize - 4, y + 1, 3, cellSize - 2);
        } else if (obs.type === 'moving_block') {
          // Dynamic Patrolling Industrial Hazard Block
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

          // Metallic body
          ctx.fillStyle = '#334155';
          ctx.fillRect(x + 3, y + 3, cellSize - 6, cellSize - 6);

          // Amber hazard warning border
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);

          // Direction chevron / axis symbol
          ctx.fillStyle = '#fbbf24';
          ctx.font = `bold ${Math.floor(cellSize * 0.42)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const symbol = obs.axis === 'horizontal' ? '◄►' : '▲▼';
          ctx.fillText(symbol, x + cellSize / 2, y + cellSize / 2);
        } else if (obs.type === 'spike') {
          // Hazardous red spikes
          ctx.fillStyle = '#dc2626';
          const half = cellSize / 2;
          ctx.beginPath();
          ctx.moveTo(x + half, y + 4);
          ctx.lineTo(x + cellSize - 3, y + cellSize - 2);
          ctx.lineTo(x + 3, y + cellSize - 2);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(x + half, y + 6);
          ctx.lineTo(x + half + 4, y + cellSize - 4);
          ctx.lineTo(x + half - 4, y + cellSize - 4);
          ctx.closePath();
          ctx.fill();
        } else if (obs.type === 'pit') {
          if (isFilledPit) {
            // Filled pit bridged by stone: textured solid cobblestone platform
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.38, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.arc(x + cellSize / 2 - 2, y + cellSize / 2 - 2, cellSize * 0.22, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 4, y + 4, cellSize - 8, cellSize - 8);
          } else {
            // Deep perilous abyss with animated danger warning perimeter
            const pulse = (Math.sin(timeSec * 3 + obs.x) + 1) / 2;
            ctx.fillStyle = '#030712';
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.5})`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);

            // Void swirl vortex
            ctx.strokeStyle = 'rgba(153, 27, 27, 0.4)';
            ctx.beginPath();
            ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.25, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (obs.type === 'gate') {
          const isOpen = engine.collectedKeys.has(obs.keyId);
          if (isOpen) {
            // Unlocked and opened archway: neon emerald glow with lowered portcullis bars
            ctx.save();
            ctx.fillStyle = '#064e3b';
            ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);

            ctx.strokeStyle = '#4ade80';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 3, y + 3, cellSize - 6, cellSize - 6);

            // Open archway indicator
            ctx.fillStyle = '#86efac';
            ctx.font = `bold ${Math.floor(cellSize * 0.38)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔓', x + cellSize / 2, y + cellSize / 2);
            ctx.restore();
          } else {
            // Closed heavy security gate with vertical iron bars and locked padlock
            ctx.save();
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

            // Steel gate border
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);

            // 3 vertical iron bars
            ctx.fillStyle = '#94a3b8';
            const barW = Math.max(2, cellSize * 0.08);
            ctx.fillRect(x + cellSize * 0.25 - barW / 2, y + 3, barW, cellSize - 6);
            ctx.fillRect(x + cellSize * 0.5 - barW / 2, y + 3, barW, cellSize - 6);
            ctx.fillRect(x + cellSize * 0.75 - barW / 2, y + 3, barW, cellSize - 6);

            // Padlock emblem in center
            ctx.fillStyle = '#ef4444';
            ctx.font = `bold ${Math.floor(cellSize * 0.34)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔒', x + cellSize / 2, y + cellSize / 2);
            ctx.restore();
          }
        }
      });

      // Draw Stones (Pushable Boulders)
      stones.forEach((stone) => {
        const cx = stone.x * cellSize + cellSize / 2;
        const cy = stone.y * cellSize + cellSize / 2;
        const radius = cellSize * 0.42;

        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Animated Keys (Floating bob + Golden Sparkle)
      keys.forEach((key) => {
        const bob = Math.sin(timeSec * 3.5 + key.x * 2) * (cellSize * 0.07);
        const cx = key.x * cellSize + cellSize / 2;
        const cy = key.y * cellSize + cellSize / 2 + bob;

        ctx.save();
        // Golden glow aura
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 8;

        // Key loop / head
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx, cy - cellSize * 0.12, cellSize * 0.16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#854d0e';
        ctx.beginPath();
        ctx.arc(cx, cy - cellSize * 0.12, cellSize * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // Key shaft
        ctx.fillStyle = '#facc15';
        ctx.fillRect(cx - 2, cy - cellSize * 0.04, 4, cellSize * 0.3);

        // Key teeth
        ctx.fillRect(cx + 2, cy + cellSize * 0.08, cellSize * 0.12, 3);
        ctx.fillRect(cx + 2, cy + cellSize * 0.18, cellSize * 0.12, 3);

        // Sparkle star
        const s = Math.max(0, Math.sin(timeSec * 4 + key.x * 3));
        drawSparkle(ctx, cx + cellSize * 0.2, cy - cellSize * 0.2, s * (cellSize * 0.12), 0);
        ctx.restore();
      });

      // Draw Exit Portal with Swirling Vortex
      const portalCx = portal.x * cellSize + cellSize / 2;
      const portalCy = portal.y * cellSize + cellSize / 2;
      const isWon = engine.status === 'WON';

      if (isWon) {
        victoryTimerRef.current += dt;
        portalAngle += 0.22; // High-velocity vortex spin on victory

        // Emit celebration victory confetti stars from portal
        if (Math.random() < 0.65) {
          const confettiColors = ['#facc15', '#38bdf8', '#ec4899', '#22c55e', '#a855f7', '#fb923c'];
          const angle = Math.random() * Math.PI * 2;
          const spd = (cellSize * 0.065) * (0.8 + Math.random() * 1.2);
          particlesRef.current.push({
            x: portalCx,
            y: portalCy,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            size: Math.max(2, cellSize * 0.1 * (0.8 + Math.random() * 0.5)),
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            sparkleColor: '#ffffff',
            maxLife: 550,
            age: 0,
          });
        }
      } else {
        portalAngle += 0.04;
      }

      ctx.save();
      ctx.translate(portalCx, portalCy);
      ctx.rotate(portalAngle);

      const portalRadius = isWon ? cellSize * 0.56 : cellSize * 0.48;
      const portalGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, portalRadius);
      portalGrad.addColorStop(0, '#38bdf8');
      portalGrad.addColorStop(0.5, '#818cf8');
      portalGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = portalGrad;
      ctx.beginPath();
      ctx.arc(0, 0, portalRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isWon ? '#facc15' : '#c084fc';
      ctx.lineWidth = isWon ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, portalRadius * 0.78, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();

      // Detect Collected Apples and Spawn Burst Particles & Floating Text
      const currentApples = apples || [];
      if (prevApplesRef.current !== null) {
        if (engine.moves > 0 || engine.applesEaten > 0) {
          prevApplesRef.current.forEach((prev) => {
            const stillExists = currentApples.some((curr) => curr.x === prev.x && curr.y === prev.y);
            if (!stillExists) {
              const burstX = prev.x * cellSize + cellSize / 2;
              const burstY = prev.y * cellSize + cellSize / 2;
              const colorConfig = getParticleColors(prev.type);

              // 1. Spawn floating score/effect notification text
              const label =
                prev.type === 'golden'
                  ? '+50 ⭐ & 10 🪙'
                  : prev.type === 'mega'
                  ? '+2 Growth 🌟'
                  : prev.type === 'time'
                  ? '+5 Moves ⏱️'
                  : prev.type === 'mystery'
                  ? 'Mystery! ❓'
                  : '+100 🍎';

              floatingTextsRef.current.push({
                text: label,
                x: burstX,
                y: burstY,
                color: colorConfig.main,
                age: 0,
                maxLife: 850,
              });

              // 2. Spawn burst particles
              const count = 8;
              for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
                const speed = (cellSize * 0.045) * (0.8 + Math.random() * 0.8);
                particlesRef.current.push({
                  x: burstX,
                  y: burstY,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  size: Math.max(2, cellSize * 0.09 * (0.8 + Math.random() * 0.5)),
                  color: colorConfig.main,
                  sparkleColor: colorConfig.sparkle,
                  maxLife: 350,
                  age: 0,
                });
              }
            }
          });
        }
      }
      prevApplesRef.current = currentApples.map((a) => ({ x: a.x, y: a.y, type: a.type || 'normal' }));

      // Detect Key Collection and Spawn Floating Feedback
      const curKeyCount = engine.collectedKeys ? engine.collectedKeys.size : 0;
      if (curKeyCount > prevKeysRef.current) {
        const head = worm[0];
        if (head) {
          floatingTextsRef.current.push({
            text: '🔑 Key Found! Gate Unlocked',
            x: head.x * cellSize + cellSize / 2,
            y: head.y * cellSize + cellSize / 2,
            color: '#facc15',
            age: 0,
            maxLife: 950,
          });
        }
      }
      prevKeysRef.current = curKeyCount;

      // Detect Pit Bridging and Spawn Floating Feedback
      const curPitCount = engine.filledPits ? engine.filledPits.size : 0;
      if (curPitCount > prevPitsRef.current) {
        const head = worm[0];
        if (head) {
          floatingTextsRef.current.push({
            text: '🪨 Pit Bridged with Stone!',
            x: head.x * cellSize + cellSize / 2,
            y: head.y * cellSize + cellSize / 2,
            color: '#38bdf8',
            age: 0,
            maxLife: 950,
          });
        }
      }
      prevPitsRef.current = curPitCount;

      // Draw Animated Apples (Normal, Golden, Mega, Time, Mystery)
      apples.forEach((apple) => {
        const isGolden = apple.type === 'golden';
        const isMega = apple.type === 'mega';
        const isTime = apple.type === 'time';
        const isMystery = apple.type === 'mystery';
        const appleRadius = isMega ? cellSize * 0.44 : cellSize * 0.36;

        // Subtle floating/bobbing animation with coordinate-based phase shift
        const bobOffset = Math.sin(timeSec * 3 + apple.x * 1.8 + apple.y * 2.4) * (cellSize * 0.06);
        const cx = apple.x * cellSize + cellSize / 2;
        const cy = apple.y * cellSize + cellSize / 2 + bobOffset;

        // 1. Ground Drop Shadow (simulating height perception)
        const floorY = apple.y * cellSize + cellSize * 0.84;
        const shadowScale = Math.max(0.65, Math.min(1.1, 1 - (bobOffset / (cellSize * 0.3))));
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(cx, floorY, appleRadius * 0.7 * shadowScale, appleRadius * 0.22 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 2. Animated Pulsing Aura Glow (Golden, Mega, Time, Mystery)
        if (isGolden) {
          const pulse = (Math.sin(timeSec * 3.5 + apple.x) + 1) / 2;
          ctx.save();
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10 + pulse * 10;
          ctx.strokeStyle = `rgba(254, 240, 138, ${0.4 + pulse * 0.45})`;
          ctx.lineWidth = 1.5 + pulse * 1.0;
          ctx.beginPath();
          ctx.arc(cx, cy, appleRadius * 1.12 + pulse * (cellSize * 0.05), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (isMega) {
          const pulse = (Math.sin(timeSec * 3.2 + apple.x) + 1) / 2;
          ctx.save();
          ctx.shadowColor = '#d946ef';
          ctx.shadowBlur = 12 + pulse * 8;
          ctx.strokeStyle = `rgba(240, 171, 252, ${0.4 + pulse * 0.45})`;
          ctx.lineWidth = 1.8 + pulse * 1.0;
          ctx.beginPath();
          ctx.arc(cx, cy, appleRadius * 1.1 + pulse * (cellSize * 0.04), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (isTime) {
          const pulse = (Math.sin(timeSec * 3.6 + apple.x) + 1) / 2;
          ctx.save();
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 10 + pulse * 8;
          ctx.strokeStyle = `rgba(103, 232, 249, ${0.35 + pulse * 0.45})`;
          ctx.lineWidth = 1.6 + pulse * 1.0;
          ctx.beginPath();
          ctx.arc(cx, cy, appleRadius * 1.12 + pulse * (cellSize * 0.04), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (isMystery) {
          const pulse = (Math.sin(timeSec * 3.4 + apple.x) + 1) / 2;
          ctx.save();
          ctx.shadowColor = '#8b5cf6';
          ctx.shadowBlur = 12 + pulse * 8;
          ctx.strokeStyle = `rgba(196, 181, 253, ${0.4 + pulse * 0.45})`;
          ctx.lineWidth = 1.8 + pulse * 1.0;
          ctx.beginPath();
          ctx.arc(cx, cy, appleRadius * 1.12 + pulse * (cellSize * 0.04), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // 3. Apple Body: Realistic 2-lobe silhouette with radial gradient
        ctx.save();
        const bodyGrad = ctx.createRadialGradient(
          cx - appleRadius * 0.35, cy - appleRadius * 0.3, appleRadius * 0.1,
          cx, cy, appleRadius * 1.15
        );
        if (isGolden) {
          bodyGrad.addColorStop(0, '#fef08a');
          bodyGrad.addColorStop(0.5, '#facc15');
          bodyGrad.addColorStop(1, '#a16207');
        } else if (isMega) {
          bodyGrad.addColorStop(0, '#fae8ff');
          bodyGrad.addColorStop(0.55, '#d946ef');
          bodyGrad.addColorStop(1, '#701a75');
        } else if (isTime) {
          bodyGrad.addColorStop(0, '#cffafe');
          bodyGrad.addColorStop(0.55, '#06b6d4');
          bodyGrad.addColorStop(1, '#0c4a6e');
        } else if (isMystery) {
          bodyGrad.addColorStop(0, '#ede9fe');
          bodyGrad.addColorStop(0.55, '#8b5cf6');
          bodyGrad.addColorStop(1, '#4c1d95');
        } else {
          bodyGrad.addColorStop(0, '#fca5a5');
          bodyGrad.addColorStop(0.55, '#ef4444');
          bodyGrad.addColorStop(1, '#991b1b');
        }

        ctx.fillStyle = bodyGrad;
        traceApplePath(ctx, cx, cy, appleRadius);
        ctx.fill();
        ctx.restore();

        // 4. Specular Gloss Highlights (upper-left shoulder reflection)
        ctx.save();
        ctx.fillStyle = isGolden
          ? 'rgba(255, 255, 255, 0.65)'
          : isMega
          ? 'rgba(255, 255, 255, 0.55)'
          : isTime
          ? 'rgba(255, 255, 255, 0.6)'
          : isMystery
          ? 'rgba(255, 255, 255, 0.55)'
          : 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.ellipse(
          cx - appleRadius * 0.36,
          cy - appleRadius * 0.28,
          appleRadius * 0.28,
          appleRadius * 0.14,
          -Math.PI / 4,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Secondary subtle specular reflection dot
        ctx.beginPath();
        ctx.arc(cx - appleRadius * 0.14, cy - appleRadius * 0.42, appleRadius * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 5. Curved Stem
        ctx.save();
        ctx.strokeStyle = isGolden ? '#854d0e' : '#78350f';
        ctx.lineWidth = Math.max(1.6, isMega ? cellSize * 0.065 : cellSize * 0.05);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - appleRadius * 0.55);
        ctx.quadraticCurveTo(cx - appleRadius * 0.1, cy - appleRadius * 0.9, cx + appleRadius * 0.1, cy - appleRadius * 1.15);
        ctx.stroke();
        ctx.restore();

        // 6. Leaf (single leaf for normal/golden/time/mystery, double leaf for mega)
        if (isMega) {
          drawLeaf(ctx, cx + appleRadius * 0.05, cy - appleRadius * 0.85, cx + appleRadius * 0.65, cy - appleRadius * 1.12, '#22c55e', appleRadius * 0.24);
          drawLeaf(ctx, cx - appleRadius * 0.05, cy - appleRadius * 0.8, cx - appleRadius * 0.6, cy - appleRadius * 1.05, '#4ade80', appleRadius * 0.2);
        } else {
          const leafColor = isGolden ? '#84cc16' : '#22c55e';
          drawLeaf(ctx, cx + appleRadius * 0.05, cy - appleRadius * 0.85, cx + appleRadius * 0.65, cy - appleRadius * 1.12, leafColor, appleRadius * 0.22);
        }

        // 7. Type-Specific Embellishments & Badges
        if (isGolden) {
          // Sparkling twinkle stars
          const sparklePhase1 = timeSec * 4 + apple.x * 2;
          const s1 = Math.max(0, Math.sin(sparklePhase1));
          const size1 = s1 * (cellSize * 0.16);
          drawSparkle(ctx, cx + appleRadius * 0.45, cy - appleRadius * 0.35, size1, 0);

          const sparklePhase2 = timeSec * 4 + apple.x * 2 + Math.PI;
          const s2 = Math.max(0, Math.sin(sparklePhase2));
          const size2 = s2 * (cellSize * 0.13);
          drawSparkle(ctx, cx - appleRadius * 0.4, cy + appleRadius * 0.35, size2, Math.PI / 8);
        } else if (isMega) {
          // High-contrast "+2" badge indicator
          ctx.save();
          const badgeR = Math.max(9, cellSize * 0.22);
          ctx.fillStyle = 'rgba(24, 9, 36, 0.92)';
          ctx.strokeStyle = '#f5d0fe';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy + 1, badgeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(10, Math.round(cellSize * 0.32))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+2', cx, cy + 1.5);
          ctx.restore();
        } else if (isTime) {
          // Crisp, high-contrast clock face / timer hands glyph readable even at small tile sizes
          ctx.save();
          const clockRadius = Math.max(8, cellSize * 0.2);
          ctx.fillStyle = 'rgba(8, 23, 44, 0.92)';
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = Math.max(1.2, cellSize * 0.04);
          ctx.beginPath();
          ctx.arc(cx, cy + 1, clockRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // 4 cardinal tick marks
          ctx.strokeStyle = 'rgba(224, 242, 254, 0.7)';
          ctx.lineWidth = 1;
          const tickLen = clockRadius * 0.25;
          ctx.beginPath();
          ctx.moveTo(cx, cy + 1 - clockRadius);
          ctx.lineTo(cx, cy + 1 - clockRadius + tickLen);
          ctx.moveTo(cx, cy + 1 + clockRadius);
          ctx.lineTo(cx, cy + 1 + clockRadius - tickLen);
          ctx.moveTo(cx + clockRadius, cy + 1);
          ctx.lineTo(cx + clockRadius - tickLen, cy + 1);
          ctx.moveTo(cx - clockRadius, cy + 1);
          ctx.lineTo(cx - clockRadius + tickLen, cy + 1);
          ctx.stroke();

          // Hour hand (pointing to ~2:00)
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = Math.max(1.6, cellSize * 0.05);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx, cy + 1);
          ctx.lineTo(cx + clockRadius * 0.48, cy + 1 - clockRadius * 0.36);
          ctx.stroke();

          // Minute hand (pointing to 12:00)
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1.3, cellSize * 0.04);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx, cy + 1);
          ctx.lineTo(cx, cy + 1 - clockRadius * 0.68);
          ctx.stroke();

          // Center pivot dot
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(cx, cy + 1, Math.max(1.5, cellSize * 0.04), 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        } else if (isMystery) {
          // Distinctive high-visibility "?" badge
          ctx.save();
          const badgeR = Math.max(9, cellSize * 0.22);
          ctx.fillStyle = 'rgba(28, 12, 48, 0.92)';
          ctx.strokeStyle = '#ddd6fe';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy + 1, badgeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.shadowColor = '#a855f7';
          ctx.shadowBlur = 6;
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(11, Math.round(cellSize * 0.36))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', cx, cy + 1.5);
          ctx.restore();
        }
      });

      // Draw Worm Body (from tail to head for proper layering)
      const wormLen = worm.length;
      for (let i = wormLen - 1; i >= 0; i--) {
        const seg = worm[i];
        const cx = seg.x * cellSize + cellSize / 2;
        const cy = seg.y * cellSize + cellSize / 2;
        const radius = cellSize * 0.42;

        let segCx = cx;
        let segCy = cy;
        let segRadius = radius;

        // Victory Vortex Suction Animation: segments smoothly spiral and shrink into the portal center
        if (engine.status === 'WON') {
          const victoryElapsed = victoryTimerRef.current;
          // Staggered pull toward portal center: head enters first, tail follows
          const delay = (wormLen - 1 - i) * 60;
          const pullProgress = Math.min(1, Math.max(0, (victoryElapsed - delay) / 450));
          segCx = cx + (portalCx - cx) * pullProgress;
          segCy = cy + (portalCy - cy) * pullProgress;
          segRadius = radius * (1 - pullProgress * 0.8);
        }

        if (i === 0) {
          // Head Segment
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(segCx, segCy, segRadius, 0, Math.PI * 2);
          ctx.fill();

          // Eyes direction offset
          let eyeDx = 0;
          let eyeDy = 0;
          if (direction === 'RIGHT') eyeDx = 4;
          else if (direction === 'LEFT') eyeDx = -4;
          else if (direction === 'UP') eyeDy = -4;
          else if (direction === 'DOWN') eyeDy = 4;

          const eyeScale = segRadius / radius;

          // Cute Eyes
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(segCx + (eyeDx - 4) * eyeScale, segCy + (eyeDy - 2) * eyeScale, 4 * eyeScale, 0, Math.PI * 2);
          ctx.arc(segCx + (eyeDx + 4) * eyeScale, segCy + (eyeDy - 2) * eyeScale, 4 * eyeScale, 0, Math.PI * 2);
          ctx.fill();

          // Pupils
          ctx.fillStyle = '#052e16';
          ctx.beginPath();
          ctx.arc(segCx + (eyeDx * 1.3 - 4) * eyeScale, segCy + (eyeDy * 1.3 - 2) * eyeScale, 2 * eyeScale, 0, Math.PI * 2);
          ctx.arc(segCx + (eyeDx * 1.3 + 4) * eyeScale, segCy + (eyeDy * 1.3 - 2) * eyeScale, 2 * eyeScale, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Body segments with striped gradient
          ctx.fillStyle = i % 2 === 0 ? '#4ade80' : '#16a34a';
          ctx.beginPath();
          ctx.arc(segCx, segCy, segRadius * 0.95, 0, Math.PI * 2);
          ctx.fill();

          // Connecting bridge to previous segment
          const nextSeg = worm[i - 1];
          let ncx = nextSeg.x * cellSize + cellSize / 2;
          let ncy = nextSeg.y * cellSize + cellSize / 2;
          if (engine.status === 'WON') {
            const victoryElapsed = victoryTimerRef.current;
            const delay = (wormLen - 1 - (i - 1)) * 60;
            const pullProgress = Math.min(1, Math.max(0, (victoryElapsed - delay) / 450));
            ncx = ncx + (portalCx - ncx) * pullProgress;
            ncy = ncy + (portalCy - ncy) * pullProgress;
          }

          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = segRadius * 1.8;
          ctx.beginPath();
          ctx.moveTo(segCx, segCy);
          ctx.lineTo(ncx, ncy);
          ctx.stroke();
        }
      }

      // Draw Collection Burst Particles (rendered on top for maximum visual satisfaction)
      if (particlesRef.current.length > 0) {
        ctx.save();
        const aliveParticles = [];
        for (let i = 0; i < particlesRef.current.length; i++) {
          const p = particlesRef.current[i];
          p.age += dt;
          if (p.age < p.maxLife) {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.93;
            p.vy *= 0.93;
            aliveParticles.push(p);

            const progress = p.age / p.maxLife;
            const alpha = Math.max(0, 1 - progress);
            const curSize = p.size * (1 - progress * 0.4);

            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, curSize, 0, Math.PI * 2);
            ctx.fill();

            if (p.sparkleColor && curSize > 1.5) {
              ctx.fillStyle = p.sparkleColor;
              ctx.beginPath();
              ctx.arc(p.x, p.y, curSize * 0.4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        particlesRef.current = aliveParticles.slice(-70);
        ctx.restore();
      }

      // Draw Floating Feedback Texts (+100, +50, +2 Growth, +5 Moves, Key Found, Pit Bridged)
      if (floatingTextsRef.current.length > 0) {
        ctx.save();
        const activeTexts = [];
        for (let i = 0; i < floatingTextsRef.current.length; i++) {
          const ft = floatingTextsRef.current[i];
          ft.age += dt;
          if (ft.age < ft.maxLife) {
            activeTexts.push(ft);
            const progress = ft.age / ft.maxLife;
            const alpha = Math.max(0, 1 - progress);
            const floatOffset = progress * (cellSize * 0.85);

            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.max(11, Math.round(cellSize * 0.38))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // High-contrast text outline
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.lineWidth = 3.5;
            ctx.strokeText(ft.text, ft.x, ft.y - floatOffset);

            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y - floatOffset);
          }
        }
        floatingTextsRef.current = activeTexts;
        ctx.restore();
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      particlesRef.current = [];
    };
  }, [engine]);

  // Touch / Swipe Gesture Handlers
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      isSwipingRef.current = true;
    }
  };

  const handleTouchMove = (e) => {
    // Prevent accidental page scrolling or pull-to-refresh while swiping on the game board
    if (e.cancelable && isSwipingRef.current) {
      e.preventDefault();
    }
  };

  const handleTouchEnd = (e) => {
    if (!isSwipingRef.current) return;
    isSwipingRef.current = false;

    if (!onMove || !e.changedTouches || e.changedTouches.length === 0) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dist = Math.hypot(dx, dy);
    const dt = Date.now() - touchStartRef.current.time;
    const now = Date.now();

    // Minimum swipe threshold of 24px within 750ms and 120ms debounce to prevent double triggers
    if (dist >= 24 && dt < 750 && now - lastSwipeTimeRef.current > 120) {
      lastSwipeTimeRef.current = now;
      if (Math.abs(dx) > Math.abs(dy)) {
        onMove(dx > 0 ? 'RIGHT' : 'LEFT');
      } else {
        onMove(dy > 0 ? 'DOWN' : 'UP');
      }
    }
  };

  const handleTouchCancel = () => {
    isSwipingRef.current = false;
  };

  return (
    <div className="game-canvas-wrapper" style={{ touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClick={(e) => {
          if (!onCellClick || !engine) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const displayWidth = parseFloat(e.currentTarget.style.width) || rect.width;
          const cellSize = displayWidth / engine.cols;
          const clickX = Math.floor((e.clientX - rect.left) / cellSize);
          const clickY = Math.floor((e.clientY - rect.top) / cellSize);
          onCellClick(clickX, clickY);
        }}
      />
    </div>
  );
}

export default GameCanvas;
