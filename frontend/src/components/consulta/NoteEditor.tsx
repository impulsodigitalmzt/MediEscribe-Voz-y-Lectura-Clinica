import type { ReactNode } from 'react';
import { Copy, Plus, Printer, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { NotaClinica, RecetaPaciente } from '../../types';

type Props = {
  nota: NotaClinica;
  receta: RecetaPaciente;
  locked: boolean;
  sello: string;
  onNota: (next: NotaClinica) => void;
  onReceta: (next: RecetaPaciente) => void;
  onCopied: () => void;
};

export default function NoteEditor({ nota, receta, locked, sello, onNota, onReceta, onCopied }: Props) {
  const setField = (key: keyof NotaClinica, value: string) => {
    onNota({ ...nota, [key]: value });
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Nota médica (español · NOM-004)</p>
        <Area label="Motivo de consulta" value={nota.motivo_consulta} onChange={(v) => setField('motivo_consulta', v)} locked={locked} />
        <Area label="Padecimiento actual" value={nota.padecimiento_actual} onChange={(v) => setField('padecimiento_actual', v)} locked={locked} />
        <Area label="Interrogatorio" value={nota.interrogatorio} onChange={(v) => setField('interrogatorio', v)} locked={locked} />
        <Area label="Exploración física" value={nota.exploracion_fisica} onChange={(v) => setField('exploracion_fisica', v)} locked={locked} />
        <Area label="Diagnóstico" value={nota.diagnostico} onChange={(v) => setField('diagnostico', v)} locked={locked} />
        <Area label="Pronóstico" value={nota.pronostico} onChange={(v) => setField('pronostico', v)} locked={locked} />
        <Area label="Plan terapéutico" value={nota.plan} onChange={(v) => setField('plan', v)} locked={locked} />

        <Section title="Tratamiento estructurado">
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

        <Area label="Notas de evolución" value={nota.notas_evolucion} onChange={(v) => setField('notas_evolucion', v)} locked={locked} />
        <Area label="Antecedentes personales" value={nota.antecedentes_personales} onChange={(v) => setField('antecedentes_personales', v)} locked={locked} />
        <Area label="Alergias" value={nota.alergias} onChange={(v) => setField('alergias', v)} locked={locked} />
        <Area label="Estudios" value={nota.estudios} onChange={(v) => setField('estudios', v)} locked={locked} />
        <Area label="Seguimiento" value={nota.seguimiento} onChange={(v) => setField('seguimiento', v)} locked={locked} />
        <Area label="Resumen" value={nota.resumen} onChange={(v) => setField('resumen', v)} locked={locked} />
        <p className="text-xs font-semibold text-slate-800 border-t border-slate-100 pt-3">{sello}</p>
      </div>

      <div className="space-y-3 receta-print">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Receta ({receta.idioma_nombre || receta.idioma || 'idioma nativo'})
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
        <Area label="Título" value={receta.titulo} onChange={(v) => onReceta({ ...receta, titulo: v })} locked={locked} />
        <Area label="Resumen para el paciente" value={receta.resumen} onChange={(v) => onReceta({ ...receta, resumen: v })} locked={locked} />
        <Area label="Indicaciones" value={receta.indicaciones} onChange={(v) => onReceta({ ...receta, indicaciones: v })} locked={locked} />
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
        <Area label="Alarmas / cuándo regresar" value={receta.alarmas} onChange={(v) => onReceta({ ...receta, alarmas: v })} locked={locked} />
        <Area label="Seguimiento" value={receta.seguimiento} onChange={(v) => onReceta({ ...receta, seguimiento: v })} locked={locked} />
        <p className="text-xs font-semibold text-slate-800 border-t border-slate-100 pt-3">{sello}</p>
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
