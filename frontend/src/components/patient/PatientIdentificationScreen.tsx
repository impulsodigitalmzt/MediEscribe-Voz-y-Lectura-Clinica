import { useEffect, useRef, useState, type FormEvent } from 'react';
import api from '../../services/api';
import type { ConsultaHistorialItem, PacienteExpediente } from '../../types';
import { composeNombreCompleto, parseNombreCompleto } from '../../lib/parseNombreCompleto';
import NombreCompletoFields from './NombreCompletoFields';
import {
  AlertCircle, FilePlus2, Loader2, Search, ShieldCheck, UserRound, X,
} from 'lucide-react';

type Props = {
  selected: PacienteExpediente | null;
  historial?: ConsultaHistorialItem[];
  locked?: boolean;
  onIdentified: (paciente: PacienteExpediente, historial: ConsultaHistorialItem[]) => void;
  onClear?: () => void;
};

const EMPTY_ALTA = {
  nombre_completo: '',
  nombre: '',
  apellido_paterno: '',
  apellido_materno: '',
  fecha_nacimiento: '',
  sexo: '',
  domicilio: '',
  curp: '',
  ocupacion: '',
  alergias: '',
  cronicos: '',
  consentimiento: false,
};

function seedAltaFromSearch(
  q: string,
  query: { apellido_paterno: string; apellido_materno: string; fecha_nacimiento: string },
  prev: typeof EMPTY_ALTA,
): typeof EMPTY_ALTA {
  const trimmed = q.trim();
  if (looksLikeCurp(trimmed)) {
    return {
      ...prev,
      curp: trimmed.toUpperCase(),
      fecha_nacimiento: query.fecha_nacimiento || prev.fecha_nacimiento,
    };
  }
  const parsed = parseNombreCompleto(trimmed);
  const nombre = parsed.nombre || prev.nombre;
  const apellido_paterno = query.apellido_paterno || parsed.apellido_paterno || prev.apellido_paterno;
  const apellido_materno = query.apellido_materno || parsed.apellido_materno || prev.apellido_materno;
  return {
    ...prev,
    nombre,
    apellido_paterno,
    apellido_materno,
    nombre_completo: composeNombreCompleto({ nombre, apellido_paterno, apellido_materno }) || trimmed,
    fecha_nacimiento: query.fecha_nacimiento || prev.fecha_nacimiento,
  };
}

function looksLikeCurp(value: string): boolean {
  return /^[A-Z0-9]{18}$/i.test(value.trim());
}

