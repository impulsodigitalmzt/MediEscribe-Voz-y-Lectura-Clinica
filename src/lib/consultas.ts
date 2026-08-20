import { closeSql, createSql, type Sql } from "../db.js";
import { AppError } from "./errors";
import { transcribeAudio } from "./groq";
import { ensureExpedienteSchema } from "./expediente-schema";
import { aplicarIdentidadPaciente, aplicarSelloLegal, notaDesdeExpediente, recetaDesdeNota, redactarNotaClinica, type DatosMedico, type NotaClinica, type RecetaPaciente } from "./nota-clinica";
import {
  consultaInmutable,
  ESTADO_BORRADOR,
  ESTADO_LOCKED,
  exigirNotaNom004,
  notaInmutableError,
  validarNotaNom004,
  type DictamenNom004,
} from "./guardia-legal";
import type { AudioUpload } from "./audio";
import {
  contextoHistorialParaLlm,
  exigirPaciente,
  isUuid,
  listHistorialPaciente,
  type ConsultaHistorialItem,
  type PacientePublico,
} from "./pacientes";
import type { NotaAclaracionPublica } from "./aclaraciones";
import { denegarSiAjeno, esRolPrivilegiado, type SesionMedico } from "./acceso-expediente";
import { exigirConsentimientoConsulta } from "./consentimiento";
import { cifrarPhi, descifrarPhi } from "./phi";

export type ConsultaMedicaRow = {
  id: string;
  paciente_id: string;
  fecha_hora: string | Date;
  paciente_nombre?: string;
  resumen: string | null;
  transcripcion: string | null;
  nota_estructurada: NotaClinica | string | null;
  motivo_consulta: string | null;
  exploracion_fisica: string | null;
  padecimiento_actual: string | null;
  diagnostico: string | null;
  tratamiento: unknown;
  notas_evolucion: string | null;
  plan: string | null;
  receta_paciente_nativo: RecetaPaciente | string | null;
  idioma: string | null;
  especialidad: string | null;
  modelo_whisper: string | null;
  modelo_llm: string | null;
  nombre_archivo: string | null;
  estado: string | null;
  medico_nombre: string | null;
  medico_cedula: string | null;
  medico_id?: string | null;
  consentimiento_informado_aceptado?: boolean | null;
  consentimiento_informado_en?: string | Date | null;
  consentimiento_informado_titular?: string | null;
  consentimiento_ia_aceptado?: boolean | null;
  consentimiento_version?: string | null;
  finalizada_en: string | Date | null;
};

export type ConsultaPublica = {
  id: string;
  paciente_id: string;
  fecha: string;
  fecha_hora: string;
  paciente_nombre: string;
  paciente?: PacientePublico;
  resumen: string | null;
  transcripcion: string | null;
  nota_estructurada: NotaClinica | null;
  motivo_consulta: string | null;
  exploracion_fisica: string | null;
  padecimiento_actual: string | null;
  diagnostico: string | null;
  tratamiento: unknown;
  notas_evolucion: string | null;
  plan: string | null;
  receta_paciente_nativo: RecetaPaciente | null;
  idioma: string | null;
  especialidad: string | null;
  modelo_whisper: string | null;
  modelo_llm: string | null;
  nombre_archivo: string | null;
  estado: string | null;
  medico_nombre: string | null;
  medico_cedula: string | null;
  medico_id?: string | null;
  consentimiento_informado_aceptado?: boolean;
  consentimiento_informado_en?: string | null;
  consentimiento_informado_titular?: string;
  consentimiento_ia_aceptado?: boolean;
  consentimiento_version?: string;
  finalizada_en: string | null;
  guardia_legal?: DictamenNom004;
  historial?: ConsultaHistorialItem[];
  aclaraciones?: NotaAclaracionPublica[];
};

type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

function notaExpedienteLegal(nota: NotaClinica, paciente: PacientePublico, datos: DatosMedico = {}): NotaClinica {
  return aplicarSelloLegal(aplicarIdentidadPaciente(nota, paciente), {
    medicoNombre: datos.medicoNombre || nota.medico_nombre,
    medicoCedula: datos.medicoCedula || nota.medico_cedula,
    medicoEspecialidad: datos.medicoEspecialidad || nota.medico_especialidad,
  });
}

