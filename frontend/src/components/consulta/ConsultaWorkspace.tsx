import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Download, FileText, Loader2, Lock, Save,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import type { ConsultaMedica, DictamenNom004, NotaAclaracion, NotaClinica, RecetaPaciente } from '../../types';
import PhysicianIdentityBar from './PhysicianIdentityBar';
import VoiceDictationPanel from './VoiceDictationPanel';
import NoteEditor from './NoteEditor';

const EMPTY_NOTA: NotaClinica = {
  nombre_paciente: '', edad: '', sexo: '', domicilio: '', ocupacion: '',
  fecha: '', hora: '', medico_nombre: '', medico_cedula: '', medico_especialidad: '',
  motivo_consulta: '', padecimiento_actual: '', interrogatorio: '',
  antecedentes_personales: '', antecedentes_quirurgicos: '', medicamentos: '',
  alergias: '', antecedentes_familiares: '', antecedentes_sociales: '',
  exploracion_fisica: '', estudios: '', diagnostico_presuntivo: '',
  diagnosticos_diferenciales: '', diagnostico: '', pronostico: '', plan: '',
  tratamiento: [], seguimiento: '', notas_evolucion: '', resumen: '',
  campos_inciertos: [], secciones_faltantes: [], sello_responsable: '',
};

const EMPTY_RECETA: RecetaPaciente = {
  idioma: '', idioma_nombre: '', titulo: '', resumen: '', indicaciones: '',
  medicamentos: [], alarmas: '', seguimiento: '',
};

function consultaCerrada(estado?: string | null) {
  return estado === 'locked' || estado === 'finalizada';
}

function selloDesdeSesion(nombre: string, cedula: string, especialidad = '') {
  const n = nombre.trim() || 'Médico no identificado';
  const c = cedula.trim() || 'sin cédula';
  const e = especialidad.trim() || 'sin especialidad';
  return `Responsable: ${n} | Cédula: ${c} | Especialidad: ${e}`;
}

