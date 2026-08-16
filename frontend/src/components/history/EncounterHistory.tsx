/**
 * EncounterHistory — Searchable, filterable list of past encounters with status indicators.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import type { Encounter } from '../../types';
import {
  Filter, FileText, Trash2,
  ChevronLeft, ChevronRight, Loader2, Mic
} from 'lucide-react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'recording', label: 'Recording' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'signed_off', label: 'Signed Off' },
  { value: 'amended', label: 'Amended' },
];

const STATUS_BADGES: Record<string, { label: string; class: string }> = {
  recording: { label: 'Recording', class: 'badge-red' },
  paused: { label: 'Paused', class: 'badge-amber' },
  transcribing: { label: 'Transcribing', class: 'badge-amber' },
  generating_note: { label: 'Generating', class: 'badge-amber' },
  pending_review: { label: 'Pending Review', class: 'badge-amber' },
  signed_off: { label: 'Signed Off', class: 'badge-green' },
  amended: { label: 'Amended', class: 'badge-slate' },
};

export default function EncounterHistory() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pageSize = 15;

  useEffect(() => {
    loadEncounters();
  }, [page, statusFilter]);

  const loadEncounters = async () => {
    setLoading(true);
    try {
      const data = await api.listEncounters(page, pageSize, statusFilter || undefined);
      setEncounters(data.encounters);
      setTotal(data.total);
    } catch { /* empty state */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await api.deleteEncounter(id);
      setDeleteId(null);
      await loadEncounters();
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Encounter History</h1>
          <p className="text-slate-500 mt-1">{total} encounters total</p>
        </div>
        <button onClick={() => navigate('/encounter/new')} className="btn-primary">
          <Mic className="w-4 h-4" /> New Encounter
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-field py-2 w-48"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
        </div>
      ) : encounters.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 font-medium">No encounters found</p>
          <p className="text-sm text-slate-400 mt-1">
            {statusFilter ? 'Try changing the filter' : 'Start a recording to create your first encounter'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {encounters.map((enc) => {
              const badge = STATUS_BADGES[enc.status] || { label: enc.status, class: 'badge-slate' };
              return (
                <div key={enc.id} className="card p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (['pending_review', 'signed_off', 'locked', 'amended'].includes(enc.status)) {
                          navigate(`/review/${enc.id}`);
                        } else {
                          navigate(`/encounter/${enc.id}`);
                        }
                      }}
                    >
                      <p className="text-sm font-medium text-slate-800 truncate">{enc.encounter_id}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {enc.specialty_template.replace(/_/g, ' ')} • {Math.floor(enc.duration_seconds / 60)} min
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteId(enc.id); }}
                      className="btn-icon p-1.5 text-slate-400 hover:text-red-500 flex-shrink-0"
                      aria-label="Delete encounter"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={badge.class}>{badge.label}</span>
                    <span className="text-xs text-slate-400">
                      {formatDistanceToNow(new Date(enc.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-slate-500">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-icon"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn-icon"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Delete Encounter?</h3>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              This will permanently delete this encounter and all associated notes, transcripts, and data.
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="btn-secondary flex-1 py-2 text-sm"
              >
                No, Keep It
              </button>
              <button
                onClick={() => deleteId && handleDelete(deleteId)}
                disabled={deleting}
                className="btn-danger flex-1 py-2 text-sm"
              >
                {deleting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</>
                ) : (
                  'Yes, Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
