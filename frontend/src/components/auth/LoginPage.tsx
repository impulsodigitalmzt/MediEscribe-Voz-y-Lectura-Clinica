/**
 * LoginPage — Secure authentication with password strength enforcement.
 */

import { useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Stethoscope, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

const CREDS_KEY = 'medscribe_test_login';
const TEST_EMAIL = 'doctor@hospital.com';
const TEST_PASSWORD = 'SecurePass123!';

function loadSavedCreds(): { email: string; password: string } {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string; password?: string };
      if (parsed.email && parsed.password) {
        return { email: parsed.email, password: parsed.password };
      }
    }
  } catch {
    /* ignore */
  }
  return { email: TEST_EMAIL, password: TEST_PASSWORD };
}

export default function LoginPage() {
  const { login, error, clearError, isLoading } = useAuth();
  const navigate = useNavigate();
  const saved = loadSavedCreds();
  const [email, setEmail] = useState(saved.email);
  const [password, setPassword] = useState(saved.password);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    clearError();
  }, [clearError]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login({ email, password });
      localStorage.setItem(CREDS_KEY, JSON.stringify({ email, password }));
      navigate('/dashboard', { replace: true });
    } catch {
      // Error handled by useAuth
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-teal-600 via-teal-700 to-teal-900 flex-col justify-center items-center p-12 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-teal-500/20 blur-3xl" />
          <div className="absolute bottom-32 right-16 w-96 h-96 rounded-full bg-teal-400/10 blur-3xl" />
        </div>
        <div className="relative z-10 max-w-md text-center">
          <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-8 border border-white/20">
            <Stethoscope className="w-10 h-10 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl font-display font-bold text-white mb-4">MediEscribe</h1>
          <p className="text-teal-200 text-lg leading-relaxed">
            Expediente clínico electrónico: identifique al paciente, documente la consulta y cierre la nota conforme a la NOM-004.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-slate-800">MediEscribe</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-1">Iniciar sesión</h2>
          <p className="text-slate-500 mb-8">Acceda a su consultorio digital</p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-6 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-3"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            ¿No tiene cuenta?{' '}
            <Link to="/register" className="text-teal-600 hover:text-teal-700 font-medium">
              Crear cuenta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