export async function withSql<T>(
  env: Env,
  ctx: WaitUntilCtx | undefined,
  fn: (sql: Sql) => Promise<T>
): Promise<T> {
  if (!env.DATABASE_URL) {
    throw new AppError(503, "DATABASE_URL no está configurada.", "DB_NOT_CONFIGURED");
  }
  const sql = createSql(env.DATABASE_URL);
  try {
    await ensureConsultasSchema(sql);
    return await fn(sql);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      closeSql(sql, ctx);
    }
  }
}

export async function ensureConsultasSchema(sql: Sql): Promise<void> {
  await ensureExpedienteSchema(sql);
}

export async function publicConsulta(
  row: ConsultaMedicaRow,
  paciente?: PacientePublico,
  phiSecret?: string
): Promise<ConsultaPublica> {
  const nota = parseNota(row.nota_estructurada);
  const fechaHora = row.fecha_hora instanceof Date ? row.fecha_hora.toISOString() : String(row.fecha_hora);
  const pacienteNombre = paciente?.nombre_completo || row.paciente_nombre || nota?.nombre_paciente || "";
  const transcripcion = phiSecret
    ? await descifrarPhi(phiSecret, row.transcripcion)
    : row.transcripcion;
  return {
    id: String(row.id),
    paciente_id: String(row.paciente_id),
    fecha: fechaHora,
    fecha_hora: fechaHora,
    paciente_nombre: pacienteNombre,
    paciente,
    resumen: row.resumen,
    transcripcion,
    nota_estructurada: nota,
    motivo_consulta: row.motivo_consulta,
    exploracion_fisica: row.exploracion_fisica,
    padecimiento_actual: row.padecimiento_actual,
    diagnostico: row.diagnostico,
    tratamiento: row.tratamiento ?? nota?.tratamiento ?? [],
    notas_evolucion: row.notas_evolucion,
    plan: row.plan,
    receta_paciente_nativo: parseRecetaRow(row.receta_paciente_nativo),
    idioma: row.idioma,
    especialidad: row.especialidad,
    modelo_whisper: row.modelo_whisper,
    modelo_llm: row.modelo_llm,
    nombre_archivo: row.nombre_archivo,
    estado: row.estado,
    medico_nombre: row.medico_nombre,
    medico_cedula: row.medico_cedula,
    medico_id: row.medico_id ? String(row.medico_id) : null,
    consentimiento_informado_aceptado: Boolean(row.consentimiento_informado_aceptado),
    consentimiento_informado_en: row.consentimiento_informado_en
      ? row.consentimiento_informado_en instanceof Date
        ? row.consentimiento_informado_en.toISOString()
        : String(row.consentimiento_informado_en)
      : null,
    consentimiento_informado_titular: row.consentimiento_informado_titular ?? "",
    consentimiento_ia_aceptado: Boolean(row.consentimiento_ia_aceptado),
    consentimiento_version: row.consentimiento_version ?? "",
    finalizada_en:
      row.finalizada_en instanceof Date ? row.finalizada_en.toISOString() : row.finalizada_en ?? null,
    guardia_legal: nota ? validarNotaNom004(nota) : undefined,
    historial: [],
    aclaraciones: [],
  };
}

function parseNota(value: ConsultaMedicaRow["nota_estructurada"]): NotaClinica | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as NotaClinica;
    } catch {
      return null;
    }
  }
  return value;
}

function parseRecetaRow(value: ConsultaMedicaRow["receta_paciente_nativo"]): RecetaPaciente | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as RecetaPaciente;
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * Episodios clínicos. Tabla oficial: `consultas` (NOM-004).
 * No usar `consultas_medicas` (legado absorbido al arrancar el Worker).
 */
