/**
 * SettingsPage — Profile management, language preferences, template selection.
 */

import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import type { SpecialtyTemplate } from '../../types';
import { SUPPORTED_LANGUAGES } from '../../types';
import {
  User, Globe, Layout, Save, Loader2, CheckCircle2, Moon, Sun, Info, Shield
} from 'lucide-react';

export default function SettingsPage() {
  const { user, refreshProfile } = useAuth();
  const [templates, setTemplates] = useState<SpecialtyTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('medscribe_theme');
    if (stored) return stored === 'dark';
    return document.documentElement.classList.contains('dark');
  });

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('medscribe_theme', next ? 'dark' : 'light');
  };
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    credentials: user?.credentials || '',
    specialty: user?.specialty || '',
    institution: user?.institution || '',
    preferred_language: user?.preferred_language || 'en',
    preferred_template: user?.preferred_template || 'general_practice',
    whatsapp_phone: user?.whatsapp_phone || '',
  });

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      setForm({
        full_name: user.full_name,
        credentials: user.credentials,
        specialty: user.specialty,
        institution: user.institution,
        preferred_language: user.preferred_language,
        preferred_template: user.preferred_template,
        whatsapp_phone: user.whatsapp_phone || '',
      });
    }
  }, [user]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.updateProfile(form);
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Ajustes</h1>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Profile */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <User className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Profile</h2>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input value={form.full_name} onChange={(e) => update('full_name', e.target.value)}
                       className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Credentials</label>
                <input value={form.credentials} onChange={(e) => update('credentials', e.target.value)}
                       className="input-field" placeholder="MD, FACP" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Specialty</label>
                <input value={form.specialty} onChange={(e) => update('specialty', e.target.value)}
                       className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Institution</label>
                <input value={form.institution} onChange={(e) => update('institution', e.target.value)}
                       className="input-field" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input value={user?.email || ''} disabled className="input-field bg-slate-50 text-slate-400 cursor-not-allowed" />
              <p className="text-xs text-slate-400 mt-1">Email cannot be changed</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp (código de país + número)</label>
              <input
                value={form.whatsapp_phone}
                onChange={(e) => update('whatsapp_phone', e.target.value.replace(/[^\d]/g, ''))}
                className="input-field"
                placeholder="5215512345678"
                inputMode="numeric"
              />
              <p className="text-xs text-slate-400 mt-1">
                Solo dígitos, sin +. Vincula este número para guardar notas enviadas por WhatsApp en tu cuenta.
              </p>
            </div>
          </div>
        </section>

        {/* Language Preferences */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Globe className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Language</h2>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Preferred Output Language</label>
            <select value={form.preferred_language} onChange={(e) => update('preferred_language', e.target.value)}
                    className="input-field w-64">
              {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Default language for generated clinical notes</p>
          </div>
        </section>

        {/* Template Preferences */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Layout className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Default Template</h2>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Default Specialty Template</label>
            <select value={form.preferred_template} onChange={(e) => update('preferred_template', e.target.value)}
                    className="input-field w-64">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Used as default when creating new encounters</p>
          </div>
        </section>

        {/* Dark / Light Mode */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Moon className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Appearance</h2>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Dark Mode</p>
              <p className="text-xs text-slate-400 mt-0.5">Switch between light and dark theme</p>
            </div>
            <button
              type="button"
              onClick={toggleDark}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${isDark ? 'bg-teal-600' : 'bg-slate-200'}`}
              role="switch"
              aria-checked={isDark}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200 ${isDark ? 'translate-x-6' : 'translate-x-1'}`}>
                {isDark ? <Moon className="w-3 h-3 text-teal-600" /> : <Sun className="w-3 h-3 text-slate-400" />}
              </span>
            </button>
          </div>
        </section>

        {/* How to Use */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Info className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Cómo usar MediEscribe</h2>
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">1.</span><span><strong>Buscar paciente</strong> — En el panel, identifique por nombre, CURP o número de expediente.</span></div>
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">2.</span><span><strong>Alta si no existe</strong> — Cree el expediente con datos personales y el consentimiento de privacidad obligatorio.</span></div>
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">3.</span><span><strong>Resumen</strong> — Revise demografía e historial (solo lectura) y pulse «Iniciar Nueva Consulta».</span></div>
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">4.</span><span><strong>Consentimiento de la consulta</strong> — Antes de dictar o guardar, registre el consentimiento informado y el uso de IA (LFPDPPP).</span></div>
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">5.</span><span><strong>Nota clínica</strong> — Dicte o escriba; su nombre, cédula y especialidad quedan fijos desde la sesión.</span></div>
            <div className="flex gap-3"><span className="font-bold text-teal-700 flex-shrink-0">6.</span><span><strong>Cerrar y bloquear</strong> — La consulta pasa a locked y no admite más cambios (NOM-004 5.11).</span></div>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Shield className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-slate-800">LFPDPPP y datos sensibles</h2>
          </div>
          <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
            <p>Los datos de salud se tratan como datos sensibles. Cada médico autenticado solo accede a sus expedientes. Las transcripciones se cifran en reposo (AES-GCM). Las llamadas a Groq se envían con <code>store: false</code> para que no se usen en entrenamiento de modelos públicos.</p>
            <p>En la consola de Groq, active Zero Data Retention (Data Controls) para el máximo de no retención. El consentimiento informado de cada consulta es obligatorio antes de guardar o generar nota con IA.</p>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Shield className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-slate-800">Disclaimer</h2>
          </div>
          <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
            <p><strong>MedScribe is a clinical documentation assistant, NOT a clinical decision-making tool.</strong></p>
            <p>AI-generated content including recommended plans, differential diagnoses, and SBAR summaries are suggestions based on the transcript provided. They do not replace clinical judgment, physical examination, or professional medical decision-making.</p>
            <p>The physician is solely responsible for verifying all AI-generated content, making clinical decisions, and ensuring accuracy before signing off on any clinical note.</p>
            <p>MedScribe does not diagnose, prescribe, or recommend treatment. It documents what is discussed during clinical encounters and structures it into professional medical notes.</p>
            <p className="text-xs text-slate-400 mt-2">By using this application, you acknowledge and accept these terms.</p>
          </div>
        </section>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6">
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-4 h-4" /> Save Settings</>
            )}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 animate-fade-in">
              <CheckCircle2 className="w-4 h-4" /> Settings saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
