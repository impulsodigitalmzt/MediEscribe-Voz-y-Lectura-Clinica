import { useEffect, useState, type FormEvent } from 'react';
import { FilePlus2, Loader2, ShieldCheck, X } from 'lucide-react';
import api from '../../services/api';
import type { PacienteExpediente } from '../../types';

type Props = {
  open: boolean;
  seed?: Partial<{
    nombre: string;
    apellido_paterno: string;
    curp: string;
  }>;
  onClose: () => void;
  onCreated: (paciente: PacienteExpediente) => void;
};

const EMPTY = {
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

export default function PatientCreateModal({ open, seed, onClose, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      ...EMPTY,
      nombre: seed?.nombre ?? '',
      apellido_paterno: seed?.apellido_paterno ?? '',
      curp: seed?.curp ?? '',
    });
  }, [open, seed?.nombre, seed?.apellido_paterno, seed?.curp]);

  if (!open) return null;

  const canSave = form.consentimiento && form.nombre.trim() && form.apellido_paterno.trim()
    && form.fecha_nacimiento && form.sexo && form.domicilio.trim();

  const update = (key: keyof typeof EMPTY, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const paciente = await api.crearPaciente({
        nombre: form.nombre,
        apellido_paterno: form.apellido_paterno,
        apellido_materno: form.apellido_materno,
        fecha_nacimiento: form.fecha_nacimiento,
        sexo: form.sexo,
        domicilio: form.domicilio,
        curp: form.curp,
        ocupacion: form.ocupacion,
        antecedentes_importantes: { alergias: form.alergias, cronicos: form.cronicos },
        consentimiento_privacidad_aceptado: true,
      });
      onCreated(paciente);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el expediente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/45 p-4 overflow-y-auto">
      <div className="card w-full max-w-2xl my-6 p-0 overflow-hidden" role="dialog" aria-labelledby="alta-title">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 id="alta-title" className="text-lg font-semibold text-slate-900">Crear nuevo expediente</h2>
            <p className="text-xs text-slate-500 mt-0.5">Alta de paciente — NOM-004 / LFPDPPP</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre(s)" required value={form.nombre} onChange={(v) => update('nombre', v)} />
            <Field label="Apellido paterno" required value={form.apellido_paterno} onChange={(v) => update('apellido_paterno', v)} />
            <Field label="Apellido materno" value={form.apellido_materno} onChange={(v) => update('apellido_materno', v)} />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fecha de nacimiento *</label>
              <input
                required
                type="date"
                value={form.fecha_nacimiento}
                onChange={(e) => update('fecha_nacimiento', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sexo *</label>
              <select
                required
                value={form.sexo}
                onChange={(e) => update('sexo', e.target.value)}
                className="input-field"
              >
                <option value="">Seleccionar</option>
                <option value="Femenino">Femenino</option>
                <option value="Masculino">Masculino</option>
                <option value="Otro">Otro</option>
              </select>
            </div>
            <Field label="CURP" value={form.curp} onChange={(v) => update('curp', v.toUpperCase())} />
            <Field label="Domicilio" required value={form.domicilio} onChange={(v) => update('domicilio', v)} className="sm:col-span-2" />
            <Field label="Ocupación" value={form.ocupacion} onChange={(v) => update('ocupacion', v)} />
            <Field label="Alergias" value={form.alergias} onChange={(v) => update('alergias', v)} />
            <Field label="Antecedentes crónicos" value={form.cronicos} onChange={(v) => update('cronicos', v)} className="sm:col-span-2" />
          </div>

          <label className="flex items-start gap-3 text-sm text-slate-700 bg-slate-50 rounded-lg border border-slate-200 p-4">
            <input
              type="checkbox"
              className="mt-1 accent-teal-700"
              checked={form.consentimiento}
              onChange={(e) => update('consentimiento', e.target.checked)}
            />
            <span>
              <span className="font-medium text-slate-800">Consentimiento de privacidad (obligatorio).</span>{' '}
              Autorizo el tratamiento de datos personales del expediente clínico conforme a la NOM-004-SSA3-2012
              y la LFPDPPP. Sin este consentimiento no es posible guardar el alta.
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={!canSave || saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
              Guardar expediente
            </button>
          </div>
          {!form.consentimiento && (
            <p className="text-xs text-slate-500 flex items-center gap-1.5 justify-end">
              <ShieldCheck className="w-3.5 h-3.5" />
              Marca el consentimiento para habilitar Guardar.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, required, className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <input required={required} value={value} onChange={(e) => onChange(e.target.value)} className="input-field" />
    </div>
  );
}
