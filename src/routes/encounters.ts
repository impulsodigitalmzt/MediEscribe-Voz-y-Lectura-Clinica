import { Hono } from "hono";
import { requireAuth, requireRoles, type AuthContext } from "../lib/auth";
import {
  EDITABLE_SECTIONS,
  NOTE_JSON_FIELDS,
  noteSnapshot,
  publicEncounter,
  publicNote,
} from "../lib/models";
import {
  deleteEncounter,
  findEncounter,
  getNoteByEncounter,
  insertConsent,
  insertEncounter,
  insertNoteVersion,
  listEncounters,
  listNoteVersions,
  listTranscripts,
  updateClinicalNote,
  updateEncounter,
  withNeon,
  writeAudit,
} from "../lib/neon-store";
import { decryptText, encryptText, generateEncounterCode } from "../lib/security";
import { generateClinicalPdf } from "../lib/pdf";
import { generateAndStoreNote, getTranscriptText, storeTranscript } from "../lib/notes";
import { extractAudioFromBody, parseMultipartBody } from "../lib/audio";
import { isAppError } from "../lib/errors";
import { transcribeAudio } from "../lib/groq";
import { clientIp, jsonError, userAgent } from "../lib/http";
import { isValidTemplate } from "../lib/templates";

type AppEnv = { Bindings: Env; Variables: { auth: AuthContext } };

export const encounterRoutes = new Hono<AppEnv>();

encounterRoutes.use("*", requireAuth);

encounterRoutes.post("/", requireRoles(["physician", "admin"]), async (c) => {
  const body = (await c.req.json<{
    patient_name?: string;
    patient_dob?: string;
    patient_mrn?: string;
    specialty_template?: string;
    encounter_type?: string;
    spoken_language?: string;
    output_language?: string;
  }>().catch(() => ({}))) as {
    patient_name?: string;
    patient_dob?: string;
    patient_mrn?: string;
    specialty_template?: string;
    encounter_type?: string;
    spoken_language?: string;
    output_language?: string;
  };

  const template = body.specialty_template || "general_practice";
  if (!isValidTemplate(template)) return jsonError(c, 400, "Invalid specialty template.");

  try {
    const data = await withNeon(c.env, async (sql) => {
      const created = await insertEncounter(sql, {
        encounter_id: generateEncounterCode(),
        physician_id: c.get("auth").user_id,
        patient_name: await encryptText(c.env.SECRET_KEY, body.patient_name ?? ""),
        patient_dob: await encryptText(c.env.SECRET_KEY, body.patient_dob ?? ""),
        patient_mrn: await encryptText(c.env.SECRET_KEY, body.patient_mrn ?? ""),
        specialty_template: template,
        encounter_type: body.encounter_type || "regular",
        spoken_language: body.spoken_language || "en",
        output_language: body.output_language || "en",
        status: "recording",
        source: "web",
      });
      await writeAudit(sql, {
        user_id: c.get("auth").user_id,
        action: "encounter.created",
        resource_type: "encounter",
        resource_id: created.id,
        ip_address: clientIp(c),
        user_agent: userAgent(c),
      });
      return created;
    });
    return c.json(publicEncounter(data), 201);
  } catch (error) {
    console.error(JSON.stringify({
      event: "encounter_create_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return jsonError(c, 500, "Could not create encounter.");
  }
});

encounterRoutes.get("/", async (c) => {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query("page_size") ?? "20", 10)));
  const statusFilter = c.req.query("status_filter");
  const { rows, total } = await withNeon(c.env, (sql) =>
    listEncounters(sql, c.get("auth").user_id, page, pageSize, statusFilter || undefined)
  );
  return c.json({
    encounters: rows.map((row) => publicEncounter(row)),
    total,
    page,
    page_size: pageSize,
  });
});

encounterRoutes.get("/:id", async (c) => {
  const encounter = await withNeon(c.env, (sql) =>
    findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id)
  );
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  return c.json(publicEncounter(encounter));
});

encounterRoutes.delete("/:id", requireRoles(["physician", "admin"]), async (c) => {
  const result = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    await writeAudit(sql, {
      user_id: c.get("auth").user_id,
      action: "encounter.deleted",
      resource_type: "encounter",
      resource_id: encounter.id,
      ip_address: clientIp(c),
    });
    await deleteEncounter(sql, encounter.id);
    return encounter;
  });
  if (!result) return jsonError(c, 404, "Encounter not found.");
  return c.json({ status: "deleted" });
});

