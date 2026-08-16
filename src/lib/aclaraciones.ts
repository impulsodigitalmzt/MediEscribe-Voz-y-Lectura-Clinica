import type { Sql } from "../db.js";
import { AppError } from "./errors";
import { consultaInmutable, notaInmutableError } from "./guardia-legal";
import { selloResponsableLegal, type DatosMedico } from "./nota-clinica";
import { isUuid } from "./pacientes";

export type TipoAclaracion = "aclaracion" | "rectificacion";

export type NotaAclaracionRow = {
  id: string;
  consulta_id: string;
  paciente_id: string;
  tipo: TipoAclaracion;
  motivo: string;
  contenido: string;
  medico_nombre: string;
  medico_cedula: string;
  medico_especialidad: string;
  sello_responsable: string;
  estado: string;
  locked_en: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type NotaAclaracionPublica = {
  id: string;
  consulta_id: string;
  paciente_id: string;
  tipo: TipoAclaracion;
  motivo: string;
  contenido: string;
  medico_nombre: string;
  medico_cedula: string;
  medico_especialidad: string;
  sello_responsable: string;
  estado: string;
  locked_en: string | null;
  created_at: string;
  updated_at: string;
};

function asIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function publicAclaracion(row: NotaAclaracionRow): NotaAclaracionPublica {
  return {
    id: String(row.id),
    consulta_id: String(row.consulta_id),
    paciente_id: String(row.paciente_id),
    tipo: row.tipo === "rectificacion" ? "rectificacion" : "aclaracion",
    motivo: row.motivo,
    contenido: row.contenido,
    medico_nombre: row.medico_nombre,
    medico_cedula: row.medico_cedula,
    medico_especialidad: row.medico_especialidad ?? "",
    sello_responsable: row.sello_responsable,
    estado: row.estado,
    locked_en: asIso(row.locked_en),
    created_at: asIso(row.created_at) ?? "",
    updated_at: asIso(row.updated_at) ?? "",
  };
}

function selloDesdeDatos(datos: DatosMedico): {
  nombre: string;
  cedula: string;
  especialidad: string;
  sello: string;
} {
  const nombre = (datos.medicoNombre ?? "").trim();
  const cedula = (datos.medicoCedula ?? "").trim();
  const especialidad = (datos.medicoEspecialidad ?? "").trim();
  if (!nombre || !cedula) {
    throw new AppError(
      400,
      "La nota de aclaración requiere nombre y cédula del médico responsable en sesión.",
      "SELLO_REQUERIDO"
    );
  }
  return {
    nombre,
    cedula,
    especialidad,
    sello: selloResponsableLegal(nombre, cedula, especialidad),
  };
}

export async function listarNotasAclaracion(sql: Sql, consultaId: string): Promise<NotaAclaracionPublica[]> {
  if (!isUuid(consultaId)) return [];
  const rows = await sql<NotaAclaracionRow[]>`
    SELECT id, consulta_id, paciente_id, tipo, motivo, contenido,
           medico_nombre, medico_cedula, medico_especialidad, sello_responsable,
           estado, locked_en, created_at, updated_at
    FROM notas_aclaracion
    WHERE consulta_id = ${consultaId}::uuid
    ORDER BY created_at ASC
  `;
  return rows.map(publicAclaracion);
}

export async function crearNotaAclaracion(
  sql: Sql,
  consultaId: string,
  input: { tipo?: string; motivo?: string; contenido?: string },
  datos: DatosMedico
): Promise<NotaAclaracionPublica> {
  const originales = await sql<{ id: string; paciente_id: string; estado: string | null }[]>`
    SELECT id, paciente_id, estado FROM consultas WHERE id = ${consultaId}::uuid LIMIT 1
  `;
  const original = originales[0];
  if (!original) throw new AppError(404, "Consulta médica no encontrada.", "CONSULTA_NOT_FOUND");
  if (!consultaInmutable(original.estado)) {
    throw new AppError(
      409,
      "Solo se emiten notas de aclaración o rectificación sobre una consulta ya locked.",
      "CONSULTA_NO_CERRADA"
    );
  }

  const tipo: TipoAclaracion = input.tipo === "rectificacion" ? "rectificacion" : "aclaracion";
  const motivo = (input.motivo ?? "").trim();
  const contenido = (input.contenido ?? "").trim();
  if (motivo.length < 8) {
    throw new AppError(400, "Indica el motivo de la aclaración o rectificación.", "MOTIVO_REQUERIDO");
  }
  if (contenido.length < 12) {
    throw new AppError(400, "Redacta el contenido de la nota de aclaración.", "CONTENIDO_REQUERIDO");
  }

  const sello = selloDesdeDatos(datos);
  const inserted = await sql<NotaAclaracionRow[]>`
    INSERT INTO notas_aclaracion (
      consulta_id, paciente_id, tipo, motivo, contenido,
      medico_nombre, medico_cedula, medico_especialidad, sello_responsable, estado, locked_en
    ) VALUES (
      ${consultaId}::uuid,
      ${String(original.paciente_id)}::uuid,
      ${tipo},
      ${motivo},
      ${contenido},
      ${sello.nombre},
      ${sello.cedula},
      ${sello.especialidad},
      ${sello.sello},
      'locked',
      NOW()
    )
    RETURNING id, consulta_id, paciente_id, tipo, motivo, contenido,
              medico_nombre, medico_cedula, medico_especialidad, sello_responsable,
              estado, locked_en, created_at, updated_at
  `;
  const row = inserted[0];
  if (!row) throw new AppError(500, "No se pudo registrar la nota de aclaración.", "ACLARACION_INSERT_FAILED");
  return publicAclaracion(row);
}

export async function actualizarNotaAclaracion(
  sql: Sql,
  consultaId: string,
  aclaracionId: string,
  input: { motivo?: string; contenido?: string; tipo?: string },
  datos: DatosMedico
): Promise<NotaAclaracionPublica> {
  if (!isUuid(aclaracionId)) throw new AppError(400, "Identificador de aclaración inválido.", "ACLARACION_ID_INVALIDO");
  const rows = await sql<NotaAclaracionRow[]>`
    SELECT id, consulta_id, paciente_id, tipo, motivo, contenido,
           medico_nombre, medico_cedula, medico_especialidad, sello_responsable,
           estado, locked_en, created_at, updated_at
    FROM notas_aclaracion
    WHERE id = ${aclaracionId}::uuid AND consulta_id = ${consultaId}::uuid
    LIMIT 1
  `;
  const actual = rows[0];
  if (!actual) throw new AppError(404, "Nota de aclaración no encontrada.", "ACLARACION_NOT_FOUND");
  if (consultaInmutable(actual.estado)) throw notaInmutableError();

  const sello = selloDesdeDatos(datos);
  const motivo = (input.motivo ?? actual.motivo).trim();
  const contenido = (input.contenido ?? actual.contenido).trim();
  const tipo: TipoAclaracion =
    input.tipo === "rectificacion" || input.tipo === "aclaracion"
      ? input.tipo
      : actual.tipo === "rectificacion"
        ? "rectificacion"
        : "aclaracion";

  const updated = await sql<NotaAclaracionRow[]>`
    UPDATE notas_aclaracion
    SET
      tipo = ${tipo},
      motivo = ${motivo},
      contenido = ${contenido},
      medico_nombre = ${sello.nombre},
      medico_cedula = ${sello.cedula},
      medico_especialidad = ${sello.especialidad},
      sello_responsable = ${sello.sello},
      updated_at = NOW()
    WHERE id = ${aclaracionId}::uuid AND estado NOT IN ('locked', 'finalizada')
    RETURNING id, consulta_id, paciente_id, tipo, motivo, contenido,
              medico_nombre, medico_cedula, medico_especialidad, sello_responsable,
              estado, locked_en, created_at, updated_at
  `;
  if (!updated[0]) throw notaInmutableError();
  return publicAclaracion(updated[0]);
}

export async function cerrarNotaAclaracion(
  sql: Sql,
  consultaId: string,
  aclaracionId: string,
  datos: DatosMedico
): Promise<NotaAclaracionPublica> {
  const draft = await actualizarNotaAclaracion(sql, consultaId, aclaracionId, {}, datos);
  const closed = await sql<NotaAclaracionRow[]>`
    UPDATE notas_aclaracion
    SET estado = 'locked', locked_en = NOW(), updated_at = NOW()
    WHERE id = ${draft.id}::uuid AND estado NOT IN ('locked', 'finalizada')
    RETURNING id, consulta_id, paciente_id, tipo, motivo, contenido,
              medico_nombre, medico_cedula, medico_especialidad, sello_responsable,
              estado, locked_en, created_at, updated_at
  `;
  if (!closed[0]) throw notaInmutableError();
  return publicAclaracion(closed[0]);
}
