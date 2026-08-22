import { ShieldCheck } from 'lucide-react';

type Props = {
  cumple: boolean;
  consentimientoListo?: boolean;
};

/** Aviso visible cuando la nota cubre el checklist legal de esta consulta. */
export default function AvisoConformidadLegal({ cumple, consentimientoListo = false }: Props) {
  if (!cumple) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs"
    >
      <p className="font-semibold flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
        Documento conforme a la normativa vigente
      </p>
      <p>
        Esta nota cumple los requisitos de la <strong>NOM-004-SSA3-2012</strong> (expediente clínico)
        verificados en esta consulta
        {consentimientoListo
          ? ' y el marco vigente de la LFPDPPP (consentimiento informado, minimización y protección de datos sensibles de salud)'
          : ''}
        . El contenido clínico sigue a su criterio profesional; cuando cierre la consulta, el registro queda inmutable (NOM-004 5.11).
      </p>
    </div>
  );
}