async function transition(c: Parameters<typeof jsonError>[0], nextStatus: string) {
  const ok = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return false;
    await updateEncounter(sql, encounter.id, { status: nextStatus });
    return true;
  });
  if (!ok) return jsonError(c, 404, "Encounter not found.");
  return c.json({ status: nextStatus });
}

encounterRoutes.post("/:id/pause", requireRoles(["physician"]), (c) => transition(c, "paused"));
encounterRoutes.post("/:id/resume", requireRoles(["physician"]), (c) => transition(c, "recording"));
encounterRoutes.post("/:id/stop", requireRoles(["physician"]), (c) => transition(c, "transcribing"));

encounterRoutes.post("/:id/consent", requireRoles(["physician", "nurse"]), async (c) => {
  const body = await c.req.json<{ consent_type?: string; consented?: boolean; consented_by?: string }>();
  const data = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    const consent = await insertConsent(sql, {
      encounter_id: encounter.id,
      consent_type: body.consent_type ?? "recording",
      consented: Boolean(body.consented),
      consented_by: body.consented_by ?? "",
      recorded_by: c.get("auth").user_id,
    });
    if (body.consented) {
      await updateEncounter(sql, encounter.id, { consent_recorded: true });
    }
    return consent;
  });
  if (!data) return jsonError(c, 404, "Encounter not found.");
  return c.json({ consent_id: data.id, consented: data.consented });
});

encounterRoutes.get("/:id/transcript", async (c) => {
  const payload = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    const segments = await listTranscripts(sql, encounter.id);
    return { encounter, segments };
  });
  if (!payload) return jsonError(c, 404, "Encounter not found.");
  return c.json({
    encounter_id: c.req.param("id") ?? "",
    segments: payload.segments.map((s) => ({
      sequence: s.sequence_number,
      speaker: s.speaker_label,
      content: s.content,
      timestamp_start: s.timestamp_start,
      timestamp_end: s.timestamp_end,
      language: s.language_detected,
      confidence: s.confidence,
    })),
  });
});

encounterRoutes.post("/:id/audio", requireRoles(["physician"]), async (c) => {
  try {
    const body = await parseMultipartBody(c);
    const audio = extractAudioFromBody(body);
    const whisper = await transcribeAudio(c.env, audio.blob, audio.filename);
    const ok = await withNeon(c.env, async (sql) => {
      const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
      if (!encounter) return false;
      await storeTranscript(sql, encounter.id, whisper.text, "whisper", whisper.language || "auto", 1);
      await updateEncounter(sql, encounter.id, { status: "transcribing" });
      await writeAudit(sql, {
        user_id: c.get("auth").user_id,
        action: "encounter.audio_transcribed",
        resource_type: "encounter",
        resource_id: encounter.id,
        details: { filename: audio.filename, bytes: audio.size, language: whisper.language },
        ip_address: clientIp(c),
      });
      return true;
    });
    if (!ok) return jsonError(c, 404, "Encounter not found.");
    return c.json({
      status: "transcript_received",
      text: whisper.text,
      characters: whisper.text.length,
      language: whisper.language,
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(c, error.status, error.message);
    console.error(JSON.stringify({ event: "encounter_audio_failed", error: String(error) }));
    return jsonError(c, 500, "Could not transcribe encounter audio.");
  }
});

encounterRoutes.post("/:id/manual-transcript", requireRoles(["physician"]), async (c) => {
  const body = await c.req.json<{ text?: string }>();
  const text = (body.text ?? "").trim();
  if (!text) return jsonError(c, 400, "Transcript text cannot be empty.");
  const ok = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return false;
    await storeTranscript(sql, encounter.id, text, "manual_input", encounter.spoken_language, 1);
    await updateEncounter(sql, encounter.id, { status: "transcribing" });
    await writeAudit(sql, {
      user_id: c.get("auth").user_id,
      action: "encounter.manual_transcript",
      resource_type: "encounter",
      resource_id: encounter.id,
      details: { status: "manual_input" },
      ip_address: clientIp(c),
    });
    return true;
  });
  if (!ok) return jsonError(c, 404, "Encounter not found.");
  return c.json({ status: "transcript_received" });
});

encounterRoutes.post("/:id/transcript/manual", requireRoles(["physician"]), async (c) => {
  const body = await c.req.json<{ content?: string; speaker_label?: string }>();
  const content = (body.content ?? "").trim();
  if (!content) return jsonError(c, 400, "Content cannot be empty.");
  const segment = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    return storeTranscript(
      sql,
      encounter.id,
      content,
      body.speaker_label ?? "unknown",
      encounter.spoken_language,
      1
    );
  });
  if (!segment) return jsonError(c, 404, "Encounter not found.");
  return c.json({ id: segment.id, sequence: segment.sequence_number });
});

