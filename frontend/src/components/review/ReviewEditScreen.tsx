/**
 * ReviewEditScreen — Editable clinical note. All AI-generated fields are
 * live form inputs bound to local React state; Save persists physician corrections.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import type { ClinicalNote, NoteSectionKey, NoteVersion } from '../../types';
import { NOTE_SECTION_LABELS } from '../../types';
import {
  Save, Download, CheckCircle2, AlertTriangle,
  Lock, History, ArrowLeft, Loader2, AlertCircle, X
} from 'lucide-react';
import clsx from 'clsx';

const JSON_KEYS: NoteSectionKey[] = ['review_of_systems', 'physical_examination'];

function sectionToText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'object') return JSON.stringify(content, null, 2);
  return String(content);
}

export default function ReviewEditScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [note, setNote] = useState<ClinicalNote | null>(null);
  const [draft, setDraft] = useState<Record<NoteSectionKey, string> | null>(null);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOff, setSigningOff] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [showSignOffConfirm, setShowSignOffConfirm] = useState(false);

  useEffect(() => {
    if (id) loadNote();
  }, [id]);

  const hydrateDraft = (n: ClinicalNote) => {
    const next = {} as Record<NoteSectionKey, string>;
    (Object.keys(NOTE_SECTION_LABELS) as NoteSectionKey[]).forEach((key) => {
      next[key] = sectionToText(n[key]);
    });
    setDraft(next);
  };

  const loadNote = async () => {
    if (!id) return;
    try {
      const n = await api.getNote(id);
      setNote(n);
      hydrateDraft(n);
    } catch {
      setError('Failed to load note.');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (key: NoteSectionKey, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedMsg('');
  };

  const handleSaveAll = async () => {
    if (!id || !draft || !note) return;
    for (const key of JSON_KEYS) {
      try {
        if (draft[key].trim()) JSON.parse(draft[key]);
      } catch {
        setError(`Invalid JSON in ${NOTE_SECTION_LABELS[key]}.`);
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const updated = await api.saveNoteSections(id, draft);
      setNote(updated);
      hydrateDraft(updated);
      setSavedMsg('Correcciones guardadas.');
    } catch {
      setError('Failed to save edit. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOff = async () => {
    if (!id) return;
    setSigningOff(true);
    try {
      if (draft) {
        await api.saveNoteSections(id, draft);
      }
      await api.signOffNote(id);
      await loadNote();
      setShowSignOffConfirm(false);
    } catch {
      setError('Sign-off failed.');
    } finally {
      setSigningOff(false);
    }
  };

  const handleExportPdf = async () => {
    if (!id) return;
    setExporting(true);
    try {
      const blob = await api.exportPdf(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MedScribe_Note_${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('PDF export failed.');
    } finally {
      setExporting(false);
    }
  };

  const loadVersions = async () => {
    if (!id) return;
    try {
      const data = await api.getNoteVersions(id);
      setVersions(data.versions);
      setShowVersions(true);
    } catch {
      setError('Failed to load version history.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (!note || !draft) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-500">Note not found.</p>
        <button onClick={() => navigate('/dashboard')} className="btn-secondary mt-4">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const isLocked = note.status === 'locked' || note.status === 'signed_off';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-3 no-print flex-shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate('/dashboard')} className="btn-icon flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-800">Review Clinical Note</h1>
            <p className="text-xs text-slate-500">Version {note.current_version} • {note.status.replace('_', ' ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadVersions} className="btn-secondary py-1.5 px-3 text-xs">
            <History className="w-3.5 h-3.5" /> Versions
          </button>
          <button onClick={handleExportPdf} disabled={exporting} className="btn-secondary py-1.5 px-3 text-xs">
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            PDF
          </button>
          {!isLocked && (
            <>
              <button onClick={handleSaveAll} disabled={saving} className="btn-secondary py-1.5 px-3 text-xs">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Guardar correcciones
              </button>
              <button onClick={() => setShowSignOffConfirm(true)} className="btn-primary py-1.5 px-3 text-xs ml-auto">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sign Off
              </button>
            </>
          )}
          {isLocked && (
            <span className="badge-green flex items-center gap-1 py-1 px-2 text-xs ml-auto">
              <Lock className="w-3 h-3" /> Signed
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}
      {savedMsg && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex-shrink-0">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      <div className="mx-4 mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex-shrink-0">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>{note.ai_disclaimer}</span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="max-w-4xl mx-auto space-y-3">
          {(Object.keys(NOTE_SECTION_LABELS) as NoteSectionKey[]).map((key) => {
            const label = NOTE_SECTION_LABELS[key];
            const isMissing = note.missing_sections.includes(key);
            const isUncertain = note.uncertain_fields.includes(key);

            return (
              <div
                key={key}
                className={clsx(
                  isLocked ? 'note-section-locked' :
                  isMissing ? 'note-section-missing' :
                  isUncertain ? 'note-section-uncertain' :
                  'note-section'
                )}
              >
                <h3 className="section-header flex items-center gap-2 mb-2">
                  {label}
                  {isMissing && <span className="badge-amber text-[10px]">Not Discussed</span>}
                  {isUncertain && <span className="badge-amber text-[10px]">Uncertain</span>}
                </h3>
                <textarea
                  value={draft[key] ?? ''}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  disabled={isLocked}
                  className="w-full min-h-[96px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </div>
            );
          })}
        </div>
      </div>

      {showSignOffConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card p-6 w-full max-w-md mx-4 animate-slide-up">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Confirm Sign-Off</h3>
            <p className="text-sm text-slate-600 mb-4">
              By signing off, you confirm that you have reviewed this AI-generated note,
              made any necessary edits, and approve it as part of the clinical record.
              The note will be locked from further edits.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSignOffConfirm(false)} className="btn-secondary py-2 px-4 text-sm">
                Cancel
              </button>
              <button onClick={handleSignOff} disabled={signingOff} className="btn-primary py-2 px-4 text-sm">
                {signingOff ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Sign Off &amp; Lock
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersions && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="card p-6 w-full max-w-lg mx-4 mb-4 sm:mb-0 max-h-[70vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">Version History</h3>
              <button onClick={() => setShowVersions(false)} className="btn-icon"><X className="w-5 h-5" /></button>
            </div>
            {versions.length === 0 ? (
              <p className="text-sm text-slate-500">No version history yet.</p>
            ) : (
              <div className="space-y-3">
                {versions.map((v) => (
                  <div key={v.version_number} className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Version {v.version_number}</span>
                      <span className="text-xs text-slate-400">{new Date(v.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{v.change_description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
