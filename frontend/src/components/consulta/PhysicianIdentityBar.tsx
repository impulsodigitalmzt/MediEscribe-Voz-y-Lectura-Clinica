import { Lock, UserRound } from 'lucide-react';
import type { User } from '../../types';

type Props = {
  user: User | null;
  fecha?: string;
  hora?: string;
};

function formatFechaMx(iso?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return iso || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export default function PhysicianIdentityBar({ user, fecha, hora }: Props) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <UserRound className="w-4 h-4 text-teal-700" />
        <h2 className="text-sm font-semibold text-slate-800">Médico responsable</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Lock className="w-3 h-3" />
          Inmutable · sesión
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <ReadonlyField label="Nombre" value={user?.full_name || '—'} />
        <ReadonlyField label="Cédula profesional" value={user?.credentials || '—'} />
        <ReadonlyField label="Especialidad" value={user?.specialty || '—'} />
        <ReadonlyField label="Fecha" value={formatFechaMx(fecha)} />
        <ReadonlyField label="Hora" value={hora || '—'} />
      </div>
    </section>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</span>
      <input
        value={value}
        readOnly
        disabled
        className="input-field py-2 text-sm bg-slate-50 text-slate-800 cursor-not-allowed"
      />
    </label>
  );
}
