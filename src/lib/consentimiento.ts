import type { Sql } from "../db.js";
import { AppError } from "./errors";
import { consultaInmutable } from "./guardia-legal";
import { clientIp, userAgent } from "./http";
import type { Context } from "hono";

export const CONSENTIMIENTO_VERSION = "LFPDPPP-NOM004-2026-08";

export type ConsentimientoConsulta = {
  consentimiento_informado_aceptado: boolean;
  consentimiento_informado_en: string | null;
  consentimiento_informado_titular: string;
  consentimiento_ia_aceptado: boolean;
  consentimiento_version: string;
};

export function consentimientoCompleto(row: {
  consentimiento_informado_aceptado?: boolean | null;
  consentimiento_ia_aceptado?: boolean | null;
}): boolean {
  return Boolean(row.consentimiento_informado_aceptado) && Boolean(row.consentimiento_ia_aceptado);
}

export function exigirConsentimientoConsulta(row: {
  consentimiento_informado_aceptado?: boolean | null;
  consentimiento_ia_aceptado?: boolean | null;
  estado?: string | null;
}): void {
  if (consultaInmutable(row.estado)) return;
  if (!consentimientoCompleto(row)) {
    throw new AppError(
      400,
      "Registre el consentimiento informado del paciente (LFPDPPP y NOM-004) antes de guardar o enviar datos a IA.",
      "CONSENTIMIENTO_CONSULTA_REQUERIDO"
    );
  }
}

export async function registrarConsentimientoConsulta(
  sql: Sql,
  input: {
    consultaId: string;
    pacienteId: string;
    medicoId: string;
    titularNombre: string;
    informado: boolean;
    ia: boolean;
    request?: Context;
  }
): Promise<ConsentimientoConsulta> {
  const titular = input.titularNombre.trim();
  if (!input.informado || !input.ia) {
    throw new AppError(
      400,
      "Debe aceptar el consentimiento informado y el tratamiento de datos con IA.",
      "CONSENTIMIENTO_INCOMPLETO"
    );
  }
  if (titular.length < 3) {
    throw new AppError(
      400,
      "Anote el nombre del titular o de su representante legal.",
      "CONSENTIMIENTO_TITULAR_REQUERIDO"
    );
  }

  const ip = input.request ? clientIp(input.request) : "";
  const ua = input.request ? userAgent(input.request) : "";

  const updated = await sql<
    {
      consentimiento_informado_aceptado: boolean;
      consentimiento_informado_en: string | Date | null;
      consentimiento_informado_titular: string;
      consentimiento_ia_aceptado: boolean;
      consentimiento_version: string;
      estado: string | null;
    }[]
  >`
    UPDATE consultas
    SET
      consentimiento_informado_aceptado = true,
      consentimiento_informado_en = COALESCE(consentimiento_informado_en, NOW()),
      consentimiento_informado_titular = ${titular},
      consentimiento_ia_aceptado = true,
      consentimiento_version = ${CONSENTIMIENTO_VERSION},
      updated_at = NOW()
    WHERE id = ${input.consultaId}::uuid
      AND estado NOT IN ('locked', 'finalizada')
    RETURNING
      consentimiento_informado_aceptado,
      consentimiento_informado_en,
      consentimiento_informado_titular,
      consentimiento_ia_aceptado,
      consentimiento_version,
      estado
  `;
  const row = updated[0];
  if (!row) {
    throw new AppError(
      409,
      "No se puede registrar el consentimiento en una consulta cerrada o inexistente.",
      "CONSENTIMIENTO_NO_REGISTRABLE"
    );
  }

  await sql`
    INSERT INTO consentimientos_consulta (
      consulta_id, paciente_id, medico_id, tipo, aceptado, titular_nombre, version_aviso, ip, user_agent
    ) VALUES
      (${input.consultaId}::uuid, ${input.pacienteId}::uuid, ${input.medicoId}::uuid,
       'informado_consulta', true, ${titular}, ${CONSENTIMIENTO_VERSION}, ${ip}, ${ua}),
      (${input.consultaId}::uuid, ${input.pacienteId}::uuid, ${input.medicoId}::uuid,
       'procesamiento_ia', true, ${titular}, ${CONSENTIMIENTO_VERSION}, ${ip}, ${ua})
  `;

  return {
    consentimiento_informado_aceptado: true,
    consentimiento_informado_en:
      row.consentimiento_informado_en instanceof Date
        ? row.consentimiento_informado_en.toISOString()
        : row.consentimiento_informado_en,
    consentimiento_informado_titular: titular,
    consentimiento_ia_aceptado: true,
    consentimiento_version: CONSENTIMIENTO_VERSION,
  };
}
