import type { Sql } from "../db.js";
import { AppError } from "./errors";
import { parseNombreCompleto } from "./parse-nombre";

export type AntecedentesImportantes = {
  alergias: string;
  cronicos: string;
  heredo_familiares: string;
  personales_patologicos: string;
  personales_no_patologicos: string;
};

export type PacienteRow = {
  id: string;
  numero_expediente: string;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  fecha_nacimiento: string | Date;
  sexo: string;
  domicilio: string;
  curp: string | null;
  ocupacion: string;
  antecedentes_importantes: AntecedentesImportantes | string | null;
  consentimiento_privacidad_aceptado?: boolean;
  consentimiento_privacidad_en?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type PacientePublico = {
  id: string;
  numero_expediente: string;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  nombre_completo: string;
  fecha_nacimiento: string;
  edad: string;
  sexo: string;
  domicilio: string;
  curp: string | null;
  ocupacion: string;
  antecedentes_importantes: AntecedentesImportantes;
  consentimiento_privacidad_aceptado: boolean;
  consentimiento_privacidad_en: string | null;
  created_at: string;
  updated_at: string;
};

export type ConsultaHistorialItem = {
  id: string;
  fecha_hora: string;
  motivo_consulta: string | null;
  exploracion_fisica: string | null;
  diagnostico: string | null;
  tratamiento: unknown;
  notas_evolucion: string | null;
  plan: string | null;
  resumen: string | null;
  estado: string | null;
};

export type PacienteBusqueda = {
  q?: string;
  nombre?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  fecha_nacimiento?: string;
  curp?: string;
};

export type PacienteAlta = {
  nombre: string;
  apellido_paterno: string;
  apellido_materno?: string;
  fecha_nacimiento: string;
  sexo?: string;
  domicilio?: string;
  curp?: string;
  ocupacion?: string;
  antecedentes_importantes?: Partial<AntecedentesImportantes>;
  consentimiento_privacidad_aceptado?: boolean;
};

const CURP_RE = /^[A-Z0-9]{18}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeExpediente(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^EXP-?(\d{4})-?(\d+)$/);
  if (!match) return null;
  return `EXP-${match[1]}-${match[2].padStart(5, "0")}`;
}

export function vacioAntecedentes(): AntecedentesImportantes {
  return {
    alergias: "",
    cronicos: "",
    heredo_familiares: "",
    personales_patologicos: "",
    personales_no_patologicos: "",
  };
}

export function parseAntecedentes(value: PacienteRow["antecedentes_importantes"]): AntecedentesImportantes {
  const base = vacioAntecedentes();
  if (!value) return base;
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Record<string, unknown>;
  return {
    alergias: asText(row.alergias),
    cronicos: asText(row.cronicos ?? row.crónicos),
    heredo_familiares: asText(row.heredo_familiares),
    personales_patologicos: asText(row.personales_patologicos),
    personales_no_patologicos: asText(row.personales_no_patologicos),
  };
}

