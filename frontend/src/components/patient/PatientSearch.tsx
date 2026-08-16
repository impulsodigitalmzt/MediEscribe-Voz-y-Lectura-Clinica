import { useMemo, useState, type FormEvent } from 'react';
import { FilePlus2, Loader2, Search, UserRound } from 'lucide-react';
import api from '../../services/api';
import type { PacienteExpediente } from '../../types';
import { parseNombreCompleto } from '../../lib/parseNombreCompleto';
import PatientCreateModal from './PatientCreateModal';

type Props = {
  onSelect: (paciente: PacienteExpediente) => void;
};

function looksLikeCurp(value: string): boolean {
  return /^[A-Z0-9]{18}$/i.test(value.trim());
}

export default function PatientSearch({ onSelect }: Props) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [matches, setMatches] = useState<PacienteExpediente[]>([]);
  const [error, setError] = useState('');
  const [showAlta, setShowAlta] = useState(false);

  const seed = useMemo(() => {
    const trimmed = q.trim();
    if (looksLikeCurp(trimmed)) return { curp: trimmed.toUpperCase() };
    const parsed = parseNombreCompleto(trimmed);
    return {
      ...parsed,
      nombre_completo: trimmed,
    };
  }, [q]);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setError('Escribe nombre, CURP o número de expediente.');
      return;
    }
    setError('');
    setLoading(true);
    setSearched(true);
    try {
      const payload = looksLikeCurp(trimmed)
        ? { curp: trimmed.toUpperCase() }
        : { q: trimmed };
      const result = await api.buscarPacientes(payload);
      setMatches(result.pacientes);
    } catch (err) {
      setMatches([]);
      setError(err instanceof Error ? err.message : 'No se pudo buscar el expediente.');
    } finally {
      setLoading(false);
    }
  };

  const empty = searched && !loading && matches.length === 0 && !error;

  return (
    <div className="w-full">
      <form onSubmit={runSearch} className="relative">
        <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearched(false);
            setError('');
          }}
          className="input-field pl-12 pr-28 py-3.5 text-[15px] shadow-sm"
          placeholder="Buscar por nombre, CURP o ID de expediente"
          autoComplete="off"
          aria-label="Buscar paciente"
        />
        <button type="submit" disabled={loading} className="btn-primary absolute right-1.5 top-1.5 bottom-1.5 px-4">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {empty && (
        <div className="mt-8 card p-8 text-center">
          <p className="text-base font-semibold text-slate-800">Paciente no encontrado</p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            No hay un expediente con esos datos. Crea uno nuevo para iniciar la atención.
          </p>
          <button type="button" className="btn-primary mt-6" onClick={() => setShowAlta(true)}>
            <FilePlus2 className="w-4 h-4" />
            Crear Nuevo Expediente
          </button>
        </div>
      )}

      {matches.length > 0 && (
        <ul className="mt-6 space-y-2">
          {matches.map((paciente) => (
            <li key={paciente.id}>
              <button
                type="button"
                onClick={() => onSelect(paciente)}
                className="w-full text-left card-hover p-4 flex items-center gap-4"
              >
                <div className="w-11 h-11 rounded-lg bg-slate-100 text-teal-800 flex items-center justify-center flex-shrink-0">
                  <UserRound className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{paciente.nombre_completo}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Exp. {paciente.numero_expediente}
                    {paciente.curp ? ` · CURP ${paciente.curp}` : ''}
                    {` · ${paciente.fecha_nacimiento}`}
                    {paciente.edad ? ` · ${paciente.edad}` : ''}
                  </p>
                </div>
                <span className="text-xs font-medium text-teal-700 hidden sm:inline">Abrir expediente</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && matches.length > 0 && (
        <div className="mt-4 text-center">
          <button type="button" className="text-sm text-teal-700 font-medium" onClick={() => setShowAlta(true)}>
            El paciente no está en la lista — crear expediente
          </button>
        </div>
      )}

      <PatientCreateModal
        open={showAlta}
        seed={seed}
        onClose={() => setShowAlta(false)}
        onCreated={(paciente) => {
          setShowAlta(false);
          onSelect(paciente);
        }}
      />
    </div>
  );
}
