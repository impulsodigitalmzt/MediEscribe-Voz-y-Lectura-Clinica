import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import type { ConsultaHistorialItem, PacienteExpediente } from '../../types';
import PatientIdentificationScreen from '../patient/PatientIdentificationScreen';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function LiveEncounterScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState('');
  const [opening, setOpening] = useState(false);

  const abrirConsultaActiva = async (paciente: PacienteExpediente, _historial: ConsultaHistorialItem[]) => {
    setOpening(true);
    setErrorMsg('');
    try {
      const result = await api.abrirConsulta({
        pacienteId: paciente.id,
        especialidad: user?.preferred_template || 'medicina_general',
        medicoNombre: user?.full_name,
        medicoCedula: user?.credentials,
      });
      navigate(`/consulta/${result.consulta.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo abrir la consulta activa.');
      setOpening(false);
    }
  };

  return (
    <div className="p-5 lg:p-8 max-w-3xl mx-auto overflow-y-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Recepción — identificar paciente</h1>
      <p className="text-slate-500 mb-6 text-sm">
        Busca en el expediente maestro (nombre, apellido o CURP). Si ya existe, se cargan datos y antecedentes;
        si es nuevo, dalo de alta aquí. El alta de pacientes nuevos exige consentimiento de privacidad (LFPDPPP).
        Al confirmar se abre la consulta activa para el médico.
      </p>

      {opening && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Abriendo consulta con el expediente maestro...
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <PatientIdentificationScreen
        selected={null}
        locked={opening}
        onIdentified={abrirConsultaActiva}
      />
    </div>
  );
}