export function nombreCompleto(p: {
  nombre: string;
  apellido_paterno: string;
  apellido_materno?: string | null;
}): string {
  return [p.nombre, p.apellido_paterno, p.apellido_materno]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function edadDesdeNacimiento(fecha: string): string {
  if (!DATE_RE.test(fecha)) return "";
  const [year, month, day] = fecha.split("-").map(Number);
  const hoy = new Date();
  let years = hoy.getUTCFullYear() - year;
  const m = hoy.getUTCMonth() - (month - 1);
  if (m < 0 || (m === 0 && hoy.getUTCDate() < day)) years -= 1;
  if (years < 0 || years > 130) return "";
  return `${years} años`;
}

export function publicPaciente(row: PacienteRow): PacientePublico {
  const fecha = asDateOnly(row.fecha_nacimiento);
  return {
    id: String(row.id),
    numero_expediente: row.numero_expediente,
    nombre: row.nombre,
    apellido_paterno: row.apellido_paterno,
    apellido_materno: row.apellido_materno ?? "",
    nombre_completo: nombreCompleto(row),
    fecha_nacimiento: fecha,
    edad: edadDesdeNacimiento(fecha),
    sexo: row.sexo ?? "",
    domicilio: row.domicilio ?? "",
    curp: row.curp ? normalizeCurp(row.curp) : null,
    ocupacion: row.ocupacion ?? "",
    antecedentes_importantes: parseAntecedentes(row.antecedentes_importantes),
    consentimiento_privacidad_aceptado: Boolean(row.consentimiento_privacidad_aceptado),
    consentimiento_privacidad_en: row.consentimiento_privacidad_en
      ? asIso(row.consentimiento_privacidad_en)
      : null,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export function normalizeCurp(value?: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizePersonName(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Búsqueda previa a la consulta (NOM-004 5.14 / 6.1.1).
 * Prioridad: CURP → identidad (nombre + apellidos + fecha) → nombre + fecha → nombre.
 * Nunca auto-selecciona homónimos: el médico debe desambiguar.
 */
export async function buscarPacientes(
  sql: Sql,
  query: PacienteBusqueda
): Promise<{ pacientes: PacientePublico[]; requiere_desambiguacion: boolean; alta_requerida: boolean }> {
  const q = (query.q ?? "").trim();
  const qCurp = normalizeCurp(q);
  let curp = normalizeCurp(query.curp);
  let nombre = (query.nombre ?? "").trim();
  let apellidoPaterno = (query.apellido_paterno ?? "").trim();
  let apellidoMaterno = (query.apellido_materno ?? "").trim();
  const fecha = (query.fecha_nacimiento ?? "").trim();
  const expediente = normalizeExpediente(q);

  if (isUuid(q)) {
    const byId = await sql<PacienteRow[]>`
      SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
             fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
             consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
             created_at, updated_at
      FROM pacientes
      WHERE id = ${q}::uuid
      LIMIT 1
    `;
    return {
      pacientes: byId.map(publicPaciente),
      requiere_desambiguacion: false,
      alta_requerida: byId.length === 0,
    };
  }

  if (expediente) {
    const byExp = await sql<PacienteRow[]>`
      SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
             fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
             consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
             created_at, updated_at
      FROM pacientes
      WHERE upper(numero_expediente) = ${expediente}
      LIMIT 5
    `;
    return {
      pacientes: byExp.map(publicPaciente),
      requiere_desambiguacion: byExp.length > 1,
      alta_requerida: byExp.length === 0,
    };
  }

  if (!curp && qCurp.length === 18) {
    curp = qCurp;
  } else if (q && !nombre) {
    if (!apellidoPaterno) {
      const parsed = parseNombreCompleto(q);
      nombre = parsed.nombre;
      apellidoPaterno = parsed.apellido_paterno;
      if (!apellidoMaterno) apellidoMaterno = parsed.apellido_materno;
    } else {
      nombre = q;
    }
  }

  if (!curp && !nombre && !apellidoPaterno && !fecha) {
    throw new AppError(
      400,
      "Indica CURP, número de expediente, o nombre y apellidos.",
      "BUSQUEDA_VACIA"
    );
  }
  if (curp && !CURP_RE.test(curp)) {
    throw new AppError(400, "El CURP debe tener 18 caracteres alfanuméricos.", "CURP_INVALIDO");
  }
  if (fecha && !DATE_RE.test(fecha)) {
    throw new AppError(400, "La fecha de nacimiento debe ser AAAA-MM-DD.", "FECHA_INVALIDA");
  }

  if (curp) {
    const byCurp = await sql<PacienteRow[]>`
      SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
             fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
             consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
             created_at, updated_at
      FROM pacientes
      WHERE upper(btrim(curp)) = ${curp}
      LIMIT 5
    `;
    if (byCurp.length > 0) {
      return {
        pacientes: byCurp.map(publicPaciente),
        requiere_desambiguacion: byCurp.length > 1,
        alta_requerida: false,
      };
    }
    if (!nombre && !apellidoPaterno && !fecha) {
      return { pacientes: [], requiere_desambiguacion: false, alta_requerida: true };
    }
  }

  const nombreLike = likeContains(nombre);
  const apLike = likeContains(apellidoPaterno);
  const amLike = likeContains(apellidoMaterno);
  const rows = fecha
    ? await sql<PacienteRow[]>`
        SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
               fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
               consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
               created_at, updated_at
        FROM pacientes
        WHERE fecha_nacimiento = ${fecha}::date
          AND (${nombreLike}::text IS NULL OR nombre ILIKE ${nombreLike})
          AND (${apLike}::text IS NULL OR apellido_paterno ILIKE ${apLike})
          AND (${amLike}::text IS NULL OR apellido_materno ILIKE ${amLike})
        ORDER BY apellido_paterno, nombre
        LIMIT 25
      `
    : await sql<PacienteRow[]>`
        SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
               fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
               consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
               created_at, updated_at
        FROM pacientes
        WHERE (${nombreLike}::text IS NULL OR nombre ILIKE ${nombreLike})
          AND (${apLike}::text IS NULL OR apellido_paterno ILIKE ${apLike})
          AND (${amLike}::text IS NULL OR apellido_materno ILIKE ${amLike})
        ORDER BY apellido_paterno, nombre, fecha_nacimiento
        LIMIT 25
      `;

  const filtered = filterPacientes(rows, {
    nombreNorm: normalizePersonName(nombre),
    apNorm: normalizePersonName(apellidoPaterno),
    amNorm: normalizePersonName(apellidoMaterno),
    fecha,
  });

  return {
    pacientes: filtered.map(publicPaciente),
    requiere_desambiguacion: filtered.length > 1,
    alta_requerida: filtered.length === 0,
  };
}

export async function crearPaciente(sql: Sql, input: PacienteAlta): Promise<PacientePublico> {
  let nombre = input.nombre.trim();
  let apellidoPaterno = input.apellido_paterno.trim();
  let apellidoMaterno = (input.apellido_materno ?? "").trim();
  if (!apellidoPaterno && /\s/.test(nombre)) {
    const parsed = parseNombreCompleto(nombre);
    nombre = parsed.nombre;
    apellidoPaterno = parsed.apellido_paterno;
    apellidoMaterno = parsed.apellido_materno || apellidoMaterno;
  }
  const fecha = input.fecha_nacimiento.trim();
  const sexo = (input.sexo ?? "").trim();
  const domicilio = (input.domicilio ?? "").trim();
  const ocupacion = (input.ocupacion ?? "").trim();
  const curp = normalizeCurp(input.curp) || null;

  if (!nombre || !apellidoPaterno) {
    throw new AppError(400, "Nombre y apellido paterno son obligatorios.", "PACIENTE_NOMBRE_REQUERIDO");
  }
  if (!DATE_RE.test(fecha)) {
    throw new AppError(400, "La fecha de nacimiento es obligatoria (AAAA-MM-DD).", "FECHA_INVALIDA");
  }
  if (!sexo) {
    throw new AppError(400, "El sexo es obligatorio (NOM-004 5.2.3 / 5.9).", "SEXO_REQUERIDO");
  }
  if (!domicilio) {
    throw new AppError(400, "El domicilio es obligatorio (NOM-004 5.2.3).", "DOMICILIO_REQUERIDO");
  }
  if (curp && !CURP_RE.test(curp)) {
    throw new AppError(400, "El CURP debe tener 18 caracteres alfanuméricos.", "CURP_INVALIDO");
  }
  if (input.consentimiento_privacidad_aceptado !== true) {
    throw new AppError(
      400,
      "El consentimiento de privacidad es obligatorio para el primer registro del expediente.",
      "CONSENTIMIENTO_REQUERIDO"
    );
  }

  if (curp) {
    const existing = await sql<PacienteRow[]>`
      SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
             fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
             consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
             created_at, updated_at
      FROM pacientes
      WHERE upper(btrim(curp)) = ${curp}
      LIMIT 1
    `;
    if (existing[0]) {
      throw new AppError(
        409,
        `Ya existe un expediente con ese CURP (${existing[0].numero_expediente}).`,
        "CURP_DUPLICADO"
      );
    }
  }

  const homonimos = await sql<PacienteRow[]>`
    SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
           fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
           consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
           created_at, updated_at
    FROM pacientes
    WHERE lower(nombre) = ${nombre.toLowerCase()}
      AND lower(apellido_paterno) = ${apellidoPaterno.toLowerCase()}
      AND lower(coalesce(apellido_materno, '')) = ${apellidoMaterno.toLowerCase()}
      AND fecha_nacimiento = ${fecha}::date
    LIMIT 5
  `;
  if (homonimos[0]) {
    throw new AppError(
      409,
      `Ya existe un expediente para ${nombreCompleto(homonimos[0])} (${homonimos[0].numero_expediente}). Usa ese expediente.`,
      "PACIENTE_DUPLICADO"
    );
  }

  const numero = await siguienteNumeroExpediente(sql);
  const antecedentes = {
    ...vacioAntecedentes(),
    ...(input.antecedentes_importantes ?? {}),
  };

  const inserted = await sql<PacienteRow[]>`
    INSERT INTO pacientes (
      numero_expediente, nombre, apellido_paterno, apellido_materno,
      fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
      consentimiento_privacidad_aceptado, consentimiento_privacidad_en
    ) VALUES (
      ${numero},
      ${nombre},
      ${apellidoPaterno},
      ${apellidoMaterno},
      ${fecha}::date,
      ${sexo},
      ${domicilio},
      ${curp},
      ${ocupacion},
      ${sql.json(antecedentes)},
      true,
      NOW()
    )
    RETURNING id, numero_expediente, nombre, apellido_paterno, apellido_materno,
              fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
              consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
              created_at, updated_at
  `;
  const row = inserted[0];
  if (!row) throw new AppError(500, "No se pudo crear el expediente del paciente.", "PACIENTE_INSERT_FAILED");
  return publicPaciente(row);
}

export async function getPacienteById(sql: Sql, id: string): Promise<PacienteRow | null> {
  if (!isUuid(id)) return null;
  const rows = await sql<PacienteRow[]>`
    SELECT id, numero_expediente, nombre, apellido_paterno, apellido_materno,
           fecha_nacimiento, sexo, domicilio, curp, ocupacion, antecedentes_importantes,
           consentimiento_privacidad_aceptado, consentimiento_privacidad_en,
           created_at, updated_at
    FROM pacientes
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function exigirPaciente(sql: Sql, id: string): Promise<PacientePublico> {
  const row = await getPacienteById(sql, id);
  if (!row) throw new AppError(404, "Paciente no encontrado en el expediente maestro.", "PACIENTE_NOT_FOUND");
  return publicPaciente(row);
}

export async function listHistorialPaciente(
  sql: Sql,
  pacienteId: string,
  limit = 12
): Promise<ConsultaHistorialItem[]> {
  const rows = await sql<
    {
      id: string;
      fecha_hora: string | Date;
      motivo_consulta: string | null;
      exploracion_fisica: string | null;
      diagnostico: string | null;
      tratamiento: unknown;
      notas_evolucion: string | null;
      plan: string | null;
      resumen: string | null;
      estado: string | null;
    }[]
  >`
    SELECT
      id, fecha_hora, motivo_consulta, exploracion_fisica, diagnostico,
      tratamiento, notas_evolucion, plan, resumen, estado
    FROM consultas
    WHERE paciente_id = ${pacienteId}::uuid
    ORDER BY fecha_hora DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    fecha_hora: asIso(row.fecha_hora),
    motivo_consulta: row.motivo_consulta,
    exploracion_fisica: row.exploracion_fisica,
    diagnostico: row.diagnostico,
    tratamiento: row.tratamiento,
    notas_evolucion: row.notas_evolucion,
    plan: row.plan,
    resumen: row.resumen,
    estado: row.estado,
  }));
}

export function contextoHistorialParaLlm(
  paciente: PacientePublico,
  historial: ConsultaHistorialItem[]
): string {
  const ant = paciente.antecedentes_importantes;
  const antecedentes = [
    ant.alergias ? `Alergias: ${ant.alergias}` : "",
    ant.cronicos ? `Crónicos: ${ant.cronicos}` : "",
    ant.heredo_familiares ? `Heredo-familiares: ${ant.heredo_familiares}` : "",
    ant.personales_patologicos ? `Patológicos: ${ant.personales_patologicos}` : "",
    ant.personales_no_patologicos ? `No patológicos: ${ant.personales_no_patologicos}` : "",
  ].filter(Boolean);

  const previas = historial.slice(0, 8).map((item, index) => {
    const fecha = item.fecha_hora.slice(0, 16).replace("T", " ");
    return `${index + 1}. ${fecha} — Motivo: ${item.motivo_consulta || "s/d"}. Dx: ${item.diagnostico || "s/d"}. Plan: ${item.plan || item.resumen || "s/d"}.`;
  });

  return `EXPEDIENTE MAESTRO (NOM-004, datos de identificación ya verificados; úsalos en la ficha, no los inventes):
Nombre completo: ${paciente.nombre_completo}
Número de expediente: ${paciente.numero_expediente}
Fecha de nacimiento: ${paciente.fecha_nacimiento} (${paciente.edad || "edad no calculable"})
Sexo: ${paciente.sexo || "[NO MENCIONADO]"}
Domicilio: ${paciente.domicilio || "[NO MENCIONADO]"}
CURP: ${paciente.curp || "[NO MENCIONADO]"}
Ocupación: ${paciente.ocupacion || "[NO MENCIONADO]"}
Antecedentes importantes: ${antecedentes.join(" | ") || "sin registro previo"}

HISTORIAL DE CONSULTAS PREVIAS (continuidad clínica; no copies diagnósticos viejos como si fueran de hoy):
${previas.length ? previas.join("\n") : "Sin consultas previas en este establecimiento."}`;
}

async function siguienteNumeroExpediente(sql: Sql): Promise<string> {
  const year = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mazatlan",
    year: "numeric",
  }).format(new Date());
  const prefix = `EXP-${year}-`;
  const rows = await sql<{ numero_expediente: string }[]>`
    SELECT numero_expediente
    FROM pacientes
    WHERE numero_expediente LIKE ${prefix + "%"}
    ORDER BY numero_expediente DESC
    LIMIT 1
  `;
  const last = rows[0]?.numero_expediente ?? "";
  const seq = Number.parseInt(last.slice(prefix.length), 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

function likeContains(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `%${trimmed}%`;
}

function filterPacientes(
  rows: PacienteRow[],
  q: { nombreNorm: string; apNorm: string; amNorm: string; fecha: string }
): PacienteRow[] {
  return rows.filter((row) => {
    const n = normalizePersonName(row.nombre);
    const ap = normalizePersonName(row.apellido_paterno);
    const am = normalizePersonName(row.apellido_materno);
    if (q.nombreNorm && !n.includes(q.nombreNorm)) return false;
    if (q.apNorm && !ap.includes(q.apNorm)) return false;
    if (q.amNorm && !am.includes(q.amNorm)) return false;
    if (q.fecha && asDateOnly(row.fecha_nacimiento) !== q.fecha) return false;
    return true;
  });
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asIso(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  if (DATE_RE.test(text.slice(0, 10))) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
