import type { NotaClinica } from '../types';

function asTexto(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>;
          return [row.medicamento ?? row.nombre, row.dosis, row.via ?? row['vía'], row.periodicidad ?? row.frecuencia]
            .filter((part) => typeof part === 'string' && part.trim())
            .join(' ');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function diagnosticoConCie10(raw: Record<string, unknown>): string {
  const diagnostico = asTexto(raw.diagnostico) || asTexto(raw.diagnóstico);
  const cie = asTexto(raw.cie10) || asTexto(raw.cie_10) || asTexto(raw.codigo_cie10);
  if (!diagnostico) return '';
  if (!cie || /cie-?10/i.test(diagnostico) || diagnostico.includes(cie)) return diagnostico;
  return `${diagnostico} (CIE-10: ${cie})`;
}

/**
 * Asigna el JSON clínico (SOAP / NOM-004) a los campos del editor.
 * Nunca usa la transcripción cruda como valor de un textarea.
 */
export function mapearNotaDesdeIA(
  incoming: Partial<NotaClinica> | Record<string, unknown> | null | undefined,
  base: NotaClinica,
): NotaClinica {
  if (!incoming || typeof incoming !== 'object') return base;
  const raw = incoming as Record<string, unknown>;
  const mapped: NotaClinica = {
    ...base,
    ...(incoming as Partial<NotaClinica>),
  };

  mapped.motivo_consulta = asTexto(raw.motivo_consulta) || mapped.motivo_consulta;
  mapped.padecimiento_actual = asTexto(raw.padecimiento_actual) || mapped.padecimiento_actual;
  mapped.interrogatorio = asTexto(raw.interrogatorio) || mapped.interrogatorio;
  mapped.exploracion_fisica = asTexto(raw.exploracion_fisica) || mapped.exploracion_fisica;
  mapped.diagnostico = diagnosticoConCie10(raw) || mapped.diagnostico;
  mapped.plan = asTexto(raw.plan_tratamiento) || asTexto(raw.plan) || mapped.plan;
  mapped.medicamentos = asTexto(raw.medicamentos) || mapped.medicamentos;
  mapped.pronostico = asTexto(raw.pronostico) || asTexto(raw.pronóstico) || mapped.pronostico;

  return mapped;
}