export async function insertConsulta(
  sql: Sql,
  input: {
    pacienteId: string;
    pacienteNombre: string;
    transcripcion: string;
    nota: NotaClinica;
    receta: RecetaPaciente;
    idioma: string;
    especialidad: string;
    modeloWhisper: string;
    modeloLlm: string;
    nombreArchivo: string | null;
    medicoId?: string | null;
    phiSecret?: string;
  }
): Promise<ConsultaMedicaRow> {
  const transcripcion = input.phiSecret
    ? await cifrarPhi(input.phiSecret, input.transcripcion)
    : input.transcripcion;
  const inserted = await sql<ConsultaMedicaRow[]>`
    INSERT INTO consultas (
      paciente_id, motivo_consulta, exploracion_fisica, diagnostico, tratamiento,
      notas_evolucion, padecimiento_actual, plan, resumen, transcripcion, nota_estructurada,
      receta_paciente_nativo, idioma, especialidad, modelo_whisper, modelo_llm, nombre_archivo, estado,
      medico_nombre, medico_cedula, medico_id
    ) VALUES (
      ${input.pacienteId}::uuid,
      ${input.nota.motivo_consulta},
      ${input.nota.exploracion_fisica},
      ${input.nota.diagnostico},
      ${sql.json(input.nota.tratamiento ?? [])},
      ${input.nota.notas_evolucion},
      ${input.nota.padecimiento_actual},
      ${input.nota.plan},
      ${input.nota.resumen},
      ${transcripcion},
      ${sql.json(input.nota)},
      ${sql.json(input.receta)},
      ${input.idioma},
      ${input.especialidad},
      ${input.modeloWhisper},
      ${input.modeloLlm},
      ${input.nombreArchivo},
      ${ESTADO_BORRADOR},
      ${input.nota.medico_nombre},
      ${input.nota.medico_cedula},
      ${input.medicoId ?? null}
    )
    RETURNING
      id, paciente_id, fecha_hora, resumen, transcripcion, nota_estructurada, receta_paciente_nativo,
      motivo_consulta, exploracion_fisica, padecimiento_actual, diagnostico,
      tratamiento, notas_evolucion, plan, receta_paciente_nativo, idioma, especialidad,
      modelo_whisper, modelo_llm, nombre_archivo, estado, medico_nombre, medico_cedula, finalizada_en,
      medico_id, consentimiento_informado_aceptado, consentimiento_informado_en,
      consentimiento_informado_titular, consentimiento_ia_aceptado, consentimiento_version
  `;

  const row = inserted[0];
  if (!row) {
    throw new AppError(500, "No se pudo guardar la consulta médica.", "CONSULTA_INSERT_FAILED");
  }
  row.paciente_nombre = input.pacienteNombre;
  return row;
}

export async function abrirConsultaBorrador(
  sql: Sql,
  input: {
    pacienteId: string;
    especialidad?: string;
    datosMedico?: DatosMedico;
    sesion?: SesionMedico;
    phiSecret?: string;
  }
): Promise<{ row: ConsultaMedicaRow; paciente: PacientePublico; historial: ConsultaHistorialItem[] }> {
  if (!isUuid(input.pacienteId)) {
    throw new AppError(
      400,
      "Identifica al paciente en el expediente maestro antes de abrir la consulta.",
      "PACIENTE_REQUERIDO"
    );
  }
  const paciente = await exigirPaciente(sql, input.pacienteId, input.sesion);
  const historial = await listHistorialPaciente(sql, input.pacienteId, input.sesion);
  const nota = notaExpedienteLegal(notaDesdeExpediente(paciente, input.datosMedico ?? {}), paciente, input.datosMedico ?? {});
  const receta = recetaDesdeNota(nota, "es");
  const row = await insertConsulta(sql, {
    pacienteId: paciente.id,
    pacienteNombre: paciente.nombre_completo,
    transcripcion: "",
    nota,
    receta,
    idioma: "es",
    especialidad: input.especialidad || "medicina_general",
    modeloWhisper: "",
    modeloLlm: "",
    nombreArchivo: null,
    medicoId: input.sesion?.userId ?? null,
    phiSecret: input.phiSecret,
  });
  return { row, paciente, historial };
}

