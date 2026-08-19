import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  levels: number[];
};

const BAR_COUNT = 32;

function WaveBars({ heights }: { heights: number[] }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        width: '100%',
        height: '120px',
        gap: '4px',
        boxSizing: 'border-box',
        padding: '8px 6px',
        background: '#020617',
        borderRadius: '8px',
      }}
    >
      {heights.map((height, index) => (
        <div
          key={index}
          style={{
            width: '8px',
            flexGrow: 1,
            flexShrink: 1,
            maxWidth: '14px',
            height: `${height}px`,
            minHeight: '8px',
            borderRadius: '4px',
            background: height > 85 ? '#f87171' : '#2dd4bf',
          }}
        />
      ))}
    </div>
  );
}

export default function VoiceEqualizer({ levels }: Props) {
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const [heights, setHeights] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 36));
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
    let raf = 0;
    let last = 0;
    const origin = performance.now();
    const tick = (now: number) => {
      if (now - last >= 40) {
        last = now;
        const t = (now - origin) / 1000;
        const live = levelsRef.current;
        setHeights(Array.from({ length: BAR_COUNT }, (_, index) => {
          const mic = live[index % Math.max(1, live.length)] ?? 0.2;
          const idle = 0.22 + 0.78 * Math.abs(Math.sin(t * 6.1 + index * 0.37));
          const amp = Math.max(idle * 0.7, mic);
          return Math.max(10, Math.round(amp * 104));
        }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const overlay = portalReady && typeof document !== 'undefined'
    ? createPortal(
      <div
        id="mediescribe-voice-waves"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2147483647,
          background: '#042f2e',
          borderBottom: '6px solid #2dd4bf',
          padding: '10px 16px 14px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        <p
          style={{
            margin: '0 0 8px',
            color: '#ccfbf1',
            fontWeight: 700,
            fontSize: '15px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          Grabando — ondas de sonido
        </p>
        <WaveBars heights={heights} />
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      {overlay}
      <div
        style={{
          width: '100%',
          background: '#042f2e',
          border: '4px solid #2dd4bf',
          borderRadius: '12px',
          padding: '10px',
        }}
      >
        <WaveBars heights={heights} />
      </div>
    </>
  );
}
