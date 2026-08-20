import { Hono } from "hono";
import type { Context } from "hono";
import { extractConsultaFields, parseConsultaMultipart, parseMultipartBody } from "../lib/audio";
import { auditExpedienteMiddleware } from "../lib/audit";
import { datosMedicoDesdeSesion, requireAuth, sesionDesdeAuth, type AuthContext } from "../lib/auth";
import { isAppError } from "../lib/errors";
import { isNom004Error, NORMA_EXPEDIENTE } from "../lib/guardia-legal";
import { jsonError } from "../lib/http";
import {
  abrirConsultaBorrador,
  actualizarConsulta,
  exigirConsultaAcceso,
  finalizarConsulta,
  listConsultas,
  procesarConsultaDesdeAudio,
  procesarConsultaDesdeTexto,
  publicConsulta,
  withSql,
} from "../lib/consultas";
import { exigirPaciente, isUuid, listHistorialPaciente } from "../lib/pacientes";
import type { NotaClinica, RecetaPaciente } from "../lib/nota-clinica";
import { registrarConsentimientoConsulta } from "../lib/consentimiento";
import {
  actualizarNotaAclaracion,
  cerrarNotaAclaracion,
  crearNotaAclaracion,
  listarNotasAclaracion,
} from "../lib/aclaraciones";

export const consultaRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

consultaRoutes.use("*", requireAuth);
consultaRoutes.use("*", auditExpedienteMiddleware());

consultaRoutes.post("/", async (c) => {
  try {
    const form = await parseConsultaMultipart(c);
    const result = await procesarConsultaDesdeAudio(
      c.env,
      {
        audio: form.audio,
        pacienteId: form.pacienteId,
        especialidad: form.especialidad,
        datosMedico: datosMedicoDesdeSesion(c, {
          medicoNombre: form.medicoNombre,
          medicoCedula: form.medicoCedula,
          sexo: form.sexo,
          domicilio: form.domicilio,
        }),
        consultaId: form.consultaId || undefined,
        sesion: sesionDesdeAuth(c),
      },
      c.executionCtx
    );

    return c.json(await respuestaConsulta(c.env.SECRET_KEY, result), 201);
  } catch (error) {
    return consultaError(c, error, "consulta_audio_failed");
  }
});

consultaRoutes.post("/texto", async (c) => {
  try {
    const contentType = c.req.header("Content-Type") ?? "";
    let pacienteId = "";
    let especialidad = "medicina_general";
    let transcripcion = "";
    let medicoNombre = "";
    let medicoCedula = "";
    let sexo = "";
    let domicilio = "";
    let consultaId = "";

    if (contentType.includes("multipart/form-data")) {
      const body = await parseMultipartBody(c);
      const fields = extractConsultaFields(body);
      pacienteId = fields.pacienteId;
      especialidad = fields.especialidad;
      medicoNombre = fields.medicoNombre;
      medicoCedula = fields.medicoCedula;
      sexo = fields.sexo;
      domicilio = fields.domicilio;
      consultaId = fields.consultaId;
      transcripcion =
        typeof body.transcripcion === "string"
          ? body.transcripcion
          : typeof body.texto === "string"
            ? body.texto
            : typeof body.text === "string"
              ? body.text
              : "";
    } else {
      const body = (await c.req.json<{
        transcripcion?: string;
        texto?: string;
        text?: string;
        paciente_id?: string;
        especialidad?: string;
        medico_nombre?: string;
        medico_cedula?: string;
        sexo?: string;
        domicilio?: string;
        consulta_id?: string;
      }>().catch(() => ({}))) as {
        transcripcion?: string;
        texto?: string;
        text?: string;
        paciente_id?: string;
        especialidad?: string;
        medico_nombre?: string;
        medico_cedula?: string;
        sexo?: string;
        domicilio?: string;
        consulta_id?: string;
      };
      transcripcion = body.transcripcion ?? body.texto ?? body.text ?? "";
      pacienteId = (body.paciente_id ?? "").trim();
      especialidad = (body.especialidad ?? especialidad).trim() || especialidad;
      medicoNombre = (body.medico_nombre ?? "").trim();
      medicoCedula = (body.medico_cedula ?? "").trim();
      sexo = (body.sexo ?? "").trim();
      domicilio = (body.domicilio ?? "").trim();
      consultaId = (body.consulta_id ?? "").trim();
    }

    console.log(
      JSON.stringify({
        event: "consulta_texto_start",
        hasGroqApiKey: Boolean(c.env.GROQ_API_KEY),
        groqApiKeyLength: c.env.GROQ_API_KEY ? c.env.GROQ_API_KEY.length : 0,
        groqModel: c.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        transcriptChars: transcripcion.trim().length,
        consultaId: consultaId || null,
        pacienteId: pacienteId || null,
      })
    );

    const result = await procesarConsultaDesdeTexto(
      c.env,
      {
        transcripcion,
        pacienteId,
        especialidad,
        datosMedico: datosMedicoDesdeSesion(c, { medicoNombre, medicoCedula, sexo, domicilio }),
        consultaId: consultaId || undefined,
        sesion: sesionDesdeAuth(c),
      },
      c.executionCtx
    );

    return c.json(await respuestaConsulta(c.env.SECRET_KEY, result), 201);
  } catch (error) {
    return consultaError(c, error, "consulta_texto_failed");
  }
});

