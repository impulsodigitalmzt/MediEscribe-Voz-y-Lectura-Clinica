import { composeNombreCompleto, parseNombreCompleto } from '../../lib/parseNombreCompleto';

type Parts = {
  nombre_completo: string;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
};

type Props = {
  value: Parts;
  onChange: (next: Parts) => void;
};

export default function NombreCompletoFields({ value, onChange }: Props) {
  const applyFull = (nombre_completo: string) => {
    const parsed = parseNombreCompleto(nombre_completo);
    onChange({
      nombre_completo,
      nombre: parsed.nombre,
      apellido_paterno: parsed.apellido_paterno,
      apellido_materno: parsed.apellido_materno,
    });
  };

  const applyPart = (key: 'nombre' | 'apellido_paterno' | 'apellido_materno', partValue: string) => {
    const next = {
      nombre: value.nombre,
      apellido_paterno: value.apellido_paterno,
      apellido_materno: value.apellido_materno,
      [key]: partValue,
    };
    onChange({
      ...next,
      nombre_completo: composeNombreCompleto(next),
    });
  };

  return (
    <div className="sm:col-span-2 space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="nombre_completo">
          Nombre completo *
        </label>
        <input
          id="nombre_completo"
          required
          value={value.nombre_completo}
          onChange={(e) => applyFull(e.target.value)}
          className="input-field"
          placeholder="Ej. Mario Alberto Delgado Sánchez"
          autoComplete="name"
        />
        <p className="text-xs text-slate-500 mt-1.5">
          El sistema separa nombres compuestos y los dos apellidos. Puede corregir abajo si hace falta.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniField
          label="Nombre(s)"
          required
          value={value.nombre}
          onChange={(v) => applyPart('nombre', v)}
        />
        <MiniField
          label="Apellido paterno"
          required
          value={value.apellido_paterno}
          onChange={(v) => applyPart('apellido_paterno', v)}
        />
        <MiniField
          label="Apellido materno"
          value={value.apellido_materno}
          onChange={(v) => applyPart('apellido_materno', v)}
        />
      </div>
    </div>
  );
}

function MiniField({
  label, value, onChange, required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field text-sm"
      />
    </div>
  );
}
