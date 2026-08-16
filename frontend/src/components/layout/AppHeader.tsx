import { LogOut, Menu, Stethoscope } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

type Props = {
  onMenu: () => void;
  onLogout: () => void;
};

export default function AppHeader({ onMenu, onLogout }: Props) {
  const { user } = useAuth();
  const physicianName = user?.full_name?.trim() || 'Médico';
  const specialty = user?.specialty?.trim();
  const cedula = user?.credentials?.trim();

  return (
    <header className="flex-shrink-0 h-16 bg-white border-b border-slate-200 flex items-center gap-4 px-4 lg:px-6">
      <button
        type="button"
        className="btn-icon lg:hidden"
        onClick={onMenu}
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-teal-700 flex items-center justify-center flex-shrink-0">
          <Stethoscope className="w-4.5 h-4.5 text-white" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 tracking-tight leading-none">MediEscribe</p>
          <p className="text-[11px] text-slate-500 mt-0.5 hidden sm:block">Expediente clínico electrónico</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3 min-w-0">
        <div className="text-right min-w-0 hidden sm:block">
          <p className="text-sm font-medium text-slate-800 truncate" title={physicianName}>
            {physicianName}
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            {[specialty, cedula ? `Céd. ${cedula}` : null].filter(Boolean).join(' · ') || 'Sesión activa'}
          </p>
        </div>
        <div
          className="w-9 h-9 rounded-full bg-slate-100 text-teal-800 flex items-center justify-center text-sm font-semibold flex-shrink-0"
          aria-hidden
        >
          {physicianName.charAt(0).toUpperCase()}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="btn-icon text-slate-500 hover:text-red-600"
          aria-label="Cerrar sesión"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
