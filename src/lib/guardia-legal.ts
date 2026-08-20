import { AppError } from "./errors";
import type { IndicacionTerapeutica, NotaClinica } from "./nota-types";

export const NORMA_EXPEDIENTE = "NOM-004-SSA3-2012";
export const ESTADO_BORRADOR = "borrador";
export const ESTADO_LOCKED = "locked";
/** Compatibilidad con notas cerradas antes del módulo de compliance. */
export const ESTADO_FINALIZADA = "finalizada";

export function consultaInmutable(estado: string | null | undefined): boolean {
  return estado === ESTADO_LOCKED || estado === ESTADO_FINALIZADA;
}

const VACIO = /^(?:\s*|\[NO MENCIONADO\]|\[NOT DISCUSSED\]|n\/a|na|s\/?d)$/i;

export type FaltanteNom004 = {
  campo: string;
  mensaje: string;
  numeral: string;
};

export type DictamenNom004 = {
  cumple: boolean;
  norma: typeof NORMA_EXPEDIENTE;
  faltantes: FaltanteNom004[];
  guia: string[];
};

export class Nom004Error extends AppError {
  readonly faltantes: FaltanteNom004[];
  readonly guia: string[];
  readonly nota?: NotaClinica;

  constructor(faltantes: FaltanteNom004[], nota?: NotaClinica) {
    super(
      422,
      `Complete los datos faltantes antes de persistir el expediente (NOM-004-SSA3 / privacidad por diseño): ${faltantes.map((item) => item.mensaje).join(" ")}`,
      "NOM004_INCOMPLETA"
    );
    this.name = "Nom004Error";
    this.faltantes = faltantes;
    this.guia = faltantes.map((item) => item.mensaje);
    this.nota = nota;
  }
}

export function isNom004Error(error: unknown): error is Nom004Error {
  return error instanceof Nom004Error;
}

export function estaVacio(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value !== "string") return true;
  return VACIO.test(value.trim());
}

function faltante(campo: string, mensaje: string, numeral: string): FaltanteNom004 {
  return { campo, mensaje, numeral };
}

function textoPlan(nota: NotaClinica): string {
  const indicaciones = (nota.tratamiento ?? [])
    .map((item) => [item.medicamento, item.dosis, item.via, item.periodicidad].join(" "))
    .join(" ");
  return `${nota.plan ?? ""} ${indicaciones} ${nota.medicamentos ?? ""}`;
}

function extraerTratamiento(nota: NotaClinica): IndicacionTerapeutica[] {
  if (Array.isArray(nota.tratamiento) && nota.tratamiento.length > 0) {
    return nota.tratamiento;
  }
  return [];
}

function planMencionaMedicamento(texto: string): boolean {
  return /\b(?:mg|mcg|ml|ui|tablet|c[aá]psul|ampolle|jarabe|indic[oa]|prescrib|tomar|aplicar|administr)\b/i.test(
    texto
  );
}

function planTieneDosis(texto: string): boolean {
  return /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui|unidades?|tablet(?:as?)?|c[aá]psul(?:as?)?)\b/i.test(texto);
}

function planTieneVia(texto: string): boolean {
  return /\b(?:v[ií]a\s+)?(?:oral|vo|ev|i\.?v\.?|i\.?m\.?|s\.?c\.?|subcut[aá]nea|intravenosa|intramuscular|t[oó]pica|sublingual|inhalad|rectal|oft[aá]lmica|nasal)\b/i.test(
    texto
  );
}

function planTienePeriodicidad(texto: string): boolean {
  return /\b(?:cada\s+\d+|c\/\s*\d+|c\/24|c\/12|c\/8|c\/6|al d[ií]a|diario|diaria|bid|tid|qid|una vez al d[ií]a|dos veces|tres veces|por la noche|matutino|vespertino|hrs?|horas)\b/i.test(
    texto
  );
}

