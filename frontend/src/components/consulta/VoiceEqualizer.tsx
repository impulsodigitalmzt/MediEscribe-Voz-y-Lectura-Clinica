import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

type Props = {
  levelsRef: MutableRefObject<number[]>;
  live?: boolean;
};

function drawWave(canvas: HTMLCanvasElement, levels: number[]) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 72;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.fillStyle = '#042f2e';
  ctx.fillRect(0, 0, w, h);

  const count = cssW < 420 ? 18 : 32;
  const gap = 3 * dpr;
  const barW = Math.max(2 * dpr, (w - gap * (count + 1)) / count);
  const source = levels.length ? levels : [0.12];

  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((i / count) * source.length);
    const amp = Math.max(0.08, Math.min(1, source[idx] ?? 0.12));
    const barH = Math.max(4 * dpr, amp * (h - 8 * dpr));
    const x = gap + i * (barW + gap);
    const y = h - barH - 4 * dpr;
    ctx.fillStyle = amp > 0.78 ? '#f87171' : '#2dd4bf';
    const r = Math.min(barW / 2, 4 * dpr);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + barW, y, x + barW, y + barH, r);
    ctx.arcTo(x + barW, y + barH, x, y + barH, r);
    ctx.arcTo(x, y + barH, x, y, r);
    ctx.arcTo(x, y, x + barW, y, r);
    ctx.closePath();
    ctx.fill();
  }
}

export default function VoiceEqualizer({ levelsRef, live = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickyRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 33) {
        last = now;
        const levels = levelsRef.current;
        if (canvasRef.current) drawWave(canvasRef.current, levels);
        if (stickyRef.current) drawWave(stickyRef.current, levels);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef]);

  return (
    <>
      <div
        className="voice-eq-sticky"
        role="status"
        aria-live="polite"
        aria-label={live ? 'Dictado activo. El micrófono está captando audio.' : 'Preparando micrófono'}
      >
        <p className="voice-eq-sticky-label">
          {live ? 'Dictado activo · audio hacia Whisper' : 'Activando micrófono'}
        </p>
        <canvas ref={stickyRef} className="voice-eq-sticky-canvas" height={40} />
      </div>
      <div className="voice-eq-wrap">
        <canvas ref={canvasRef} className="voice-eq-canvas" />
      </div>
    </>
  );
}