encounterRoutes.post("/:id/generate-note", requireRoles(["physician"]), async (c) => {
  try {
    const note = await withNeon(c.env, async (sql) => {
      const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
      if (!encounter) return { error: "missing" as const };
      if (!encounter.consent_recorded) return { error: "consent" as const };
      const transcript = await getTranscriptText(sql, encounter.id);
      if (!transcript) return { error: "transcript" as const };
      const generated = await generateAndStoreNote(c.env, sql, encounter, transcript);
      await writeAudit(sql, {
        user_id: c.get("auth").user_id,
        action: "note.generated",
        resource_type: "note",
        resource_id: generated.id,
        details: { template: encounter.specialty_template },
        ip_address: clientIp(c),
      });
      return { note: generated };
    });
    if ("error" in note) {
      if (note.error === "missing") return jsonError(c, 404, "Encounter not found.");
      if (note.error === "consent") {
        return jsonError(c, 400, "Recording consent must be captured before generating notes.");
      }
      return jsonError(c, 400, "No transcript data available. Please record an encounter first.");
    }
    return c.json(publicNote(note.note));
  } catch (err) {
    console.error(JSON.stringify({ event: "note_generation_failed", error: String(err) }));
    return jsonError(c, 500, "Note generation failed.");
  }
});

encounterRoutes.get("/:id/note", async (c) => {
  const note = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return { error: "missing" as const };
    const data = await getNoteByEncounter(sql, encounter.id);
    if (!data) return { error: "note" as const };
    return { note: data };
  });
  if ("error" in note) {
    if (note.error === "missing") return jsonError(c, 404, "Encounter not found.");
    return jsonError(c, 404, "No note found for this encounter.");
  }
  return c.json(publicNote(note.note));
});

encounterRoutes.patch("/:id/note", requireRoles(["physician"]), async (c) => {
  const body = (await c.req.json<{
    section?: string;
    content?: string;
    change_description?: string;
    sections?: Record<string, unknown>;
  }>().catch(() => ({}))) as {
    section?: string;
    content?: string;
    change_description?: string;
    sections?: Record<string, unknown>;
  };

  const result = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return { error: "missing" as const };
    const note = await getNoteByEncounter(sql, encounter.id);
    if (!note) return { error: "note" as const };
    if (note.status === "locked") return { error: "locked" as const };

    const updates: Record<string, unknown> = {};
    if (body.sections && typeof body.sections === "object") {
      for (const [section, raw] of Object.entries(body.sections)) {
        if (!EDITABLE_SECTIONS.has(section)) continue;
        if ((NOTE_JSON_FIELDS as readonly string[]).includes(section)) {
          if (typeof raw === "string") {
            try {
              updates[section] = JSON.parse(raw);
            } catch {
              return { error: "json" as const, section };
            }
          } else {
            updates[section] = raw;
          }
        } else {
          updates[section] = raw ?? "";
        }
      }
    } else {
      if (!body.section || !EDITABLE_SECTIONS.has(body.section)) return { error: "section" as const };
      let content: unknown = body.content ?? "";
      if ((NOTE_JSON_FIELDS as readonly string[]).includes(body.section)) {
        try {
          content = typeof body.content === "string" ? JSON.parse(body.content) : body.content;
        } catch {
          return { error: "json" as const, section: body.section };
        }
      }
      updates[body.section] = content;
    }

    if (Object.keys(updates).length === 0) return { error: "empty" as const };

    await insertNoteVersion(sql, {
      note_id: note.id,
      version_number: note.current_version,
      content_snapshot: noteSnapshot(note),
      change_description: body.change_description ?? "Manual edit",
      edited_by: c.get("auth").user_id,
    });
    const updated = await updateClinicalNote(sql, note.id, {
      ...updates,
      current_version: note.current_version + 1,
    });
    if (!updated) return { error: "save" as const };
    await writeAudit(sql, {
      user_id: c.get("auth").user_id,
      action: "note.edited",
      resource_type: "note",
      resource_id: note.id,
      details: { sections: Object.keys(updates), version: note.current_version + 1 },
      ip_address: clientIp(c),
    });
    return { note: updated };
  });

  if ("error" in result) {
    if (result.error === "missing") return jsonError(c, 404, "Encounter not found.");
    if (result.error === "note") return jsonError(c, 404, "No note found.");
    if (result.error === "locked") return jsonError(c, 400, "This note is locked. Create an addendum instead.");
    if (result.error === "json") return jsonError(c, 400, `Section ${result.section} must be valid JSON.`);
    if (result.error === "section") return jsonError(c, 400, "Invalid section.");
    if (result.error === "empty") return jsonError(c, 400, "No editable fields were provided.");
    return jsonError(c, 500, "Could not edit note.");
  }
  return c.json(publicNote(result.note));
});

