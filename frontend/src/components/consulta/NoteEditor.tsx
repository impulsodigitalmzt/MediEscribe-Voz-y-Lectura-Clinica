import { useEffect, type ReactNode } from 'react';
import { Activity, Copy, Plus, Printer, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConsultaHistorialItem, NotaClinica, RecetaPaciente, SignosVitales } from '../../types';
import { vacioSignosVitales } from '../../types';

type Props = {
  nota: NotaClinica;
  receta: RecetaPaciente;
  locked: boolean;
  sello: string;
  historial?: ConsultaHistorialItem[];
  consultaId?: string;
  onNota: (next: NotaClinica) => void;
  onReceta: (next: RecetaPaciente) => void;
  onCopied: () => void;
};

function calcImc(peso: string, talla: string): string {
  const kg = Number.parseFloat(peso.replace(',', '.'));
  const cm = Number.parseFloat(talla.replace(',', '.'));
  if (!Number.isFinite(kg) || !Number.isFinite(cm) || kg <= 0 || cm <= 0) return '';
  const metros = cm > 3 ? cm / 100 : cm;
  return (kg / (metros * metros)).toFixed(2);
}

function etiquetaImc(imc: string): string {
  const n = Number.parseFloat(imc);
  if (!Number.isFinite(n)) return '';
  if (n < 18.5) return 'Bajo peso';
  if (n < 25) return 'Normal';
  if (n < 30) return 'Sobrepeso';
  return 'Obesidad';
}