consultaRoutes.get("/", async (c) => {
  try {
    const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(c.req.query("page_size") ?? "20", 10) || 20));
    const { rows, pacientes, total } = await withSql(c.env, c.executionCtx, (sql) =>
      listConsultas(sql, page, pageSize, sesionDesdeAuth(c))
    );
    const consultas = await Promise.all(
      rows.map((row) => publicConsulta(row, pacientes.get(String(row.paciente_id)), c.env.SECRET_KEY))
    );
    return c.json({
      ok: true,
      consultas,
      total,
      page,
      page_size: pageSize,
    });
  } catch (error) {
    return consultaError(c, error, "consulta_list_failed");
  }
});

consultaRoutes.post("/abrir", async (c) => {
  try {
    const body = (await c.req.json<{
      paciente_id?: string;
      especialidad?: string;
      medico_nombre?: string;
      medico_cedula?: string;
    }>().catch(() => ({}))) as {
      paciente_id?: string;
      especialidad?: string;
      medico_nombre?: string;
      medico_cedula?: string;
    };
    const pacienteId = (body.paciente_id ?? "").trim();
    const { row, paciente, historial } = await withSql(c.env, c.executionCtx, (sql) =>
      abrirConsultaBorrador(sql, {
        pacienteId,
        especialidad: body.especialidad,
        datosMedico: datosMedicoDesdeSesion(c, {
          medicoNombre: body.medico_nombre,
          medicoCedula: body.medico_cedula,
        }),
        sesion: sesionDesdeAuth(c),
        phiSecret: c.env.SECRET_KEY,
      })
    );
    const publica = await publicConsulta(row, paciente, c.env.SECRET_KEY);
    publica.historial = historial;
    return c.json({ ok: true, consulta: publica, paciente, historial }, 201);
  } catch (error) {
    return consultaError(c, error, "consulta_abrir_failed");
  }
});

consultaRoutes.patch("/:id", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de consulta inválido.");
    const body = (await c.req.json<{ nota?: NotaClinica; receta?: RecetaPaciente }>().catch(() => ({}))) as {
      nota?: NotaClinica;
      receta?: RecetaPaciente;
    };
    if (!body.nota || typeof body.nota !== "object") {
      return jsonError(c, 400, "Envía el objeto nota corregido.");
    }
    const { row, paciente } = await withSql(c.env, c.executionCtx, async (sql) => {
      const updated = await actualizarConsulta(
        sql,
        id,
        body.nota as NotaClinica,
        body.receta,
        datosMedicoDesdeSesion(c),
        sesionDesdeAuth(c)
      );
      const found = await exigirPaciente(sql, String(updated.paciente_id), sesionDesdeAuth(c));
      return { row: updated, paciente: found };
    });
    const publica = await publicConsulta(row, paciente, c.env.SECRET_KEY);
    return c.json({
      ok: true,
      consulta: publica,
      nota: publica.nota_estructurada,
      receta: publica.receta_paciente_nativo,
      guardia_legal: publica.guardia_legal,
    });
  } catch (error) {
    return consultaError(c, error, "consulta_update_failed");
  }
});

consultaRoutes.post("/:id/finalizar", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de consulta inválido.");
    const body = (await c.req.json<{ nota?: NotaClinica; receta?: RecetaPaciente }>().catch(() => ({}))) as {
      nota?: NotaClinica;
      receta?: RecetaPaciente;
    };
    const { row, paciente } = await withSql(c.env, c.executionCtx, async (sql) => {
      const updated = await finalizarConsulta(sql, id, body.nota, body.receta, datosMedicoDesdeSesion(c), sesionDesdeAuth(c));
      const found = await exigirPaciente(sql, String(updated.paciente_id), sesionDesdeAuth(c));
      return { row: updated, paciente: found };
    });
    const publica = await publicConsulta(row, paciente, c.env.SECRET_KEY);
    return c.json({
      ok: true,
      consulta: publica,
      nota: publica.nota_estructurada,
      receta: publica.receta_paciente_nativo,
      guardia_legal: publica.guardia_legal,
    });
  } catch (error) {
    return consultaError(c, error, "consulta_finalize_failed");
  }
});

consultaRoutes.post("/:id/consentimiento", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de consulta inválido.");
    const body = (await c.req.json<{
      titular_nombre?: string;
      consentimiento_informado?: boolean;
      consentimiento_ia?: boolean;
    }>().catch(() => ({}))) as {
      titular_nombre?: string;
      consentimiento_informado?: boolean;
      consentimiento_ia?: boolean;
    };
    const consentimiento = await withSql(c.env, c.executionCtx, async (sql) => {
      const row = await exigirConsultaAcceso(sql, id, sesionDesdeAuth(c));
      return registrarConsentimientoConsulta(sql, {
        consultaId: id,
        pacienteId: String(row.paciente_id),
        medicoId: sesionDesdeAuth(c).userId,
        titularNombre: body.titular_nombre ?? "",
        informado: body.consentimiento_informado !== false,
        ia: body.consentimiento_ia !== false,
        request: c,
      });
    });
    return c.json({ ok: true, consentimiento });
  } catch (error) {
    return consultaError(c, error, "consulta_consentimiento_failed");
  }
});

