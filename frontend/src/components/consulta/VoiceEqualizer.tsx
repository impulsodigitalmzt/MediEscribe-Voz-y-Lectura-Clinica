import { useEffect, useRef } from 'react';

type Props = {
  levels: number[];
};

const BAR_COUNT = 36;

export default function VoiceEqualizer({ levels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const started = performance.now();

    const draw = (now: number) => {
      const t = (now - started) / 1000;
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, canvas.clientWidth);
      const cssH = Math.max(1, canvas.clientHeight);
      const pixelW = Math.floor(cssW * dpr);
      const pixelH = Math.floor(cssH * dpr);
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, cssW, cssH);

      const live = levelsRef.current;
      const n = BAR_COUNT;
      const gap = 4;
      const barW = Math.max(4, (cssW - gap * (n + 1)) / n);

      for (let i = 0; i < n; i += 1) {
        const mic = live[i] ?? live[i % Math.max(1, live.length)] ?? 0.12;
        const idle = 0.22 + 0.78 * Math.abs(Math.sin(t * 5.4 + i * 0.38));
        const amp = Math.max(0.16, Math.min(1, idle * 0.62 + mic * 0.85));
        const barH = Math.max(12, amp * (cssH - 16));
        const x = gap + i * (barW + gap);
        const y = cssH - barH - 6;
        const loud = amp > 0.62;
        const gradient = ctx.createLinearGradient(0, y, 0, cssH);
        if (loud) {
          gradient.addColorStop(0, '#fecaca');
          gradient.addColorStop(1, '#b91c1c');
        } else {
          gradient.addColorStop(0, '#99f6e4');
          gradient.addColorStop(1, '#0f766e');
        }
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = Math.min(4, barW / 2);
        const right = x + barW;
        const bottom = y + barH;
        ctx.moveTo(x + radius, y);
        ctx.lineTo(right - radius, y);
        ctx.quadraticCurveTo(right, y, right, y + radius);
        ctx.lineTo(right, bottom);
        ctx.lineTo(x, bottom);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cssBars = Array.from({ length: BAR_COUNT }, (_, index) => {
    const level = levels[index] ?? 0.2;
    return (
      <div
        key={index}
        className="voice-eq-bar"
        style={{
          animationDelay: `${index * 0.045}s`,
          animationDuration: `${0.38 + (1 - level) * 0.32}s`,
        }}
      />
    );
  });

  return (
    <div className="voice-eq-wrap" role="status" aria-label="Ondas del micrófono">
      <canvas className="voice-eq-canvas" ref={canvasRef} aria-hidden />
      <div className="voice-eq" aria-hidden>
        {cssBars}
      </div>
    </div>
  );
}