export default function NoteEditor({
  nota, receta, locked, sello, historial = [], consultaId, onNota, onReceta, onCopied,
}: Props) {
  const signos = nota.signos_vitales ?? vacioSignosVitales();
  const previas = historial.filter((item) => item.id !== consultaId).slice(0, 6);

  const setField = (key: keyof NotaClinica, value: string) => {
    onNota({ ...nota, [key]: value });
  };

  const setSigno = (key: keyof SignosVitales, value: string) => {
    const next = { ...signos, [key]: value };
    if (key === 'peso' || key === 'talla') next.imc = calcImc(next.peso, next.talla);
    onNota({ ...nota, signos_vitales: next });
  };

  const setTratamiento = (index: number, key: 'medicamento' | 'dosis' | 'via' | 'periodicidad', value: string) => {
    const rows = [...(nota.tratamiento ?? [])];
    rows[index] = { ...rows[index], [key]: value };
    onNota({ ...nota, tratamiento: rows });
  };

  const patchRecetaMed = (
    index: number,
    key: 'medicamento' | 'dosis' | 'via' | 'periodicidad' | 'instruccion',
    value: string,
  ) => {
    const meds = [...(receta.medicamentos ?? [])];
    meds[index] = { ...meds[index], [key]: value };
    onReceta({ ...receta, medicamentos: meds });
  };

  const imcClase = etiquetaImc(signos.imc);

  useEffect(() => {
    const ids = {
      motivo_consulta: 'motivo_consulta',
      padecimiento_actual: 'padecimiento_actual',
      objetivo: 'objetivo',
      analisis: 'analisis',
      plan: 'plan',
    };
    console.log('[SOAP auditoría IDs]', {
      nota: {
        motivo_consulta: nota.motivo_consulta,
        padecimiento_actual: nota.padecimiento_actual,
        subjetivo: nota.subjetivo,
        objetivo: nota.objetivo,
        analisis: nota.analisis,
        plan: nota.plan,
      },
      dom: Object.fromEntries(
        Object.entries(ids).map(([key, id]) => {
          const el = document.getElementById(id) as HTMLTextAreaElement | null;
          return [key, { id, encontrado: Boolean(el), valorDom: el?.value ?? null, name: el?.getAttribute('name') ?? null }];
        }),
      ),
    });
  }, [nota.motivo_consulta, nota.padecimiento_actual, nota.subjetivo, nota.objetivo, nota.analisis, nota.plan]);

  return (
    <div className="space-y-4">
      <nav className="no-print flex flex-wrap gap-2 text-[11px] sticky top-14 z-[5] bg-slate-50/95 backdrop-blur py-2">
        {[
          ['#soap-s', 'S Subjetivo'],
          ['#soap-o', 'O Objetivo'],
          ['#soap-a', 'A Análisis'],
          ['#soap-p', 'P Plan'],
          ['#soap-receta', 'Receta'],
          ['#soap-historial', 'Historial'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-teal-400 hover:text-teal-800">
            {label}
          </a>
        ))}
      </nav>

      <p className="text-xs text-slate-500">
        Resumen de una sola página · SOAP alimenta los campos NOM-004-SSA3. Revise la síntesis de la IA; no es una transcripción.
      </p>

      {previas.length > 0 && (
        <section id="soap-historial" className="card p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Historial en contexto</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {previas.map((item) => (
              <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-700">
                <p className="font-semibold text-slate-800">{String(item.fecha_hora).slice(0, 16).replace('T', ' ')}</p>
                <p className="mt-0.5"><span className="text-slate-500">Motivo:</span> {item.motivo_consulta || '—'}</p>
                <p><span className="text-slate-500">Dx:</span> {item.diagnostico || '—'}</p>
                <p className="line-clamp-2"><span className="text-slate-500">Plan:</span> {item.plan || item.resumen || '—'}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <SoapCard id="soap-s" letter="S" title="Subjetivo" hint="Motivo, padecimiento e interrogatorio (NOM-004 6.1.1)">
          <Area id="motivo_consulta" name="motivo_consulta" label="Motivo de consulta" value={nota.motivo_consulta} onChange={(v) => setField('motivo_consulta', v)} locked={locked} compact />
          <Area
            id="padecimiento_actual"
            name="padecimiento_actual"
            label="Subjetivo / padecimiento actual"
            value={nota.padecimiento_actual || nota.subjetivo}
            onChange={(v) => onNota({ ...nota, padecimiento_actual: v, subjetivo: v })}
            locked={locked}
          />
          <Area label="Interrogatorio" value={nota.interrogatorio} onChange={(v) => setField('interrogatorio', v)} locked={locked} />
        </SoapCard>

        <SoapCard id="soap-o" letter="O" title="Objetivo" hint="Signos vitales, exploración y estudios">
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Signos vitales
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Vital label="TA sis" value={signos.ta_sistolica} onChange={(v) => setSigno('ta_sistolica', v)} locked={locked} />
              <Vital label="TA dia" value={signos.ta_diastolica} onChange={(v) => setSigno('ta_diastolica', v)} locked={locked} />
              <Vital label="Temp °C" value={signos.temperatura} onChange={(v) => setSigno('temperatura', v)} locked={locked} />
              <Vital label="FC lpm" value={signos.fc} onChange={(v) => setSigno('fc', v)} locked={locked} />
              <Vital label="FR rpm" value={signos.fr} onChange={(v) => setSigno('fr', v)} locked={locked} />
              <Vital label="SpO2 %" value={signos.spo2} onChange={(v) => setSigno('spo2', v)} locked={locked} />
              <Vital label="Peso kg" value={signos.peso} onChange={(v) => setSigno('peso', v)} locked={locked} />
              <Vital label="Talla cm" value={signos.talla} onChange={(v) => setSigno('talla', v)} locked={locked} />
              <Vital label="IMC" value={signos.imc} onChange={(v) => setSigno('imc', v)} locked={locked} />
              <Vital label="Glucosa" value={signos.glucosa} onChange={(v) => setSigno('glucosa', v)} locked={locked} />
            </div>
            {imcClase ? (
              <p className={clsx(
                'text-[11px] font-semibold inline-flex px-2 py-0.5 rounded-full',
                imcClase === 'Normal' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900',
              )}>
                IMC {signos.imc} · {imcClase}
              </p>
            ) : null}
          </div>
          <Area
            id="objetivo"
            name="objetivo"
            label="Objetivo / exploración física"
            value={nota.objetivo || nota.exploracion_fisica}
            onChange={(v) => onNota({ ...nota, objetivo: v, exploracion_fisica: v })}
            locked={locked}
          />
          <Area label="Estudios" value={nota.estudios} onChange={(v) => setField('estudios', v)} locked={locked} compact />
        </SoapCard>

        <SoapCard id="soap-a" letter="A" title="Análisis" hint="Diagnóstico CIE-10, presuntivo y pronóstico (NOM-004 6.1.4 / 6.1.5)">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <Area
                id="analisis"
                name="analisis"
                label="Análisis / diagnóstico"
                value={nota.analisis || nota.diagnostico}
                onChange={(v) => onNota({ ...nota, analisis: v, diagnostico: v })}
                locked={locked}
                compact
              />
            </div>
            <label className="block">
              <span className="section-header">CIE-10</span>
              <input
                className="input-field py-2 text-sm font-mono"
                value={nota.diagnostico_cie10 ?? ''}
                disabled={locked}
                placeholder="M54.5"
                onChange={(e) => setField('diagnostico_cie10', e.target.value.toUpperCase())}
              />
            </label>
          </div>
          <Area label="Diagnóstico presuntivo / diferenciales" value={nota.diagnosticos_diferenciales || nota.diagnostico_presuntivo} onChange={(v) => onNota({ ...nota, diagnosticos_diferenciales: v, diagnostico_presuntivo: v })} locked={locked} compact />
          <Area label="Pronóstico" value={nota.pronostico} onChange={(v) => setField('pronostico', v)} locked={locked} compact />
        </SoapCard>

        <SoapCard id="soap-p" letter="P" title="Plan" hint="Tratamiento estructurado, seguimiento y evolución">
          <Area id="plan" name="plan" label="Plan terapéutico" value={nota.plan} onChange={(v) => setField('plan', v)} locked={locked} />
          <Section title="Receta estructurada">
            {(nota.tratamiento ?? []).map((row, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-8 gap-2 mb-2">
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Medicamento" value={row.medicamento} disabled={locked} onChange={(e) => setTratamiento(index, 'medicamento', e.target.value)} />
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Dosis" value={row.dosis} disabled={locked} onChange={(e) => setTratamiento(index, 'dosis', e.target.value)} />
                <input className="input-field sm:col-span-2 py-2 text-sm" placeholder="Vía" value={row.via} disabled={locked} onChange={(e) => setTratamiento(index, 'via', e.target.value)} />
                <input className="input-field sm:col-span-1 py-2 text-sm" placeholder="Periodicidad" value={row.periodicidad} disabled={locked} onChange={(e) => setTratamiento(index, 'periodicidad', e.target.value)} />
                {!locked && (
                  <button type="button" className="btn-icon" onClick={() => onNota({ ...nota, tratamiento: nota.tratamiento.filter((_, i) => i !== index) })}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {!locked && (
              <button type="button" className="btn-secondary py-1.5 px-3 text-xs" onClick={() => onNota({ ...nota, tratamiento: [...(nota.tratamiento ?? []), { medicamento: '', dosis: '', via: '', periodicidad: '' }] })}>
                <Plus className="w-3.5 h-3.5" /> Agregar medicamento
              </button>
            )}
          </Section>
          <Area label="Seguimiento" value={nota.seguimiento} onChange={(v) => setField('seguimiento', v)} locked={locked} compact />
          <Area label="Notas de evolución" value={nota.notas_evolucion} onChange={(v) => setField('notas_evolucion', v)} locked={locked} compact />
        </SoapCard>
      </div>

      <details className="card p-4 no-print">
        <summary className="text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer">
          Campos NOM-004 adicionales (antecedentes, alergias, resumen)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Area label="Antecedentes personales" value={nota.antecedentes_personales} onChange={(v) => setField('antecedentes_personales', v)} locked={locked} compact />
          <Area label="Alergias" value={nota.alergias} onChange={(v) => setField('alergias', v)} locked={locked} compact />
          <Area label="Medicamentos previos" value={nota.medicamentos} onChange={(v) => setField('medicamentos', v)} locked={locked} compact />
          <Area label="Resumen clínico" value={nota.resumen} onChange={(v) => setField('resumen', v)} locked={locked} compact />
        </div>
      </details>

      <div id="soap-receta" className="space-y-3 receta-print card p-4">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Receta para el paciente ({receta.idioma_nombre || receta.idioma || 'idioma nativo'})
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
              onCopied();
            }}
          >
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
        </div>
        <Area label="Título" value={receta.titulo} onChange={(v) => onReceta({ ...receta, titulo: v })} locked={locked} compact />
        <Area label="Resumen para el paciente" value={receta.resumen} onChange={(v) => onReceta({ ...receta, resumen: v })} locked={locked} compact />
        <Area label="Indicaciones" value={receta.indicaciones} onChange={(v) => onReceta({ ...receta, indicaciones: v })} locked={locked} compact />
        <Section title="Medicamentos">
          {(receta.medicamentos ?? []).map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 mb-2">
              <div className="flex gap-2">
                <input className="input-field py-2 text-sm" placeholder="Medicamento" value={row.medicamento} disabled={locked} onChange={(e) => patchRecetaMed(index, 'medicamento', e.target.value)} />
                {!locked && (
                  <button type="button" className="btn-icon no-print" onClick={() => onReceta({ ...receta, medicamentos: receta.medicamentos.filter((_, i) => i !== index) })}>
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
            <button type="button" className="btn-secondary py-1.5 px-3 text-xs no-print" onClick={() => onReceta({
              ...receta,
              medicamentos: [...(receta.medicamentos ?? []), { medicamento: '', dosis: '', via: '', periodicidad: '', instruccion: '' }],
            })}>
              <Plus className="w-3.5 h-3.5" /> Agregar medicamento
            </button>
          )}
        </Section>
        <Area label="Alarmas / cuándo regresar" value={receta.alarmas} onChange={(v) => onReceta({ ...receta, alarmas: v })} locked={locked} compact />
        <Area label="Seguimiento" value={receta.seguimiento} onChange={(v) => onReceta({ ...receta, seguimiento: v })} locked={locked} compact />
        <p className="text-xs font-semibold text-slate-800 border-t border-slate-100 pt-3">{sello}</p>
      </div>
    </div>
  );
}

function SoapCard({ id, letter, title, hint, children }: { id: string; letter: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} className="card p-4 space-y-3 scroll-mt-28">
      <header className="flex items-start gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white text-sm font-bold">{letter}</span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-[11px] text-slate-500">{hint}</p>
        </div>
      </header>
      {children}
    </section>
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

function Vital({ label, value, onChange, locked }: { label: string; value: string; onChange: (v: string) => void; locked: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input className="input-field py-1.5 text-sm" value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
    </label>
  );
}

function Area({ id, name, label, value, onChange, locked, compact }: { id?: string; name?: string; label: string; value: string; onChange: (v: string) => void; locked: boolean; compact?: boolean }) {
  const texto = typeof value === 'string' ? value : '';
  const missing = !texto || texto === '[NO MENCIONADO]';
  return (
    <div className={clsx(missing ? 'note-section-missing' : 'note-section')}>
      <label className="section-header" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        data-soap-key={name}
        className={clsx(
          'w-full p-3 rounded-lg border border-slate-200 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y disabled:bg-slate-50',
          compact ? 'min-h-[72px]' : 'min-h-[96px]',
        )}
        value={texto}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