export default function PatientIdentificationScreen({
  selected, historial = [], locked = false, onIdentified, onClear,
}: Props) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({
    apellido_paterno: '',
    apellido_materno: '',
    fecha_nacimiento: '',
  });
  const [matches, setMatches] = useState<PacienteExpediente[]>([]);
  const [desambiguacion, setDesambiguacion] = useState(false);
  const [altaRequerida, setAltaRequerida] = useState(false);
  const [showAlta, setShowAlta] = useState(false);
  const [searched, setSearched] = useState(false);
  const [alta, setAlta] = useState(EMPTY_ALTA);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (explicit = false) => {
    const trimmed = q.trim();
    const payload = looksLikeCurp(trimmed)
      ? { curp: trimmed.toUpperCase(), fecha_nacimiento: query.fecha_nacimiento }
      : {
          q: trimmed,
          apellido_paterno: query.apellido_paterno,
          apellido_materno: query.apellido_materno,
          fecha_nacimiento: query.fecha_nacimiento,
        };

    if (!trimmed && !query.apellido_paterno && !query.fecha_nacimiento) {
      if (explicit) setError('Escribe CURP, nombre o apellido para buscar el expediente.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const result = await api.buscarPacientes(payload);
      setMatches(result.pacientes);
      setDesambiguacion(result.requiere_desambiguacion);
      setAltaRequerida(result.alta_requerida);
      setShowAlta(result.alta_requerida);
      setSearched(true);
      if (result.alta_requerida) {
        setAlta((prev) => seedAltaFromSearch(trimmed, query, prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar el expediente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selected) return;
    const trimmed = q.trim();
    const ready = looksLikeCurp(trimmed) || trimmed.length >= 3 || query.apellido_paterno.length >= 2 || Boolean(query.fecha_nacimiento);
    if (!ready) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(false);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query.apellido_paterno, query.apellido_materno, query.fecha_nacimiento, selected]);

  const handleConfirm = async (paciente: PacienteExpediente) => {
    setError('');
    setConfirmingId(paciente.id);
    try {
      const data = await api.getPaciente(paciente.id);
      onIdentified(data.paciente, data.historial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el expediente.');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleAlta = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!alta.consentimiento) {
      setError('Debes aceptar el aviso de privacidad para dar de alta el expediente.');
      return;
    }
    setLoading(true);
    try {
      const paciente = await api.crearPaciente({
        nombre: alta.nombre,
        apellido_paterno: alta.apellido_paterno,
        apellido_materno: alta.apellido_materno,
        fecha_nacimiento: alta.fecha_nacimiento,
        sexo: alta.sexo,
        domicilio: alta.domicilio,
        curp: alta.curp,
        ocupacion: alta.ocupacion,
        antecedentes_importantes: { alergias: alta.alergias, cronicos: alta.cronicos },
        consentimiento_privacidad_aceptado: true,
      });
      onIdentified(paciente, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo dar de alta el expediente.');
    } finally {
      setLoading(false);
    }
  };

  if (selected) {
    return (
      <div className="card p-4 border-teal-200 bg-teal-50/40">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0">
            <UserRound className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">Expediente maestro</p>
            <p className="font-semibold text-slate-800">{selected.nombre_completo}</p>
            <p className="text-xs text-slate-500">
              Exp. {selected.numero_expediente} · {selected.fecha_nacimiento} · {selected.edad || 'edad s/d'} · {selected.sexo || 'sexo s/d'}
            </p>
            <p className="text-xs text-slate-500 truncate">{selected.domicilio}</p>
            {selected.curp && <p className="text-xs font-mono text-slate-400 mt-1">CURP {selected.curp}</p>}
            {historial.length > 0 && (
              <p className="text-xs text-teal-700 mt-2">{historial.length} consulta(s) previa(s) se usarán como contexto clínico.</p>
            )}
          </div>
          {onClear && (
            <button
              type="button"
              className="text-xs text-teal-800 font-medium disabled:opacity-40"
              disabled={locked}
              onClick={onClear}
            >
              Cambiar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Paciente del expediente</h2>
        <p className="text-xs text-slate-500 mt-1">
          Busca en Neon por CURP o nombre. No se puede grabar ni transcribir hasta confirmar o dar de alta el expediente (NOM-004 5.14 / 6.1.1).
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(true);
        }}
        className="space-y-3"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Buscar paciente</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="input-field pl-10"
                placeholder="CURP de 18 caracteres o nombre y apellidos"
                autoComplete="off"
                disabled={locked}
              />
            </div>
            <button type="submit" disabled={loading || locked} className="btn-primary py-2 px-4">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Apellido paterno" value={query.apellido_paterno} onChange={(v) => setQuery((s) => ({ ...s, apellido_paterno: v }))} disabled={locked} />
          <Field label="Apellido materno" value={query.apellido_materno} onChange={(v) => setQuery((s) => ({ ...s, apellido_materno: v }))} disabled={locked} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fecha de nacimiento</label>
            <input
              type="date"
              value={query.fecha_nacimiento}
              disabled={locked}
              onChange={(e) => setQuery((s) => ({ ...s, fecha_nacimiento: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>
      </form>

      {desambiguacion && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Hay más de un paciente con datos similares. Confirma la identidad; no se selecciona automáticamente.
        </div>
      )}

      {searched && matches.length === 0 && !loading && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
          No hay expediente con esos datos. Da de alta al paciente para ligar la consulta.
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {matches.map((paciente) => (
            <div key={paciente.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                  <UserRound className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm">{paciente.nombre_completo}</p>
                  <p className="text-xs text-slate-500">
                    Exp. {paciente.numero_expediente} · {paciente.fecha_nacimiento} · {paciente.edad || 'edad s/d'} · {paciente.sexo || 'sexo s/d'}
                  </p>
                  {paciente.curp && <p className="text-[11px] font-mono text-slate-400">CURP {paciente.curp}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => handleConfirm(paciente)}
                  disabled={confirmingId === paciente.id || locked}
                  className="btn-primary py-1.5 px-3 text-xs flex-shrink-0"
                >
                  {confirmingId === paciente.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Abrir consulta
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm text-teal-700 font-medium"
          disabled={locked}
          onClick={() => {
            setShowAlta(true);
            setAlta((prev) => seedAltaFromSearch(q, query, prev));
          }}
        >
          Paciente nuevo — dar de alta
        </button>
        {showAlta && (
          <button type="button" className="text-xs text-slate-500" onClick={() => setShowAlta(false)}>
            <X className="w-3.5 h-3.5 inline" /> Cerrar alta
          </button>
        )}
      </div>

      {(showAlta || altaRequerida) && (
        <form onSubmit={handleAlta} className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-800">Alta de expediente maestro</h3>
          </div>
          <p className="text-xs text-slate-500">
            Obligatorio: nombre, apellido paterno, fecha de nacimiento, sexo y domicilio (NOM-004 5.2.3 / 5.9).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NombreCompletoFields
              value={{
                nombre_completo: alta.nombre_completo,
                nombre: alta.nombre,
                apellido_paterno: alta.apellido_paterno,
                apellido_materno: alta.apellido_materno,
              }}
              onChange={(next) => setAlta((prev) => ({ ...prev, ...next }))}
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fecha de nacimiento *</label>
              <input required type="date" value={alta.fecha_nacimiento} onChange={(e) => setAlta((a) => ({ ...a, fecha_nacimiento: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sexo *</label>
              <select required value={alta.sexo} onChange={(e) => setAlta((a) => ({ ...a, sexo: e.target.value }))} className="input-field">
                <option value="">Seleccionar</option>
                <option value="Femenino">Femenino</option>
                <option value="Masculino">Masculino</option>
                <option value="Otro">Otro</option>
              </select>
            </div>
            <Field label="CURP" value={alta.curp} onChange={(v) => setAlta((a) => ({ ...a, curp: v.toUpperCase() }))} />
            <Field required label="Domicilio" value={alta.domicilio} onChange={(v) => setAlta((a) => ({ ...a, domicilio: v }))} className="sm:col-span-2" />
            <Field label="Ocupación" value={alta.ocupacion} onChange={(v) => setAlta((a) => ({ ...a, ocupacion: v }))} />
            <Field label="Alergias" value={alta.alergias} onChange={(v) => setAlta((a) => ({ ...a, alergias: v }))} />
            <Field label="Antecedentes crónicos" value={alta.cronicos} onChange={(v) => setAlta((a) => ({ ...a, cronicos: v }))} className="sm:col-span-2" />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700 bg-white rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              required
              className="mt-1"
              checked={alta.consentimiento}
              onChange={(e) => setAlta((a) => ({ ...a, consentimiento: e.target.checked }))}
            />
            <span>
              Acepto el aviso de privacidad y el tratamiento de datos personales del expediente clínico
              (LFPDPPP). Obligatorio para el alta de pacientes nuevos.
            </span>
          </label>
          <button type="submit" disabled={loading || locked || !alta.consentimiento} className="btn-primary w-full py-2.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
            Crear expediente y abrir consulta
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, required, placeholder, className, disabled,
}: {
  label: string; value: string; onChange: (value: string) => void;
  required?: boolean; placeholder?: string; className?: string; disabled?: boolean;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <input
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
        placeholder={placeholder}
      />
    </div>
  );
}