export function validarNotaNom004(nota: NotaClinica): DictamenNom004 {
  const faltantes: FaltanteNom004[] = [];

  if (estaVacio(nota.nombre_paciente)) {
    faltantes.push(faltante("nombre_paciente", "Falta el nombre completo del paciente", "5.2.3 / 5.9"));
  }
  if (estaVacio(nota.edad)) {
    faltantes.push(faltante("edad", "Falta la edad del paciente", "5.2.3 / 5.9"));
  }
  if (estaVacio(nota.sexo)) {
    faltantes.push(faltante("sexo", "Falta el sexo del paciente", "5.2.3 / 5.9"));
  }
  if (estaVacio(nota.domicilio)) {
    faltantes.push(faltante("domicilio", "Falta el domicilio del paciente", "5.2.3"));
  }
  if (estaVacio(nota.fecha)) {
    faltantes.push(faltante("fecha", "Falta la fecha de elaboración de la nota", "5.10"));
  }
  if (estaVacio(nota.hora)) {
    faltantes.push(faltante("hora", "Falta la hora de elaboración de la nota", "5.10"));
  }
  if (estaVacio(nota.motivo_consulta)) {
    faltantes.push(faltante("motivo_consulta", "Falta el motivo de consulta", "6.1.1 / 7.1.3"));
  }
  if (estaVacio(nota.exploracion_fisica)) {
    faltantes.push(faltante("exploracion_fisica", "Falta la exploración física", "6.1.2 / 6.2.2"));
  }
  if (estaVacio(nota.diagnostico) && estaVacio(nota.diagnostico_presuntivo)) {
    faltantes.push(faltante("diagnostico", "Falta el diagnóstico o problema clínico", "6.1.4 / 6.2.4"));
  }
  if (estaVacio(nota.pronostico)) {
    faltantes.push(faltante("pronostico", "Falta el pronóstico", "6.1.5 / 6.2.5"));
  }

  if (estaVacio(nota.medico_nombre)) {
    faltantes.push(faltante("medico_nombre", "Falta el nombre completo del médico tratante", "5.10 / Apéndice D3.11"));
  }
  if (estaVacio(nota.medico_cedula)) {
    faltantes.push(faltante("medico_cedula", "Falta la cédula profesional", "Apéndice D2.11 / D3.11"));
  } else if (!/\d{5,}/.test(String(nota.medico_cedula))) {
    faltantes.push(
      faltante("medico_cedula", "La cédula profesional debe contener al menos 5 dígitos", "Apéndice D3.11")
    );
  }
  if (estaVacio(nota.sello_responsable) || !/Responsable:/i.test(nota.sello_responsable) || !/Cédula:/i.test(nota.sello_responsable)) {
    faltantes.push(
      faltante("sello_responsable", "Falta el sello de identificación legal del médico responsable (nombre, cédula y especialidad)", "5.10 / Apéndice D3.11")
    );
  }

  const tratamiento = extraerTratamiento(nota);
  if (tratamiento.length > 0) {
    tratamiento.forEach((item, index) => {
      const n = index + 1;
      if (estaVacio(item.medicamento)) {
        faltantes.push(faltante(`tratamiento.${index}.medicamento`, `Falta el nombre del medicamento #${n}`, "6.2.6"));
      }
      if (estaVacio(item.dosis)) {
        faltantes.push(faltante(`tratamiento.${index}.dosis`, `Falta la dosis del medicamento #${n}`, "6.2.6"));
      }
      if (estaVacio(item.via)) {
        faltantes.push(
          faltante(`tratamiento.${index}.via`, `Falta la vía de administración del medicamento #${n}`, "6.2.6")
        );
      }
      if (estaVacio(item.periodicidad)) {
        faltantes.push(
          faltante(`tratamiento.${index}.periodicidad`, `Falta la periodicidad del medicamento #${n}`, "6.2.6")
        );
      }
    });
  } else {
    const plan = textoPlan(nota);
    if (estaVacio(nota.plan)) {
      faltantes.push(faltante("plan", "Falta el plan terapéutico", "6.1.6 / 6.2.6"));
    } else {
      const mencionaMed = planMencionaMedicamento(plan);
      if (mencionaMed || true) {
        if (!planTieneDosis(plan)) {
          faltantes.push(faltante("plan.dosis", "Falta la dosis del medicamento", "6.2.6"));
        }
        if (!planTieneVia(plan)) {
          faltantes.push(faltante("plan.via", "Falta la vía de administración del medicamento", "6.2.6"));
        }
        if (!planTienePeriodicidad(plan)) {
          faltantes.push(faltante("plan.periodicidad", "Falta la periodicidad del medicamento", "6.2.6"));
        }
      }
    }
  }

  return {
    cumple: faltantes.length === 0,
    norma: NORMA_EXPEDIENTE,
    faltantes,
    guia: faltantes.map((item) => item.mensaje),
  };
}

export function exigirNotaNom004(nota: NotaClinica): DictamenNom004 {
  const dictamen = validarNotaNom004(nota);
  if (!dictamen.cumple) {
    throw new Nom004Error(dictamen.faltantes, nota);
  }
  return dictamen;
}

export function notaInmutableError(): AppError {
  return new AppError(
    409,
    "La nota está locked y no puede alterarse. Genera una nota de aclaración o rectificación asociada al expediente (NOM-004-SSA3-2012 5.11, sin enmendaduras).",
    "NOTA_INMUTABLE"
  );
}
