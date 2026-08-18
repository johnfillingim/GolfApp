import { useEffect, useRef } from 'react';
import type { Celebration, CelebrationTier } from '../state/celebrations';
import { celebrationMoneyText } from '../state/celebrations';

/**
 * The celebration layer, ported from `CelebrationOverlay.swift`.
 *
 * Principles carried over verbatim:
 * - **Never blocks input.** The overlay is `pointer-events-none`; only the
 *   banner itself is tappable, so score entry keeps working underneath.
 * - **Skippable.** Tap the banner to dismiss and advance the queue.
 * - **One at a time**, highest tier first (the queue is sorted in the engine).
 * - **Reduce Motion** drops particles for a plain fade.
 *
 * The particles are a parametric canvas system rather than an animation
 * library — same reasoning as the Swift version: no designer assets exist yet,
 * and this already hits the punchy bar with zero dependencies.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
}

const TIER_PARTICLES: Record<CelebrationTier, number> = {
  toast: 0,
  minor: 0,
  medium: 40,
  major: 90,
  jackpot: 180,
};

const PALETTES: Record<CelebrationTier, string[]> = {
  toast: ['#93A69C'],
  minor: ['#93A69C', '#1F9D55'],
  medium: ['#B7F435', '#1F9D55', '#F4F9F6'],
  major: ['#B7F435', '#1F9D55', '#FFD34D', '#F4F9F6'],
  jackpot: ['#FFD34D', '#B7F435', '#FFFFFF', '#1F9D55', '#FF7A6B'],
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function Confetti({ tier }: { tier: CelebrationTier }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const count = TIER_PARTICLES[tier];
    if (count === 0 || prefersReducedMotion()) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.scale(dpr, dpr);

    const palette = PALETTES[tier];
    const particles: Particle[] = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      return {
        x: width / 2,
        y: height * 0.38,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        size: 5 + Math.random() * 7,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        color: palette[Math.floor(Math.random() * palette.length)]!,
      };
    });

    let frame = 0;
    let raf = 0;
    const totalFrames = tier === 'jackpot' ? 220 : 130;

    const draw = () => {
      frame += 1;
      context.clearRect(0, 0, width, height);
      const fade = Math.max(0, 1 - frame / totalFrames);

      for (const p of particles) {
        p.vy += 0.22; // gravity
        p.vx *= 0.99; // drag
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.rotation);
        context.globalAlpha = fade;
        context.fillStyle = p.color;
        context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        context.restore();
      }

      if (frame < totalFrames) {
        raf = requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tier]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}

const TIER_STYLE: Record<CelebrationTier, string> = {
  toast: 'bg-raised/95 border-stroke',
  minor: 'bg-raised/95 border-stroke',
  medium: 'bg-raised/95 border-money/40',
  major: 'bg-raised/95 border-money/70',
  jackpot: 'bg-gold/95 border-gold text-text-onAccent',
};

export function CelebrationOverlay({
  celebration,
  onSkip,
}: {
  celebration: Celebration | null;
  onSkip: () => void;
}) {
  if (!celebration) return null;

  const isJackpot = celebration.tier === 'jackpot';
  const money = celebrationMoneyText(celebration);
  const isToast = celebration.tier === 'toast' || celebration.tier === 'minor';

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none flex flex-col items-center justify-start"
      role="status"
      aria-live="polite"
    >
      <Confetti tier={celebration.tier} />

      <button
        type="button"
        onClick={onSkip}
        aria-label="Dismiss celebration"
        className={`pointer-events-auto mt-[max(env(safe-area-inset-top),1rem)] mx-4 max-w-sm w-[calc(100%-2rem)] animate-pop-in rounded-card border px-5 py-4 text-center backdrop-blur shadow-2xl ${
          TIER_STYLE[celebration.tier]
        }`}
      >
        <div className={isJackpot ? 'text-6xl' : isToast ? 'text-2xl' : 'text-4xl'}>
          {celebration.emoji}
        </div>
        <div
          className={`${isJackpot ? 'text-display' : isToast ? 'text-headline' : 'text-title'} mt-1`}
        >
          {celebration.title}
        </div>
        {celebration.subtitle && (
          <div
            className={`text-caption mt-1 ${isJackpot ? 'text-text-onAccent/80' : 'text-text-secondary'}`}
          >
            {celebration.subtitle}
          </div>
        )}
        {money && (
          <div
            className={`tnum text-money-lg mt-2 ${isJackpot ? 'text-text-onAccent' : 'text-money'}`}
          >
            {money}
          </div>
        )}
      </button>
    </div>
  );
}
