import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FolderSearch, Settings, Stethoscope, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../hooks/useAuth';
import AppHeader from './AppHeader';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Pacientes', icon: FolderSearch },
  { to: '/settings', label: 'Ajustes', icon: Settings },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      <AppHeader onMenu={() => setSidebarOpen(true)} onLogout={handleLogout} />

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-900/30 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        <aside
          className={clsx(
            'fixed lg:static inset-y-0 left-0 z-40 lg:z-0 lg:top-auto',
            'w-60 bg-white border-r border-slate-200 flex flex-col',
            'transition-transform duration-200 ease-out pt-16 lg:pt-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">Menú</span>
            <button type="button" className="btn-icon" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Navegación clínica">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  )
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <p className="px-4 py-3 text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Stethoscope className="w-3 h-3" />
            NOM-004-SSA3-2012
          </p>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
