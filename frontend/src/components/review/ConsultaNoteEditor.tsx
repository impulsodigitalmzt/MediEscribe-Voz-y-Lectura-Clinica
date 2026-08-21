import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api, { ConsultaValidacionError } from '../../services/api';
import type { ConsultaHistorialItem, ConsultaMedica, DictamenNom004, NotaAclaracion, NotaClinica, RecetaPaciente } from '../../types';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, FileText, Loader2, Mic, Plus, Printer, Save, Trash2, Upload,
} from 'lucide-react';
import clsx from 'clsx';

const EMPTY_NOTA: NotaClinica = {
  nombre_paciente: '', edad: '', sexo: '', domicilio: '', ocupacion: '',
  fecha: '', hora: '', medico_nombre: '', medico_cedula: '', medico_especialidad: '',
  motivo_consulta: '', padecimiento_actual: '', interrogatorio: '',
  antecedentes_personales: '', antecedentes_quirurgicos: '', medicamentos: '',
  alergias: '', antecedentes_familiares: '', antecedentes_sociales: '',
  exploracion_fisica: '', signos_vitales: {
    ta_sistolica: '', ta_diastolica: '', temperatura: '', fc: '', fr: '',
    spo2: '', peso: '', talla: '', imc: '', glucosa: '',
  }, estudios: '', solicitudes_estudio: [], diagnostico_presuntivo: '',
  diagnosticos_diferenciales: '', diagnostico: '', diagnostico_cie10: '', pronostico: '', plan: '',
  tratamiento: [], seguimiento: '', notas_evolucion: '', resumen: '',
  subjetivo: '', objetivo: '', analisis: '',
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

export default function ConsultaNoteEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [consulta, setConsulta] = useState<ConsultaMedica | null>(null);
  const [nota, setNota] = useState<NotaClinica>(EMPTY_NOTA);
  const [receta, setReceta] = useState<RecetaPaciente>(EMPTY_RECETA);
  const [guardia, setGuardia] = useState<DictamenNom004 | undefined>();
  const [historial, setHistorial] = useState<ConsultaHistorialItem[]>([]);
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
    setHistorial((prev) => row.historial ?? prev);
    setAclaraciones(row.aclaraciones ?? []);
    if (typeof row.transcripcion === 'string' && row.transcripcion.trim()) {
      setDictado(row.transcripcion);
    }
  };

  useEffect(() => {
    if (!id) return;
    api.getConsulta(id).then(hydrate).catch(() => setError('No se pudo cargar la consulta.')).finally(() => setLoading(false));
  }, [id]);

  const locked = consultaCerrada(consulta?.estado);
  const maestroLocked = Boolean(consulta?.paciente) || locked;
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
      setError('Dicta o pega al menos unas frases de la consulta.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const result = await api.procesarConsultaTexto(dictado, pacienteId, consulta?.especialidad || 'medicina_general', extras);
      hydrate(result.consulta);
      if (result.transcripcion?.trim()) setDictado(result.transcripcion);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      setGuardia(result.guardia_legal);
      setSavedMsg('Nota SOAP sintetizada. El borrador de dictado se conserva. Revise y guarde.');
    } catch (err) {
      if (err instanceof ConsultaValidacionError) {
        if (err.nota) setNota({ ...EMPTY_NOTA, ...err.nota });
        setError(`Complete los datos faltantes: ${err.guia.join(' ')}`);
        return;
      }
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
      if (result.transcripcion?.trim()) setDictado(result.transcripcion);
      if (result.nota) setNota({ ...EMPTY_NOTA, ...result.nota });
      if (result.receta) setReceta({ ...EMPTY_RECETA, ...result.receta, medicamentos: result.receta.medicamentos ?? [] });
      setGuardia(result.guardia_legal);
      setSavedMsg('Audio enviado al Worker (Whisper → SOAP). El borrador muestra la transcripción. Revise y guarde.');
    } catch (err) {
      if (err instanceof ConsultaValidacionError) {
        if (err.nota) setNota({ ...EMPTY_NOTA, ...err.nota });
        setError(`Complete los datos faltantes: ${err.guia.join(' ')}`);
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo procesar el audio.');
    } finally {
      setGenerating(false);
    }
  };

  const setField = (key: keyof NotaClinica, value: string) => {
    setNota((prev) => ({ ...prev, [key]: value }));
    setSavedMsg('');
  };

  const patchRecetaMed = (
    index: number,
    key: 'medicamento' | 'dosis' | 'via' | 'periodicidad' | 'instruccion',
    value: string,
  ) => {
    setReceta((r) => {
      const meds = [...(r.medicamentos ?? [])];
      meds[index] = { ...meds[index], [key]: value };
      return { ...r, medicamentos: meds };
    });
    setSavedMsg('');
  };

  const setTratamiento = (index: number, key: 'medicamento' | 'dosis' | 'via' | 'periodicidad', value: string) => {
    setNota((prev) => {
      const rows = [...(prev.tratamiento ?? [])];
      rows[index] = { ...rows[index], [key]: value };
      return { ...prev, tratamiento: rows };
    });
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
        setReceta({
          ...EMPTY_RECETA,
          ...result.receta,
          medicamentos: result.receta.medicamentos ?? [],
        });
      }
      setGuardia(result.guardia_legal);
      setSavedMsg('Correcciones guardadas en el expediente.');
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
        setReceta({
          ...EMPTY_RECETA,
          ...result.receta,
          medicamentos: result.receta.medicamentos ?? [],
        });
      }
      setGuardia(result.guardia_legal);
      setSavedMsg('Nota cerrada (locked). El registro queda inmutable (NOM-004 5.11).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo finalizar.');
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
      setSavedMsg('Nota de aclaración registrada y locked. La nota original no se modificó.');
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
      `Domicilio: ${nota.domicilio}`,
      `Fecha: ${nota.fecha} ${nota.hora}`,
      '',
      `Motivo: ${nota.motivo_consulta}`,
      `Padecimiento actual: ${nota.padecimiento_actual}`,
      `Exploración física: ${nota.exploracion_fisica}`,
      `Diagnóstico: ${nota.diagnostico}`,
      `Pronóstico: ${nota.pronostico}`,
      `Plan: ${nota.plan}`,
      `Resumen: ${nota.resumen}`,
      '',
      ...aclaraciones.map((item) => [
        `${item.tipo === 'rectificacion' ? 'RECTIFICACIÓN' : 'ACLARACIÓN'} (${item.estado})`,
        item.sello_responsable,
        item.motivo,
        item.contenido,
      ].join('\n')),
    ].filter(Boolean).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nota-clinica-${id ?? 'consulta'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setSavedMsg('Nota exportada con sello de identidad profesional.');
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0 no-print">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate('/dashboard')} className="btn-icon"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-800">Consulta activa — nota NOM-004 y receta</h1>
            <p className="text-xs text-slate-500 truncate">
              {consulta?.paciente?.nombre_completo || consulta?.paciente_nombre} · Exp. {consulta?.paciente?.numero_expediente}
              {receta.idioma_nombre ? ` · Receta en ${receta.idioma_nombre}` : ''}
            </p>
          </div>
        </div>
        {!locked && (
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="btn-secondary py-1.5 px-3 text-xs">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar correcciones
            </button>
            <button onClick={handleFinalizar} disabled={finalizing} className="btn-primary py-1.5 px-3 text-xs ml-auto">
              {finalizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Cerrar nota (locked)
            </button>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={() => window.print()} className="btn-secondary py-1.5 px-3 text-xs">
            <Printer className="w-3.5 h-3.5" /> Imprimir nota
          </button>
          <button type="button" onClick={handleExportarNota} className="btn-secondary py-1.5 px-3 text-xs">
            <Download className="w-3.5 h-3.5" /> Exportar nota
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-3">
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
            <div className="no-print p-3 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-xs space-y-1">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                Consulta locked. La nota original es inmutable (NOM-004 5.11).
              </p>
              <p>Para enmendar un error, registra una nota de aclaración o rectificación. No se altera el documento cerrado.</p>
            </div>
          )}
          {guardia && !guardia.cumple && (
            <div className="no-print p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <p className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Faltantes NOM-004-SSA3-2012</p>
              <ul className="list-disc pl-5 space-y-0.5">{guardia.guia.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          {consulta?.paciente && (
            <div className="no-print card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700 mb-1">Expediente maestro (ya cargado)</p>
              <p className="font-semibold text-slate-800">{consulta.paciente.nombre_completo}</p>
              <p className="text-xs text-slate-500">
                Exp. {consulta.paciente.numero_expediente} · {consulta.paciente.fecha_nacimiento} · {consulta.paciente.edad} · {consulta.paciente.sexo}
                {consulta.paciente.curp ? ` · CURP ${consulta.paciente.curp}` : ''}
              </p>
              <p className="text-xs text-slate-500">{consulta.paciente.domicilio}</p>
              {(consulta.paciente.antecedentes_importantes.alergias || consulta.paciente.antecedentes_importantes.cronicos) && (
                <p className="text-xs text-red-700 mt-2">
                  {consulta.paciente.antecedentes_importantes.alergias ? `Alergias: ${consulta.paciente.antecedentes_importantes.alergias}. ` : ''}
                  {consulta.paciente.antecedentes_importantes.cronicos ? `Crónicos: ${consulta.paciente.antecedentes_importantes.cronicos}` : ''}
                </p>
              )}
              {historial.filter((item) => item.id !== consulta.id).length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500">Consultas previas</p>
                  {historial.filter((item) => item.id !== consulta.id).slice(0, 5).map((item) => (
                    <p key={item.id} className="text-[11px] text-slate-500">
                      {String(item.fecha_hora).slice(0, 10)} — {item.diagnostico || item.motivo_consulta || 'Consulta previa'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {!locked && (
            <div className="no-print card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Dictado / captura de esta consulta</p>
              <p className="text-xs text-slate-500">La identidad ya está en el expediente. Graba o pega la conversación; la IA redacta la nota en español y la receta en el idioma nativo.</p>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <Upload className="w-3.5 h-3.5 text-teal-600" />
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
                  className="text-[11px] file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-700"
                  onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <textarea
                value={dictado}
                onChange={(e) => setDictado(e.target.value)}
                placeholder="Dictado o transcripción de la consulta de hoy..."
                className="w-full min-h-[96px] p-3 rounded-lg border border-slate-200 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary py-1.5 px-3 text-xs" disabled={!audioFile || generating} onClick={handleGenerarDesdeAudio}>
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                  Audio → nota + receta
                </button>
                <button type="button" className="btn-primary py-1.5 px-3 text-xs" disabled={generating || dictado.trim().length < 20} onClick={handleGenerarDesdeTexto}>
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  Generar desde dictado
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <div className="space-y-3 no-print">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Nota médica (español · NOM-004) — se guarda en el expediente</p>

          <Section title="Identificación del paciente">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Nombre completo" value={nota.nombre_paciente} onChange={(v) => setField('nombre_paciente', v)} locked={maestroLocked} />
              <Input label="Edad" value={nota.edad} onChange={(v) => setField('edad', v)} locked={maestroLocked} />
              <Input label="Sexo" value={nota.sexo} onChange={(v) => setField('sexo', v)} locked={maestroLocked} />
              <Input label="Ocupación" value={nota.ocupacion} onChange={(v) => setField('ocupacion', v)} locked={maestroLocked} />
              <Input label="Domicilio" value={nota.domicilio} onChange={(v) => setField('domicilio', v)} locked={maestroLocked} className="sm:col-span-2" />
              <Input label="Fecha" value={nota.fecha} onChange={(v) => setField('fecha', v)} locked={locked} />
              <Input label="Hora" value={nota.hora} onChange={(v) => setField('hora', v)} locked={locked} />
              <Input label="Médico" value={nota.medico_nombre} onChange={(v) => setField('medico_nombre', v)} locked />
              <Input label="Cédula" value={nota.medico_cedula} onChange={(v) => setField('medico_cedula', v)} locked />
              <Input label="Especialidad" value={nota.medico_especialidad} onChange={(v) => setField('medico_especialidad', v)} locked className="sm:col-span-2" />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-800 border-t border-slate-100 pt-3 sello-profesional">
              {selloActual}
            </p>
          </Section>

          <Area label="Motivo de consulta" value={nota.motivo_consulta} onChange={(v) => setField('motivo_consulta', v)} locked={locked} />
          <Area label="Padecimiento actual" value={nota.padecimiento_actual} onChange={(v) => setField('padecimiento_actual', v)} locked={locked} />
          <Area label="Interrogatorio" value={nota.interrogatorio} onChange={(v) => setField('interrogatorio', v)} locked={locked} />
          <Area label="Exploración física" value={nota.exploracion_fisica} onChange={(v) => setField('exploracion_fisica', v)} locked={locked} />
          <Area label="Diagnóstico" value={nota.diagnostico} onChange={(v) => setField('diagnostico', v)} locked={locked} />
          <Area label="Pronóstico" value={nota.pronostico} onChange={(v) => setField('pronostico', v)} locked={locked} />
          <Area label="Plan terapéutico" value={nota.plan} onChange={(v) => setField('plan', v)} locked={locked} />

          <Section title="Tratamiento estructurado (dosis, vía, periodicidad)">
            {(nota.tratamiento ?? []).map((row, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-8 gap-2 mb-2">
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Medicamento" value={row.medicamento} disabled={locked} onChange={(e) => setTratamiento(index, 'medicamento', e.target.value)} />
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Dosis" value={row.dosis} disabled={locked} onChange={(e) => setTratamiento(index, 'dosis', e.target.value)} />
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Vía" value={row.via} disabled={locked} onChange={(e) => setTratamiento(index, 'via', e.target.value)} />
                <input className="input-field sm:col-span-1 py-2 text-sm" placeholder="Periodicidad" value={row.periodicidad} disabled={locked} onChange={(e) => setTratamiento(index, 'periodicidad', e.target.value)} />
                {!locked && (
                  <button type="button" className="btn-icon" onClick={() => setNota((prev) => ({ ...prev, tratamiento: prev.tratamiento.filter((_, i) => i !== index) }))}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {!locked && (
              <button type="button" className="btn-secondary py-1.5 px-3 text-xs" onClick={() => setNota((prev) => ({ ...prev, tratamiento: [...(prev.tratamiento ?? []), { medicamento: '', dosis: '', via: '', periodicidad: '' }] }))}>
                <Plus className="w-3.5 h-3.5" /> Agregar medicamento
              </button>
            )}
          </Section>

          <Area label="Notas de evolución" value={nota.notas_evolucion} onChange={(v) => setField('notas_evolucion', v)} locked={locked} />
          <Area label="Antecedentes personales" value={nota.antecedentes_personales} onChange={(v) => setField('antecedentes_personales', v)} locked={locked} />
          <Area label="Alergias" value={nota.alergias} onChange={(v) => setField('alergias', v)} locked={locked} />
          <Area label="Estudios" value={nota.estudios} onChange={(v) => setField('estudios', v)} locked={locked} />
          <Area label="Seguimiento" value={nota.seguimiento} onChange={(v) => setField('seguimiento', v)} locked={locked} />
          <Area label="Resumen" value={nota.resumen} onChange={(v) => setField('resumen', v)} locked={locked} />
          </div>

          <div className="space-y-3 receta-print">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Receta / indicaciones ({receta.idioma_nombre || receta.idioma || 'idioma nativo'})
              </p>
              <button type="button" className="btn-secondary py-1 px-2 text-[11px] ml-auto" onClick={() => window.print()}>
                <Printer className="w-3.5 h-3.5" /> Imprimir
              </button>
              <button
                type="button"
                className="btn-secondary py-1 px-2 text-[11px]"
                onClick={async () => {
                  const text = [
                    receta.titulo, receta.resumen, receta.indicaciones,
                    receta.medicamentos?.map((m) => [m.medicamento, m.dosis, m.via, m.periodicidad, m.instruccion].filter(Boolean).join(' — ')).join('\n'),
                    receta.alarmas, receta.seguimiento,
                  ].filter(Boolean).join('\n\n');
                  await navigator.clipboard.writeText(text);
                  setSavedMsg('Receta copiada. Lista para enviar al paciente.');
                }}
              >
                <Copy className="w-3.5 h-3.5" /> Copiar
              </button>
            </div>
            <Area label="Título" value={receta.titulo} onChange={(v) => setReceta((r) => ({ ...r, titulo: v }))} locked={locked} />
            <Area label="Resumen para el paciente" value={receta.resumen} onChange={(v) => setReceta((r) => ({ ...r, resumen: v }))} locked={locked} />
            <Area label="Indicaciones" value={receta.indicaciones} onChange={(v) => setReceta((r) => ({ ...r, indicaciones: v }))} locked={locked} />
            <Section title="Medicamentos (idioma del paciente)">
              {(receta.medicamentos ?? []).map((row, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 mb-2">
                  <div className="flex gap-2">
                    <input className="input-field py-2 text-sm" placeholder="Medicamento" value={row.medicamento} disabled={locked} onChange={(e) => patchRecetaMed(index, 'medicamento', e.target.value)} />
                    {!locked && (
                      <button type="button" className="btn-icon no-print" onClick={() => setReceta((r) => ({ ...r, medicamentos: r.medicamentos.filter((_, i) => i !== index) }))}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input className="input-field py-2 text-sm" placeholder="Dosis" value={row.dosis} disabled={locked} onChange={(e) => patchRecetaMed(index, 'dosis', e.target.value)} />
                    <input className="input-field py-2 text-sm" placeholder="Vía" value={row.via} disabled={locked} onChange={(e) => patchRecetaMed(index, 'via', e.target.value)} />
                    <input className="input-field py-2 text-sm" placeholder="Periodicidad" value={row.periodicidad} disabled={locked} onChange={(e) => patchRecetaMed(index, 'periodicidad', e.target.value)} />
                  </div>
                  <textarea className="w-full min-h-[64px] p-2 rounded-lg border border-slate-200 text-sm" placeholder="Instrucción" value={row.instruccion} disabled={locked} onChange={(e) => patchRecetaMed(index, 'instruccion', e.target.value)} />
                </div>
              ))}
              {!locked && (
                <button type="button" className="btn-secondary py-1.5 px-3 text-xs no-print" onClick={() => setReceta((r) => ({
                  ...r,
                  medicamentos: [...(r.medicamentos ?? []), { medicamento: '', dosis: '', via: '', periodicidad: '', instruccion: '' }],
                }))}>
                  <Plus className="w-3.5 h-3.5" /> Agregar medicamento
                </button>
              )}
            </Section>
            <Area label="Alarmas / cuándo regresar" value={receta.alarmas} onChange={(v) => setReceta((r) => ({ ...r, alarmas: v }))} locked={locked} />
            <Area label="Seguimiento" value={receta.seguimiento} onChange={(v) => setReceta((r) => ({ ...r, seguimiento: v }))} locked={locked} />
            <p className="text-xs font-semibold text-slate-800 border-t border-slate-100 pt-3 sello-profesional">
              {selloActual}
            </p>
          </div>
          </div>

          {(locked || aclaraciones.length > 0) && (
            <div className="no-print card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Notas de aclaración / rectificación</h3>
              <p className="text-xs text-slate-500">
                Enmienda legal y auditable. La nota original locked no se modifica (NOM-004 5.11).
              </p>
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
                  <textarea
                    className="w-full min-h-[64px] p-3 rounded-lg border border-slate-200 text-sm"
                    placeholder="Motivo (por qué se emite esta nota)"
                    value={aclaracionMotivo}
                    onChange={(e) => setAclaracionMotivo(e.target.value)}
                  />
                  <textarea
                    className="w-full min-h-[96px] p-3 rounded-lg border border-slate-200 text-sm"
                    placeholder="Contenido de la aclaración o rectificación"
                    value={aclaracionContenido}
                    onChange={(e) => setAclaracionContenido(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary py-1.5 px-3 text-xs"
                    disabled={savingAclaracion || aclaracionMotivo.trim().length < 8 || aclaracionContenido.trim().length < 12}
                    onClick={handleCrearAclaracion}
                  >
                    {savingAclaracion ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Registrar y cerrar nota de {aclaracionTipo === 'rectificacion' ? 'rectificación' : 'aclaración'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="expediente-print hidden print:block text-sm space-y-3">
            <h1 className="text-lg font-bold">Nota clínica — NOM-004-SSA3-2012</h1>
            <p className="font-semibold">{selloActual}</p>
            <p>Paciente: {nota.nombre_paciente} · {nota.edad} · {nota.sexo}</p>
            <p>Domicilio: {nota.domicilio}</p>
            <p>Fecha y hora: {nota.fecha} {nota.hora}</p>
            <p><strong>Motivo:</strong> {nota.motivo_consulta}</p>
            <p><strong>Padecimiento actual:</strong> {nota.padecimiento_actual}</p>
            <p><strong>Exploración física:</strong> {nota.exploracion_fisica}</p>
            <p><strong>Diagnóstico:</strong> {nota.diagnostico}</p>
            <p><strong>Pronóstico:</strong> {nota.pronostico}</p>
            <p><strong>Plan:</strong> {nota.plan}</p>
            <p><strong>Resumen:</strong> {nota.resumen}</p>
            {aclaraciones.map((item) => (
              <div key={item.id} className="border-t pt-2">
                <p className="font-semibold">{item.tipo === 'rectificacion' ? 'Rectificación' : 'Aclaración'}</p>
                <p>{item.motivo}</p>
                <p className="whitespace-pre-wrap">{item.contenido}</p>
                <p className="font-semibold">{item.sello_responsable}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="note-section">
      <h3 className="section-header">{title}</h3>
      {children}
    </div>
  );
}

function Input({ label, value, onChange, locked, className }: { label: string; value: string; onChange: (v: string) => void; locked: boolean; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      <input className="input-field py-2 text-sm" value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Area({ label, value, onChange, locked }: { label: string; value: string; onChange: (v: string) => void; locked: boolean }) {
  const missing = !value || value === '[NO MENCIONADO]';
  return (
    <div className={clsx(missing ? 'note-section-missing' : 'note-section')}>
      <label className="section-header">{label}</label>
      <textarea
        className="w-full min-h-[96px] p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y disabled:bg-slate-50"
        value={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