export default function ConsultaWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [consulta, setConsulta] = useState<ConsultaMedica | null>(null);
  const [nota, setNota] = useState<NotaClinica>(EMPTY_NOTA);
  const [receta, setReceta] = useState<RecetaPaciente>(EMPTY_RECETA);
  const [guardia, setGuardia] = useState<DictamenNom004 | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [dictado, setDictado] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [aclaraciones, setAclaraciones] = useState<NotaAclaracion[]>([]);
  const [aclaracionTipo, setAclaracionTipo] = useState<'aclaracion' | 'rectificacion'>('aclaracion');
  const [aclaracionMotivo, setAclaracionMotivo] = useState('');
  const [aclaracionContenido, setAclaracionContenido] = useState('');
  const [savingAclaracion, setSavingAclaracion] = useState(false);

  const hydrate = (row: ConsultaMedica) => {
    setConsulta(row);
    const incoming: NotaClinica = { ...EMPTY_NOTA, ...(row.nota_estructurada ?? {}) };
    if (!consultaCerrada(row.estado) && user) {
      incoming.medico_nombre = user.full_name || incoming.medico_nombre;
      incoming.medico_cedula = user.credentials || incoming.medico_cedula;
      incoming.medico_especialidad = user.specialty || incoming.medico_especialidad;
      incoming.sello_responsable = selloDesdeSesion(
        incoming.medico_nombre,
        incoming.medico_cedula,
        incoming.medico_especialidad
      );
    }
    setNota(incoming);
    setReceta({
      ...EMPTY_RECETA,
      ...(row.receta_paciente_nativo ?? {}),
      medicamentos: row.receta_paciente_nativo?.medicamentos ?? [],
    });
    setGuardia(row.guardia_legal);
    setAclaraciones(row.aclaraciones ?? []);
    if (row.transcripcion) setDictado(row.transcripcion);
  };

  useEffect(() => {
    if (!id) return;
    api.getConsulta(id).then(hydrate).catch(() => setError('No se pudo cargar la consulta.')).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const locked = consultaCerrada(consulta?.estado);
  const pacienteId = consulta?.paciente_id || consulta?.paciente?.id || '';

  useEffect(() => {
    if (!user || locked) return;
    setNota((n) => ({
      ...n,
      medico_nombre: user.full_name || n.medico_nombre,
      medico_cedula: user.credentials || n.medico_cedula,
      medico_especialidad: user.specialty || n.medico_especialidad,
      sello_responsable: selloDesdeSesion(
        user.full_name || n.medico_nombre,
        user.credentials || n.medico_cedula,
        user.specialty || n.medico_especialidad
      ),
    }));
  }, [user, locked]);

  const extras = {
    medicoNombre: user?.full_name,
    medicoCedula: user?.credentials,
    consultaId: id,
  };

  const handleGenerarDesdeTexto = async () => {
    if (!id || !pacienteId || locked) return;
    if (dictado.trim().length < 20) {
      setError('Dicte o pegue al menos unas frases de la consulta.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const result = await api.procesarConsultaTexto(dictado, pacienteId, consulta?.especialidad || 'medicina_general', extras);
      hydrate(result.consulta);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      if (result.transcripcion) setDictado(result.transcripcion);
      setGuardia(result.guardia_legal);
      setSavedMsg('Nota generada. Revise y guarde.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la nota.');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerarDesdeAudio = async () => {
    if (!id || !pacienteId || !audioFile || locked) return;
    setGenerating(true);
    setError('');
    try {
      const result = await api.procesarConsultaAudio(audioFile, pacienteId, consulta?.especialidad || 'medicina_general', extras);
      hydrate(result.consulta);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      if (result.transcripcion) setDictado(result.transcripcion);
      setGuardia(result.guardia_legal);
      setSavedMsg('Audio transcrito. Revise la nota y guarde.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el audio.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!id || locked) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.guardarConsultaNota(id, nota, receta);
      setConsulta(result.consulta);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) {
        setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      }
      setGuardia(result.guardia_legal);
      setSavedMsg('Correcciones guardadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizar = async () => {
    if (!id || locked) return;
    setFinalizing(true);
    setError('');
    try {
      const result = await api.finalizarConsulta(id, nota, receta);
      setConsulta(result.consulta);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) {
        setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      }
      setGuardia(result.guardia_legal);
      setSavedMsg('Consulta cerrada y bloqueada. El registro queda inmutable (NOM-004 5.11).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la consulta.');
    } finally {
      setFinalizing(false);
    }
  };

  const selloActual = nota.sello_responsable
    || selloDesdeSesion(user?.full_name || nota.medico_nombre, user?.credentials || nota.medico_cedula, user?.specialty || nota.medico_especialidad);

  const handleCrearAclaracion = async () => {
    if (!id || !locked) return;
    setSavingAclaracion(true);
    setError('');
    try {
      const created = await api.crearNotaAclaracion(id, {
        tipo: aclaracionTipo,
        motivo: aclaracionMotivo,
        contenido: aclaracionContenido,
      });
      setAclaraciones((prev) => [...prev, created]);
      setAclaracionMotivo('');
      setAclaracionContenido('');
      setSavedMsg('Nota de aclaración registrada. La nota original no se modificó.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la aclaración.');
    } finally {
      setSavingAclaracion(false);
    }
  };

  const handleExportarNota = () => {
    const text = [
      'NOTA CLÍNICA — NOM-004-SSA3-2012',
      selloActual,
      `Paciente: ${nota.nombre_paciente} · ${nota.edad} · ${nota.sexo}`,
      `Motivo: ${nota.motivo_consulta}`,
      `Diagnóstico: ${nota.diagnostico}`,
      `Plan: ${nota.plan}`,
    ].filter(Boolean).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nota-clinica-${id ?? 'consulta'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-8 h-8 text-teal-700 animate-spin" />
      </div>
    );
  }

  const backTo = consulta?.paciente_id ? `/pacientes/${consulta.paciente_id}` : '/dashboard';

  return (
    <div className="flex flex-col min-h-full">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0 no-print sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button type="button" onClick={() => navigate(backTo)} className="btn-icon" aria-label="Volver">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-900">Consulta médica</h1>
            <p className="text-xs text-slate-500 truncate">
              {consulta?.paciente?.nombre_completo || consulta?.paciente_nombre}
              {consulta?.paciente?.numero_expediente ? ` · Exp. ${consulta.paciente.numero_expediente}` : ''}
            </p>
          </div>
          {!locked && (
            <div className="flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving} className="btn-secondary py-1.5 px-3 text-xs">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Guardar
              </button>
              <button type="button" onClick={handleFinalizar} disabled={finalizing} className="btn-primary py-1.5 px-3 text-xs">
                {finalizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Cerrar y Bloquear Consulta
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        <div className="max-w-6xl mx-auto space-y-4">
          {error && (
            <div className="no-print flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
          {savedMsg && (
            <div className="no-print flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {savedMsg}
            </div>
          )}
          {locked && (
            <div className="no-print p-3 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-xs">
              <p className="flex items-center gap-2 font-semibold">
                <Lock className="w-4 h-4" /> Consulta bloqueada. La nota original es inmutable (NOM-004 5.11).
              </p>
            </div>
          )}
          {guardia && !guardia.cumple && (
            <div className="no-print p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <p className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Faltantes NOM-004</p>
              <ul className="list-disc pl-5 space-y-0.5">{guardia.guia.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          <PhysicianIdentityBar user={user} />

          {!locked && (
            <VoiceDictationPanel
              dictado={dictado}
              onDictado={setDictado}
              audioFile={audioFile}
              onAudioFile={setAudioFile}
              generating={generating}
              onGenerateText={handleGenerarDesdeTexto}
              onGenerateAudio={handleGenerarDesdeAudio}
            />
          )}

          <NoteEditor
            nota={nota}
            receta={receta}
            locked={locked}
            sello={selloActual}
            onNota={(next) => { setNota(next); setSavedMsg(''); }}
            onReceta={(next) => { setReceta(next); setSavedMsg(''); }}
            onCopied={() => setSavedMsg('Receta copiada.')}
          />

          <div className="no-print flex gap-2">
            <button type="button" onClick={handleExportarNota} className="btn-secondary py-1.5 px-3 text-xs">
              <Download className="w-3.5 h-3.5" /> Exportar nota
            </button>
          </div>

          {(locked || aclaraciones.length > 0) && (
            <div className="no-print card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Notas de aclaración / rectificación</h3>
              {aclaraciones.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
                  <p className="font-semibold uppercase tracking-wide text-teal-700">
                    {item.tipo === 'rectificacion' ? 'Rectificación' : 'Aclaración'} · {item.estado}
                  </p>
                  <p className="text-slate-600">{item.motivo}</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{item.contenido}</p>
                  <p className="font-semibold text-slate-800">{item.sello_responsable}</p>
                </div>
              ))}
              {locked && (
                <div className="space-y-2">
                  <select
                    className="input-field py-2 text-sm"
                    value={aclaracionTipo}
                    onChange={(e) => setAclaracionTipo(e.target.value as 'aclaracion' | 'rectificacion')}
                  >
                    <option value="aclaracion">Aclaración</option>
                    <option value="rectificacion">Rectificación</option>
                  </select>
                  <textarea className="w-full min-h-[64px] p-3 rounded-lg border border-slate-200 text-sm" placeholder="Motivo" value={aclaracionMotivo} onChange={(e) => setAclaracionMotivo(e.target.value)} />
                  <textarea className="w-full min-h-[96px] p-3 rounded-lg border border-slate-200 text-sm" placeholder="Contenido" value={aclaracionContenido} onChange={(e) => setAclaracionContenido(e.target.value)} />
                  <button
                    type="button"
                    className="btn-primary py-1.5 px-3 text-xs"
                    disabled={savingAclaracion || aclaracionMotivo.trim().length < 8 || aclaracionContenido.trim().length < 12}
                    onClick={handleCrearAclaracion}
                  >
                    {savingAclaracion ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Registrar aclaración
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
