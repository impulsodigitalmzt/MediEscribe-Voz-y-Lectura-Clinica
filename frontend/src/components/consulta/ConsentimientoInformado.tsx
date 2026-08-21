import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';

type Props = {
  titularSugerido: string;
  accepted: boolean;
  acceptedAt?: string | null;
  locked?: boolean;
  saving?: boolean;
  onSubmit: (input: { titularNombre: string }) => Promise<void>;
};

export default function ConsentimientoInformado({
  titularSugerido, accepted, acceptedAt, locked, saving, onSubmit,
}: Props) {
  const [titular, setTitular] = useState(titularSugerido);
  const [informado, setInformado] = useState(accepted);
  const [ia, setIa] = useState(accepted);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await onSubmit({ titularNombre: titular.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el consentimiento.');
    }
  };

  if (accepted) {
    return (
      <section className="card p-4 no-print border border-emerald-200 bg-emerald-50/60">
        <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Consentimiento informado registrado
        </p>
          <p className="text-xs text-emerald-800 mt-1">
            Titular: {titularSugerido || 'paciente'}
            {acceptedAt ? ` · ${new Date(acceptedAt).toLocaleString('es-MX')}` : ''}
            {' · '}privacidad por diseño (consentimiento + minimización).
          </p>
      </section>
    );
  }

  return (
    <form className="card p-4 space-y-3 no-print border-2 border-amber-300 bg-amber-50/70" onSubmit={handleSubmit}>
      <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-700" />
        Consentimiento informado (LFPDPPP y NOM-004)
      </h2>
      <p className="text-xs text-slate-600 leading-relaxed">
        Los datos de salud son sensibles (LFPDPPP). Solo se solicita lo necesario para esta consulta.
        El dictado aparece en el borrador de la consulta para control del médico y se cifra en reposo.
        Si se genera nota con IA, el texto se envía a Groq solo para inferencia, sin almacenamiento ni entrenamiento
        de modelos públicos. El responsable del tratamiento es el médico autenticado.
      </p>
      <label className="block text-xs font-medium text-slate-700">
        Nombre del paciente o representante legal
        <input
          className="input-field mt-1 py-2 text-sm"
          value={titular}
          onChange={(e) => setTitular(e.target.value)}
          disabled={locked || saving}
          required
        />
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={informado} onChange={(e) => setInformado(e.target.checked)} disabled={locked || saving} />
        <span>El titular (o su representante) consiente integrar esta consulta al expediente clínico.</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={ia} onChange={(e) => setIa(e.target.checked)} disabled={locked || saving} />
        <span>Autoriza el tratamiento de datos sensibles con IA de apoyo documental, sin uso para entrenamiento de modelos públicos.</span>
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="submit" className="btn-primary py-2 px-4 text-sm" disabled={locked || saving || !informado || !ia || titular.trim().length < 3}>
        Registrar consentimiento y continuar
      </button>
    </form>
  );
}
