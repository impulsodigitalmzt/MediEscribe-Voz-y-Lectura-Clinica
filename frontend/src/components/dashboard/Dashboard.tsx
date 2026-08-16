import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import PatientSearch from '../patient/PatientSearch';
import type { PacienteExpediente } from '../../types';
import { getGreeting } from '../../utils';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.full_name?.split(' ')[0] || 'doctor';

  const openExpediente = (paciente: PacienteExpediente) => {
    navigate(`/pacientes/${paciente.id}`);
  };

  return (
    <div className="min-h-full">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 lg:py-16">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Panel clínico</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 mt-1 tracking-tight">
            Expediente de pacientes
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            Buen{getGreeting() === 'morning' ? 'os días' : getGreeting() === 'afternoon' ? 'as tardes' : 'as noches'}, {firstName}.
            Identifique al paciente por nombre, CURP o número de expediente antes de abrir una consulta.
          </p>
        </div>

        <div className="card p-5 sm:p-7">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Buscar paciente</h2>
          <PatientSearch onSelect={openExpediente} />
        </div>
      </div>
    </div>
  );
}