encounterRoutes.post("/:id/sign-off", requireRoles(["physician"]), async (c) => {
  const body = (await c.req.json<{ confirmation?: boolean }>().catch(() => ({ confirmation: false }))) as {
    confirmation?: boolean;
  };
  if (!body.confirmation) {
    return jsonError(c, 400, "Sign-off requires explicit confirmation (confirmation=true).");
  }
  const now = new Date().toISOString();
  const result = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return { error: "missing" as const };
    const note = await getNoteByEncounter(sql, encounter.id);
    if (!note) return { error: "note" as const };
    if (note.status === "locked") return { error: "locked" as const };
    await insertNoteVersion(sql, {
      note_id: note.id,
      version_number: note.current_version,
      content_snapshot: noteSnapshot(note),
      change_description: "Physician sign-off — note locked",
      edited_by: c.get("auth").user_id,
    });
    await updateClinicalNote(sql, note.id, {
      status: "locked",
      signed_off_at: now,
      signed_off_by: c.get("auth").user_id,
    });
    await updateEncounter(sql, encounter.id, { status: "signed_off", signed_off_at: now });
    await writeAudit(sql, {
      user_id: c.get("auth").user_id,
      action: "note.signed_off",
      resource_type: "note",
      resource_id: note.id,
      details: { note_status: "locked" },
      ip_address: clientIp(c),
    });
    return { ok: true as const };
  });
  if ("error" in result) {
    if (result.error === "missing") return jsonError(c, 404, "Encounter not found.");
    if (result.error === "note") return jsonError(c, 404, "No note found.");
    return jsonError(c, 400, "Note is already signed and locked.");
  }
  return c.json({ status: "signed_off", signed_off_at: now });
});

encounterRoutes.get("/:id/export/pdf", requireRoles(["physician", "admin"]), async (c) => {
  const payload = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    const note = await getNoteByEncounter(sql, encounter.id);
    if (!note) return { encounter, note: null };
    await writeAudit(sql, {
      user_id: c.get("auth").user_id,
      action: "pdf.exported",
      resource_type: "note",
      resource_id: note.id,
      details: { export_format: "pdf" },
      ip_address: clientIp(c),
    });
    return { encounter, note };
  });
  if (!payload) return jsonError(c, 404, "Encounter not found.");
  if (!payload.note) return jsonError(c, 404, "No note found.");

  const user = c.get("auth").user;
  const patientName = await decryptText(c.env.SECRET_KEY, payload.encounter.patient_name);
  const pdf = await generateClinicalPdf({
    note: payload.note as unknown as Record<string, unknown>,
    encounter: {
      encounter_id: payload.encounter.encounter_id,
      date: payload.encounter.created_at.slice(0, 10),
      specialty_template: payload.encounter.specialty_template,
      duration_seconds: payload.encounter.duration_seconds,
    },
    physician: {
      full_name: user.full_name,
      credentials: user.credentials,
      specialty: user.specialty,
      institution: user.institution,
    },
    patientLabel: patientName ? "On file (encrypted at rest)" : "Not recorded",
  });

  const filename = `MedScribe_${payload.encounter.encounter_id}_${payload.encounter.created_at.slice(0, 10).replace(/-/g, "")}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

encounterRoutes.get("/:id/note/versions", async (c) => {
  const payload = await withNeon(c.env, async (sql) => {
    const encounter = await findEncounter(sql, c.req.param("id") ?? "", c.get("auth").user_id);
    if (!encounter) return null;
    const note = await getNoteByEncounter(sql, encounter.id);
    if (!note) return { note: null, versions: [] };
    const versions = await listNoteVersions(sql, note.id);
    return { note, versions };
  });
  if (!payload) return jsonError(c, 404, "Encounter not found.");
  if (!payload.note) return jsonError(c, 404, "No note found.");
  return c.json({
    current_version: payload.note.current_version,
    versions: payload.versions,
  });
});
