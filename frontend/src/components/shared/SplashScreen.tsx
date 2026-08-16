/**
 * SplashScreen — MedScribe branded launch screen.
 * Teal gradient background, centered logo, subtitle.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export default function SplashScreen() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
      if (!isLoading) {
        navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true });
      }
    }, 2200);
    return () => clearTimeout(timer);
  }, [navigate, isAuthenticated, isLoading]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-teal-600 via-teal-700 to-teal-900">
      {/* Decorative circles */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full bg-teal-400/10 blur-3xl" />
      </div>

      {/* Logo */}
      <div className="relative animate-fade-in">
        <div className="w-24 h-24 rounded-3xl bg-white/15 backdrop-blur-sm flex items-center justify-center mb-8 shadow-2xl border border-white/20">
          <Stethoscope className="w-12 h-12 text-white" strokeWidth={1.5} />
        </div>
      </div>

      {/* Title */}
      <h1 className="relative text-5xl font-display font-bold text-white tracking-tight mb-3 animate-fade-in"
          style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
        MediEscribe
      </h1>

      {/* Subtitle */}
      <p className="relative text-teal-200 text-base tracking-wide animate-fade-in"
         style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
        Expediente clínico electrónico
      </p>

      {/* Loading indicator */}
      <div className="relative mt-12 flex gap-1.5 animate-fade-in" style={{ animationDelay: '0.6s', animationFillMode: 'both' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-white/60 animate-pulse"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>

      {/* Version */}
      <p className="absolute bottom-8 text-teal-300/60 text-xs tracking-wider">
        v1.0 — Confidential
      </p>
    </div>
  );
}