consultaRoutes.get("/:id/aclaraciones", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de consulta inválido.");
    const aclaraciones = await withSql(c.env, c.executionCtx, (sql) => listarNotasAclaracion(sql, id));
    return c.json({ ok: true, aclaraciones });
  } catch (error) {
    return consultaError(c, error, "aclaracion_list_failed");
  }
});

consultaRoutes.post("/:id/aclaraciones", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de consulta inválido.");
    const body = (await c.req.json<{ tipo?: string; motivo?: string; contenido?: string }>().catch(() => ({}))) as {
      tipo?: string;
      motivo?: string;
      contenido?: string;
    };
    const aclaracion = await withSql(c.env, c.executionCtx, (sql) =>
      crearNotaAclaracion(sql, id, body, datosMedicoDesdeSesion(c))
    );
    return c.json({ ok: true, aclaracion }, 201);
  } catch (error) {
    return consultaError(c, error, "aclaracion_create_failed");
  }
});

consultaRoutes.patch("/:id/aclaraciones/:aclaracionId", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    const aclaracionId = c.req.param("aclaracionId") ?? "";
    if (!isUuid(id) || !isUuid(aclaracionId)) return jsonError(c, 400, "Identificador inválido.");
    const body = (await c.req.json<{ tipo?: string; motivo?: string; contenido?: string }>().catch(() => ({}))) as {
      tipo?: string;
      motivo?: string;
      contenido?: string;
    };
    const aclaracion = await withSql(c.env, c.executionCtx, (sql) =>
      actualizarNotaAclaracion(sql, id, aclaracionId, body, datosMedicoDesdeSesion(c))
    );
    return c.json({ ok: true, aclaracion });
  } catch (error) {
    return consultaError(c, error, "aclaracion_update_failed");
  }
});

consultaRoutes.post("/:id/aclaraciones/:aclaracionId/cerrar", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    const aclaracionId = c.req.param("aclaracionId") ?? "";
    if (!isUuid(id) || !isUuid(aclaracionId)) return jsonError(c, 400, "Identificador inválido.");
    const aclaracion = await withSql(c.env, c.executionCtx, (sql) =>
      cerrarNotaAclaracion(sql, id, aclaracionId, datosMedicoDesdeSesion(c))
    );
    return c.json({ ok: true, aclaracion });
  } catch (error) {
    return consultaError(c, error, "aclaracion_close_failed");
  }
});

consultaRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) {
      return jsonError(c, 400, "Identificador de consulta inválido.");
    }
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const row = await exigirConsultaAcceso(sql, id, sesionDesdeAuth(c));
      const paciente = await exigirPaciente(sql, String(row.paciente_id), sesionDesdeAuth(c));
      const historial = await listHistorialPaciente(sql, String(row.paciente_id), sesionDesdeAuth(c));
      const aclaraciones = await listarNotasAclaracion(sql, id);
      return { row, paciente, historial, aclaraciones };
    });
    if (!payload) return jsonError(c, 404, "Consulta médica no encontrada.");
    const publica = await publicConsulta(payload.row, payload.paciente, c.env.SECRET_KEY);
    publica.historial = payload.historial;
    publica.aclaraciones = payload.aclaraciones;
    return c.json({ ok: true, consulta: publica, historial: payload.historial, aclaraciones: payload.aclaraciones });
  } catch (error) {
    return consultaError(c, error, "consulta_get_failed");
  }
});

async function respuestaConsulta(
  phiSecret: string,
  result: {
    row: Parameters<typeof publicConsulta>[0];
    transcripcion: string;
    nota: NotaClinica;
    receta: RecetaPaciente;
    paciente: Parameters<typeof publicConsulta>[1];
    guardia_legal: Awaited<ReturnType<typeof publicConsulta>>["guardia_legal"];
  }
) {
  return {
    ok: true,
    consulta: await publicConsulta(result.row, result.paciente, phiSecret),
    transcripcion: result.transcripcion,
    nota: result.nota,
    receta: result.receta,
    paciente: result.paciente,
    idioma_detectado: result.receta.idioma,
    guardia_legal: result.guardia_legal,
  };
}

function consultaError(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, error: unknown, event: string) {
  if (isNom004Error(error)) {
    return c.json(
      {
        ok: false,
        code: error.code,
        detail: error.message,
        norma: NORMA_EXPEDIENTE,
        faltantes: error.faltantes,
        guia: error.guia,
        nota: error.nota ?? null,
      },
      error.status
    );
  }
  if (isAppError(error)) {
    return c.json({ ok: false, detail: error.message, code: error.code }, error.status);
  }
  console.error(
    JSON.stringify({
      event,
      path: c.req.path,
      message: error instanceof Error ? error.message : "unknown",
    })
  );
  return c.json({ ok: false, detail: "No se pudo procesar la consulta médica." }, 500);
}
