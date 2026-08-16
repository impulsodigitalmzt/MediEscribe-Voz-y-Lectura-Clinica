/**
 * RegisterPage — New account registration with password strength enforcement.
 */

import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Stethoscope, Eye, EyeOff, AlertCircle, Loader2, Check, X } from 'lucide-react';
import clsx from 'clsx';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function RegisterPage() {
  const { register, error, clearError, isLoading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '', password: '', full_name: '',
    credentials: '', specialty: 'General Practice', institution: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const passwordValid = PASSWORD_RULES.every((r) => r.test(form.password));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordValid) return;
    clearError();
    try {
      await register(form);
      navigate('/dashboard', { replace: true });
    } catch { /* handled */ }
  };

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50 to-teal-50/30">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center">
            <Stethoscope className="w-5.5 h-5.5 text-white" />
          </div>
          <span className="text-2xl font-bold text-slate-800">MediEscribe</span>
        </div>

        <div className="card p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-1">Create your account</h2>
          <p className="text-slate-500 text-sm mb-6">Set up your physician profile to get started</p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
              <input id="full_name" required value={form.full_name} onChange={(e) => update('full_name', e.target.value)}
                     className="input-field" placeholder="Dr. Jane Smith" />
            </div>
            <div>
              <label htmlFor="reg_email" className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
              <input id="reg_email" type="email" required value={form.email} onChange={(e) => update('email', e.target.value)}
                     className="input-field" placeholder="jane@hospital.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="credentials" className="block text-sm font-medium text-slate-700 mb-1">Credentials</label>
                <input id="credentials" value={form.credentials} onChange={(e) => update('credentials', e.target.value)}
                       className="input-field" placeholder="MD, FACP" />
              </div>
              <div>
                <label htmlFor="specialty" className="block text-sm font-medium text-slate-700 mb-1">Specialty</label>
                <select id="specialty" value={form.specialty} onChange={(e) => update('specialty', e.target.value)}
                        className="input-field">
                  <option>General Practice</option>
                  <option>Internal Medicine</option>
                  <option>Emergency Medicine</option>
                  <option>Pediatrics</option>
                  <option>Surgery</option>
                  <option>Obstetrics & Gynecology</option>
                  <option>Psychiatry</option>
                  <option>Cardiology</option>
                  <option>Neurology</option>
                  <option>Pulmonology</option>
                  <option>Gastroenterology</option>
                  <option>Nephrology</option>
                  <option>Endocrinology</option>
                  <option>Dermatology</option>
                  <option>Ophthalmology</option>
                  <option>ENT / Otolaryngology</option>
                  <option>Urology</option>
                  <option>Oncology</option>
                  <option>Orthopedics</option>
                  <option>Rheumatology</option>
                  <option>Infectious Disease</option>
                  <option>Anesthesiology</option>
                  <option>Radiology</option>
                  <option>Palliative Care</option>
                  <option>Geriatrics</option>
                  <option>Sports Medicine</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="institution" className="block text-sm font-medium text-slate-700 mb-1">Institution</label>
              <input id="institution" value={form.institution} onChange={(e) => update('institution', e.target.value)}
                     className="input-field" placeholder="City General Hospital" />
            </div>
            <div>
              <label htmlFor="reg_password" className="block text-sm font-medium text-slate-700 mb-1">Password *</label>
              <div className="relative">
                <input id="reg_password" type={showPassword ? 'text' : 'password'} required
                       value={form.password} onChange={(e) => update('password', e.target.value)}
                       className="input-field pr-11" placeholder="Create a strong password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showPassword ? 'Hide' : 'Show'}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.password && (
                <div className="mt-2 space-y-1">
                  {PASSWORD_RULES.map((rule) => {
                    const pass = rule.test(form.password);
                    return (
                      <div key={rule.label} className={clsx('flex items-center gap-1.5 text-xs', pass ? 'text-emerald-600' : 'text-slate-400')}>
                        {pass ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {rule.label}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button type="submit" disabled={isLoading || !passwordValid} className="btn-primary w-full py-3 mt-2">
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</>
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="text-teal-600 hover:text-teal-700 font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
