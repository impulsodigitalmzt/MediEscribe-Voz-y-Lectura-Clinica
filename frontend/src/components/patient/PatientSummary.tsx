import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowLeft, Calendar, FileText, Loader2, MapPin, Stethoscope, UserRound,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import type { ConsultaHistorialItem, PacienteExpediente } from '../../types';
import clsx from 'clsx';

function estadoLabel(estado?: string | null) {
  if (estado === 'locked' || estado === 'finalizada') return 'Cerrada';
  if (estado === 'borrador') return 'Borrador';
  return estado || 'Consulta';
}

export default function PatientSummary() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [paciente, setPaciente] = useState<PacienteExpediente | null>(null);
  const [historial, setHistorial] = useState<ConsultaHistorialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getPaciente(id)
      .then((data) => {
        setPaciente(data.paciente);
        setHistorial(data.historial ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el expediente.'))
      .finally(() => setLoading(false));
  }, [id]);

  const iniciarConsulta = async () => {
    if (!paciente) return;
    setStarting(true);
    setError('');
    try {
      const { consulta } = await api.abrirConsulta({
        pacienteId: paciente.id,
        especialidad: user?.specialty || 'medicina_general',
        medicoNombre: user?.full_name,
        medicoCedula: user?.credentials,
      });
      navigate(`/consulta/${consulta.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la consulta.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-7 h-7 text-teal-700 animate-spin" />
      </div>
    );
  }

  if (!paciente) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-slate-600">{error || 'Expediente no disponible.'}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => navigate('/dashboard')}>
          Volver al buscador
        </button>
      </div>
    );
  }

  const antecedentes = paciente.antecedentes_importantes;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <button type="button" className="btn-icon mt-0.5" onClick={() => navigate('/dashboard')} aria-label="Volver">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Resumen del paciente</p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-0.5 truncate">{paciente.nombre_completo}</h1>
          <p className="text-sm text-slate-500">Expediente {paciente.numero_expediente}</p>
        </div>
        <button type="button" className="btn-primary" disabled={starting} onClick={iniciarConsulta}>
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />}
          Iniciar Nueva Consulta
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <UserRound className="w-4 h-4 text-teal-700" />
          Datos demográficos
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <Item label="Fecha de nacimiento" value={paciente.fecha_nacimiento} />
          <Item label="Edad" value={paciente.edad || '—'} />
          <Item label="Sexo" value={paciente.sexo || '—'} />
          <Item label="CURP" value={paciente.curp || '—'} />
          <Item label="Ocupación" value={paciente.ocupacion || '—'} />
          <Item label="Domicilio" value={paciente.domicilio || '—'} icon />
        </dl>
        {(antecedentes?.alergias || antecedentes?.cronicos) && (
          <div className="mt-5 pt-4 border-t border-slate-100 text-sm">
            {antecedentes.alergias && (
              <p className="text-red-800"><span className="font-medium">Alergias:</span> {antecedentes.alergias}</p>
            )}
            {antecedentes.cronicos && (
              <p className="text-slate-700 mt-1"><span className="font-medium">Crónicos:</span> {antecedentes.cronicos}</p>
            )}
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-teal-700" />
          Historial de consultas
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-500">Sin consultas previas. Este será el primer registro del expediente.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {historial.map((item) => (
              <li key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-800">
                        {formatFecha(item.fecha_hora)}
                      </p>
                      <span className={clsx(
                        'badge',
                        item.estado === 'locked' || item.estado === 'finalizada' ? 'badge-slate' : 'badge-teal'
                      )}>
                        {estadoLabel(item.estado)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {item.diagnostico || item.motivo_consulta || item.resumen || 'Consulta registrada'}
                    </p>
                    {item.plan && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.plan}</p>}
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-teal-700 hover:text-teal-800"
                    onClick={() => navigate(`/consulta/${item.id}`)}
                  >
                    Ver
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-400 mt-4">
          El historial es de solo lectura. Las notas cerradas no se modifican (NOM-004 5.11).
        </p>
      </section>
    </div>
  );
}

function Item({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</dt>
      <dd className="text-slate-800 mt-0.5 flex items-start gap-1.5">
        {icon && <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />}
        {value}
      </dd>
    </div>
  );
}

function formatFecha(value: string) {
  try {
    return format(new Date(value), "d MMM yyyy, HH:mm", { locale: es });
  } catch {
    return String(value).slice(0, 16);
  }
}