export async function listConsultas(
  sql: Sql,
  page: number,
  pageSize: number,
  sesion?: SesionMedico
): Promise<{ rows: ConsultaMedicaRow[]; pacientes: Map<string, PacientePublico>; total: number }> {
  const offset = (page - 1) * pageSize;
  const soloPropios = sesion && !esRolPrivilegiado(sesion.role);
  const [countRows, rows] = await Promise.all([
    soloPropios
      ? sql<{ count: string | number }[]>`SELECT COUNT(*)::int AS count FROM consultas WHERE medico_id = ${sesion.userId}::uuid`
      : sql<{ count: string | number }[]>`SELECT COUNT(*)::int AS count FROM consultas`,
    soloPropios
      ? sql<ConsultaMedicaRow[]>`
          SELECT
            c.id, c.paciente_id, c.fecha_hora, c.resumen, c.transcripcion, c.nota_estructurada,
            c.motivo_consulta, c.exploracion_fisica, c.padecimiento_actual, c.diagnostico,
            c.tratamiento, c.notas_evolucion, c.plan, c.receta_paciente_nativo, c.idioma, c.especialidad,
            c.modelo_whisper, c.modelo_llm, c.nombre_archivo, c.estado, c.medico_nombre, c.medico_cedula, c.finalizada_en,
            c.medico_id, c.consentimiento_informado_aceptado, c.consentimiento_informado_en,
            c.consentimiento_informado_titular, c.consentimiento_ia_aceptado, c.consentimiento_version
          FROM consultas c
          WHERE c.medico_id = ${sesion.userId}::uuid
          ORDER BY c.fecha_hora DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `
      : sql<ConsultaMedicaRow[]>`
          SELECT
            c.id, c.paciente_id, c.fecha_hora, c.resumen, c.transcripcion, c.nota_estructurada,
            c.motivo_consulta, c.exploracion_fisica, c.padecimiento_actual, c.diagnostico,
            c.tratamiento, c.notas_evolucion, c.plan, c.receta_paciente_nativo, c.idioma, c.especialidad,
            c.modelo_whisper, c.modelo_llm, c.nombre_archivo, c.estado, c.medico_nombre, c.medico_cedula, c.finalizada_en,
            c.medico_id, c.consentimiento_informado_aceptado, c.consentimiento_informado_en,
            c.consentimiento_informado_titular, c.consentimiento_ia_aceptado, c.consentimiento_version
          FROM consultas c
          ORDER BY c.fecha_hora DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
  ]);

  const ids = [...new Set(rows.map((row) => String(row.paciente_id)).filter(Boolean))];
  const pacientes = new Map<string, PacientePublico>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        pacientes.set(id, await exigirPaciente(sql, id, sesion));
      } catch {
        /* expediente huerfano */
      }
    })
  );
  return { rows, pacientes, total: Number(countRows[0]?.count ?? 0) };
}

export async function getConsultaById(sql: Sql, id: string): Promise<ConsultaMedicaRow | null> {
  if (!isUuid(id)) return null;
  const rows = await sql<ConsultaMedicaRow[]>`
    SELECT
      id, paciente_id, fecha_hora, resumen, transcripcion, nota_estructurada,
      motivo_consulta, exploracion_fisica, padecimiento_actual, diagnostico,
      tratamiento, notas_evolucion, plan, receta_paciente_nativo, idioma, especialidad,
      modelo_whisper, modelo_llm, nombre_archivo, estado, medico_nombre, medico_cedula, finalizada_en,
      medico_id, consentimiento_informado_aceptado, consentimiento_informado_en,
      consentimiento_informado_titular, consentimiento_ia_aceptado, consentimiento_version
    FROM consultas
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function exigirConsultaAcceso(
  sql: Sql,
  id: string,
  sesion: SesionMedico
): Promise<ConsultaMedicaRow> {
  const row = await getConsultaById(sql, id);
  if (!row) throw new AppError(404, "Consulta médica no encontrada.", "CONSULTA_NOT_FOUND");
  denegarSiAjeno(row.medico_id ? String(row.medico_id) : null, sesion);
  if (!row.medico_id && !esRolPrivilegiado(sesion.role)) {
    await sql`
      UPDATE consultas SET medico_id = ${sesion.userId}::uuid
      WHERE id = ${id}::uuid AND medico_id IS NULL
    `;
    row.medico_id = sesion.userId;
  }
  return row;
}

export async function procesarConsultaDesdeAudio(
  env: Env,
  input: {
    audio: AudioUpload;
    pacienteId: string;
    especialidad: string;
    datosMedico?: DatosMedico;
    consultaId?: string;
    sesion?: SesionMedico;
  },
  ctx?: WaitUntilCtx
): Promise<{
  transcripcion: string;
  nota: NotaClinica;
  receta: RecetaPaciente;
  row: ConsultaMedicaRow;
  paciente: PacientePublico;
  guardia_legal: DictamenNom004;
}> {
  const whisper = await transcribeAudio(env, input.audio.blob, input.audio.filename);
  return procesarConsultaDesdeTexto(
    env,
    {
      transcripcion: whisper.text,
      pacienteId: input.pacienteId,
      idiomaDetectado: whisper.language,
      especialidad: input.especialidad,
      nombreArchivo: input.audio.filename,
      datosMedico: input.datosMedico,
      consultaId: input.consultaId,
      sesion: input.sesion,
    },
    ctx
  );
}

export async function procesarConsultaDesdeTexto(
  env: Env,
  input: {
    transcripcion: string;
    pacienteId: string;
    idiomaDetectado?: string;
    especialidad: string;
    nombreArchivo?: string | null;
    datosMedico?: DatosMedico;
    consultaId?: string;
    sesion?: SesionMedico;
  },
  ctx?: WaitUntilCtx
): Promise<{
  transcripcion: string;
  nota: NotaClinica;
  receta: RecetaPaciente;
  row: ConsultaMedicaRow;
  paciente: PacientePublico;
  guardia_legal: DictamenNom004;
}> {
  const transcripcion = input.transcripcion.trim();
  if (!transcripcion) {
    throw new AppError(400, "La transcripción no puede estar vacía.", "TRANSCRIPT_EMPTY");
  }

  let pacienteId = (input.pacienteId ?? "").trim();
  if (!isUuid(pacienteId) && input.consultaId) {
    const existente = await withSql(env, ctx, (sql) =>
      input.sesion
        ? exigirConsultaAcceso(sql, input.consultaId as string, input.sesion)
        : getConsultaById(sql, input.consultaId as string)
    );
    if (existente) {
      exigirConsentimientoConsulta(existente);
      pacienteId = String(existente.paciente_id);
    }
  }
  if (!isUuid(pacienteId)) {
    throw new AppError(
      400,
      "Identifica al paciente en el expediente maestro antes de registrar la consulta.",
      "PACIENTE_REQUERIDO"
    );
  }

  const { paciente, historial } = await withSql(env, ctx, async (sql) => {
    if (input.consultaId && input.sesion) {
      await exigirConsultaAcceso(sql, input.consultaId, input.sesion);
    }
    const found = await exigirPaciente(sql, pacienteId, input.sesion);
    const previas = await listHistorialPaciente(sql, pacienteId, input.sesion);
    return { paciente: found, historial: previas };
  });

  const contexto = contextoHistorialParaLlm(paciente, historial);
  const documentacion = await redactarNotaClinica(
    env,
    transcripcion,
    input.especialidad,
    paciente.nombre_completo,
    {
      ...input.datosMedico,
      sexo: input.datosMedico?.sexo || paciente.sexo,
      domicilio: input.datosMedico?.domicilio || paciente.domicilio,
    },
    contexto,
    input.idiomaDetectado ?? ""
  );
  const nota = notaExpedienteLegal(documentacion.nota, paciente, input.datosMedico ?? {});
  const receta = documentacion.receta;
  const idioma = documentacion.idioma_detectado || input.idiomaDetectado || "es";

  const row = await withSql(env, ctx, async (sql) => {
    if (input.consultaId) {
      return guardarDocumentacionConsulta(sql, input.consultaId, {
        pacienteId: paciente.id,
        transcripcion,
        nota,
        receta,
        idioma,
        especialidad: input.especialidad,
        modeloWhisper: env.GROQ_WHISPER_MODEL || "whisper-large-v3",
        modeloLlm: env.GROQ_MODEL || "llama-3.3-70b-versatile",
        nombreArchivo: input.nombreArchivo ?? null,
        sesion: input.sesion,
        phiSecret: env.SECRET_KEY,
      });
    }
    return insertConsulta(sql, {
      pacienteId: paciente.id,
      pacienteNombre: paciente.nombre_completo,
      transcripcion,
      nota,
      receta,
      idioma,
      especialidad: input.especialidad,
      modeloWhisper: env.GROQ_WHISPER_MODEL || "whisper-large-v3",
      modeloLlm: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      nombreArchivo: input.nombreArchivo ?? null,
      medicoId: input.sesion?.userId ?? null,
      phiSecret: env.SECRET_KEY,
    });
  });

  return { transcripcion, nota, receta, row, paciente, guardia_legal: validarNotaNom004(nota) };
}

export async function guardarDocumentacionConsulta(
  sql: Sql,
  id: string,
  input: {
    pacienteId: string;
    transcripcion: string;
    nota: NotaClinica;
    receta: RecetaPaciente;
    idioma: string;
    especialidad: string;
    modeloWhisper: string;
    modeloLlm: string;
    nombreArchivo: string | null;
    sesion?: SesionMedico;
    phiSecret?: string;
  }
): Promise<ConsultaMedicaRow> {
  const actual = input.sesion
    ? await exigirConsultaAcceso(sql, id, input.sesion)
    : await getConsultaById(sql, id);
  if (!actual) throw new AppError(404, "Consulta médica no encontrada.", "CONSULTA_NOT_FOUND");
  if (consultaInmutable(actual.estado)) throw notaInmutableError();
  exigirConsentimientoConsulta(actual);
  if (String(actual.paciente_id) !== input.pacienteId) {
    throw new AppError(409, "La consulta no pertenece a este expediente maestro.", "CONSULTA_PACIENTE_MISMATCH");
  }
  const paciente = await exigirPaciente(sql, input.pacienteId, input.sesion);
  const notaFinal = notaExpedienteLegal(input.nota, paciente);
  const transcripcion = input.phiSecret
    ? await cifrarPhi(input.phiSecret, input.transcripcion)
    : input.transcripcion;
  const updated = await sql<ConsultaMedicaRow[]>`
    UPDATE consultas
    SET
      transcripcion = ${transcripcion},
      nota_estructurada = ${sql.json(notaFinal)},
      receta_paciente_nativo = ${sql.json(input.receta)},
      resumen = ${notaFinal.resumen},
      motivo_consulta = ${notaFinal.motivo_consulta},
      exploracion_fisica = ${notaFinal.exploracion_fisica},
      padecimiento_actual = ${notaFinal.padecimiento_actual},
      diagnostico = ${notaFinal.diagnostico},
      tratamiento = ${sql.json(notaFinal.tratamiento ?? [])},
      notas_evolucion = ${notaFinal.notas_evolucion},
      plan = ${notaFinal.plan},
      idioma = ${input.idioma},
      especialidad = ${input.especialidad},
      modelo_whisper = ${input.modeloWhisper},
      modelo_llm = ${input.modeloLlm},
      nombre_archivo = ${input.nombreArchivo},
      medico_nombre = ${notaFinal.medico_nombre},
      medico_cedula = ${notaFinal.medico_cedula},
      updated_at = NOW()
    WHERE id = ${id}::uuid AND estado NOT IN ('locked', 'finalizada')
    RETURNING
      id, paciente_id, fecha_hora, resumen, transcripcion, nota_estructurada,
      motivo_consulta, exploracion_fisica, padecimiento_actual, diagnostico,
      tratamiento, notas_evolucion, plan, receta_paciente_nativo, idioma, especialidad,
      modelo_whisper, modelo_llm, nombre_archivo, estado, medico_nombre, medico_cedula, finalizada_en,
      medico_id, consentimiento_informado_aceptado, consentimiento_informado_en,
      consentimiento_informado_titular, consentimiento_ia_aceptado, consentimiento_version
  `;
  if (!updated[0]) throw notaInmutableError();
  updated[0].paciente_nombre = paciente.nombre_completo;
  return updated[0];
}

export async function actualizarConsulta(
  sql: Sql,
  id: string,
  nota: NotaClinica,
  receta?: RecetaPaciente | null,
  datosMedico: DatosMedico = {},
  sesion?: SesionMedico
): Promise<ConsultaMedicaRow> {
  const actual = sesion ? await exigirConsultaAcceso(sql, id, sesion) : await getConsultaById(sql, id);
  if (!actual) throw new AppError(404, "Consulta médica no encontrada.", "CONSULTA_NOT_FOUND");
  if (consultaInmutable(actual.estado)) throw notaInmutableError();
  exigirConsentimientoConsulta(actual);

  const paciente = await exigirPaciente(sql, String(actual.paciente_id), sesion);
  const notaFinal = notaExpedienteLegal(nota, paciente, datosMedico);
  const recetaFinal = receta ?? parseRecetaRow(actual.receta_paciente_nativo);
  const recetaToSave: RecetaPaciente = recetaFinal ?? {
    idioma: actual.idioma || "es",
    idioma_nombre: "",
    titulo: "",
    resumen: "",
    indicaciones: "",
    medicamentos: [],
    alarmas: "",
    seguimiento: "",
  };

  const updated = await sql<ConsultaMedicaRow[]>`
    UPDATE consultas
    SET
      nota_estructurada = ${sql.json(notaFinal)},
      receta_paciente_nativo = ${sql.json(recetaToSave)},
      resumen = ${notaFinal.resumen},
      motivo_consulta = ${notaFinal.motivo_consulta},
      exploracion_fisica = ${notaFinal.exploracion_fisica},
      padecimiento_actual = ${notaFinal.padecimiento_actual},
      diagnostico = ${notaFinal.diagnostico},
      tratamiento = ${sql.json(notaFinal.tratamiento ?? [])},
      notas_evolucion = ${notaFinal.notas_evolucion},
      plan = ${notaFinal.plan},
      medico_nombre = ${notaFinal.medico_nombre},
      medico_cedula = ${notaFinal.medico_cedula},
      updated_at = NOW()
    WHERE id = ${id}::uuid AND estado NOT IN ('locked', 'finalizada')
    RETURNING
      id, paciente_id, fecha_hora, resumen, transcripcion, nota_estructurada,
      motivo_consulta, exploracion_fisica, padecimiento_actual, diagnostico,
      tratamiento, notas_evolucion, plan, receta_paciente_nativo, idioma, especialidad,
      modelo_whisper, modelo_llm, nombre_archivo, estado, medico_nombre, medico_cedula, finalizada_en,
      medico_id, consentimiento_informado_aceptado, consentimiento_informado_en,
      consentimiento_informado_titular, consentimiento_ia_aceptado, consentimiento_version
  `;
  if (!updated[0]) throw notaInmutableError();
  updated[0].paciente_nombre = paciente.nombre_completo;
  return updated[0];
}

export async function finalizarConsulta(
  sql: Sql,
  id: string,
  nota?: NotaClinica,
  receta?: RecetaPaciente | null,
  datosMedico: DatosMedico = {},
  sesion?: SesionMedico
): Promise<ConsultaMedicaRow> {
  const actual = sesion ? await exigirConsultaAcceso(sql, id, sesion) : await getConsultaById(sql, id);
  if (!actual) throw new AppError(404, "Consulta médica no encontrada.", "CONSULTA_NOT_FOUND");
  if (consultaInmutable(actual.estado)) throw notaInmutableError();
  exigirConsentimientoConsulta(actual);

  const paciente = await exigirPaciente(sql, String(actual.paciente_id), sesion);
  const parsed = nota ?? parseNota(actual.nota_estructurada);
  if (!parsed) throw new AppError(400, "No hay nota estructurada para finalizar.", "NOTA_VACIA");
  const notaFinal = notaExpedienteLegal(parsed, paciente, datosMedico);
  exigirNotaNom004(notaFinal);
  const recetaFinal = receta ?? parseRecetaRow(actual.receta_paciente_nativo);
  const recetaToSave: RecetaPaciente = recetaFinal ?? {
    idioma: actual.idioma || "es",
    idioma_nombre: "",
    titulo: "",
    resumen: "",
    indicaciones: "",
    medicamentos: [],
    alarmas: "",
    seguimiento: "",
  };

  const now = new Date().toISOString();
  const updated = await sql<ConsultaMedicaRow[]>`
    UPDATE consultas
    SET
      nota_estructurada = ${sql.json(notaFinal)},
      receta_paciente_nativo = ${sql.json(recetaToSave)},
      resumen = ${notaFinal.resumen},
      motivo_consulta = ${notaFinal.motivo_consulta},
      exploracion_fisica = ${notaFinal.exploracion_fisica},
      padecimiento_actual = ${notaFinal.padecimiento_actual},
      diagnostico = ${notaFinal.diagnostico},
      tratamiento = ${sql.json(notaFinal.tratamiento ?? [])},
      notas_evolucion = ${notaFinal.notas_evolucion},
      plan = ${notaFinal.plan},
      medico_nombre = ${notaFinal.medico_nombre},
      medico_cedula = ${notaFinal.medico_cedula},
      estado = ${ESTADO_LOCKED},
      finalizada_en = ${now},
      updated_at = NOW()
    WHERE id = ${id}::uuid AND estado NOT IN ('locked', 'finalizada')
    RETURNING
      id, paciente_id, fecha_hora, resumen, transcripcion, nota_estructurada,
      motivo_consulta, exploracion_fisica, padecimiento_actual, diagnostico,
      tratamiento, notas_evolucion, plan, receta_paciente_nativo, idioma, especialidad,
      modelo_whisper, modelo_llm, nombre_archivo, estado, medico_nombre, medico_cedula, finalizada_en,
      medico_id, consentimiento_informado_aceptado, consentimiento_informado_en,
      consentimiento_informado_titular, consentimiento_ia_aceptado, consentimiento_version
  `;
  if (!updated[0]) throw notaInmutableError();
  updated[0].paciente_nombre = paciente.nombre_completo;
  return updated[0];
}
