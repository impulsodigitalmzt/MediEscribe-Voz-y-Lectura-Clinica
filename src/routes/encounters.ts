import { Hono } from "hono";
import { requireAuth, requireRoles, type AuthContext } from "../lib/auth";
import {
  createSupabase,
  EDITABLE_SECTIONS,
  NOTE_JSON_FIELDS,
  noteSnapshot,
  publicEncounter,
  publicNote,
  writeAudit,
  type EncounterRow,
  type NoteRow,
} from "../lib/supabase";
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

async function loadEncounter(
  env: Env,
  encounterId: string,
  userId: string
): Promise<EncounterRow | null> {
  const db = createSupabase(env);
  const { data } = await db
    .from("encounters")
    .select("*")
    .or(`id.eq.${encounterId},encounter_id.eq.${encounterId}`)
    .eq("physician_id", userId)
    .maybeSingle();
  return (data as EncounterRow | null) ?? null;
}

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

  const db = createSupabase(c.env);
  const { data, error } = await db
    .from("encounters")
    .insert({
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
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error(JSON.stringify({ event: "encounter_create_failed", error: error?.message }));
    return jsonError(c, 500, "Could not create encounter.");
  }

  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "encounter.created",
    resource_type: "encounter",
    resource_id: data.id,
    ip_address: clientIp(c),
    user_agent: userAgent(c),
  });
  return c.json(publicEncounter(data as EncounterRow), 201);
});

encounterRoutes.get("/", async (c) => {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query("page_size") ?? "20", 10)));
  const statusFilter = c.req.query("status_filter");
  const db = createSupabase(c.env);

  let query = db
    .from("encounters")
    .select("*", { count: "exact" })
    .eq("physician_id", c.get("auth").user_id)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, count, error } = await query;
  if (error) return jsonError(c, 500, "Could not list encounters.");

  return c.json({
    encounters: (data ?? []).map((row) => publicEncounter(row as EncounterRow)),
    total: count ?? 0,
    page,
    page_size: pageSize,
  });
});

encounterRoutes.get("/:id", async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  return c.json(publicEncounter(encounter));
});

encounterRoutes.delete("/:id", requireRoles(["physician", "admin"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "encounter.deleted",
    resource_type: "encounter",
    resource_id: encounter.id,
    ip_address: clientIp(c),
  });
  const { error } = await db.from("encounters").delete().eq("id", encounter.id);
  if (error) return jsonError(c, 500, "Could not delete encounter.");
  return c.json({ status: "deleted" });
});

async function transition(c: Parameters<typeof jsonError>[0], nextStatus: string) {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { error } = await db
    .from("encounters")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", encounter.id);
  if (error) return jsonError(c, 400, "Invalid status transition.");
  return c.json({ status: nextStatus });
}

encounterRoutes.post("/:id/pause", requireRoles(["physician"]), (c) => transition(c, "paused"));
encounterRoutes.post("/:id/resume", requireRoles(["physician"]), (c) => transition(c, "recording"));
encounterRoutes.post("/:id/stop", requireRoles(["physician"]), (c) => transition(c, "transcribing"));

encounterRoutes.post("/:id/consent", requireRoles(["physician", "nurse"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const body = await c.req.json<{ consent_type?: string; consented?: boolean; consented_by?: string }>();
  const db = createSupabase(c.env);
  const { data, error } = await db
    .from("consent_records")
    .insert({
      encounter_id: encounter.id,
      consent_type: body.consent_type ?? "recording",
      consented: Boolean(body.consented),
      consented_by: body.consented_by ?? "",
      recorded_by: c.get("auth").user_id,
    })
    .select("id, consented")
    .single();
  if (error || !data) return jsonError(c, 500, "Could not record consent.");
  if (body.consented) {
    await db.from("encounters").update({ consent_recorded: true }).eq("id", encounter.id);
  }
  return c.json({ consent_id: data.id, consented: data.consented });
});

encounterRoutes.get("/:id/transcript", async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { data, error } = await db
    .from("transcripts")
    .select("*")
    .eq("encounter_id", encounter.id)
    .order("sequence_number", { ascending: true });
  if (error) return jsonError(c, 500, "Could not load transcript.");
  return c.json({
    encounter_id: c.req.param("id") ?? "",
    segments: (data ?? []).map((s) => ({
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
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");

  try {
    const body = await parseMultipartBody(c);
    const audio = extractAudioFromBody(body);
    const whisper = await transcribeAudio(c.env, audio.blob, audio.filename);
    const db = createSupabase(c.env);
    await storeTranscript(db, encounter.id, whisper.text, "whisper", whisper.language || "auto", 1);
    await db.from("encounters").update({ status: "transcribing" }).eq("id", encounter.id);
    await writeAudit(db, {
      user_id: c.get("auth").user_id,
      action: "encounter.audio_transcribed",
      resource_type: "encounter",
      resource_id: encounter.id,
      details: { filename: audio.filename, bytes: audio.size, language: whisper.language },
      ip_address: clientIp(c),
    });
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
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const body = await c.req.json<{ text?: string }>();
  const text = (body.text ?? "").trim();
  if (!text) return jsonError(c, 400, "Transcript text cannot be empty.");
  const db = createSupabase(c.env);
  await storeTranscript(db, encounter.id, text, "manual_input", encounter.spoken_language, 1);
  await db.from("encounters").update({ status: "transcribing" }).eq("id", encounter.id);
  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "encounter.manual_transcript",
    resource_type: "encounter",
    resource_id: encounter.id,
    details: { status: "manual_input" },
    ip_address: clientIp(c),
  });
  return c.json({ status: "transcript_received" });
});

encounterRoutes.post("/:id/transcript/manual", requireRoles(["physician"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const body = await c.req.json<{ content?: string; speaker_label?: string }>();
  const content = (body.content ?? "").trim();
  if (!content) return jsonError(c, 400, "Content cannot be empty.");
  const db = createSupabase(c.env);
  const segment = await storeTranscript(
    db,
    encounter.id,
    content,
    body.speaker_label ?? "unknown",
    encounter.spoken_language,
    1
  );
  return c.json({ id: segment.id, sequence: segment.sequence_number });
});

encounterRoutes.post("/:id/generate-note", requireRoles(["physician"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  if (!encounter.consent_recorded) {
    return jsonError(c, 400, "Recording consent must be captured before generating notes.");
  }
  const transcript = await getTranscriptText(db, encounter.id);
  if (!transcript) {
    return jsonError(c, 400, "No transcript data available. Please record an encounter first.");
  }

  try {
    const note = await generateAndStoreNote(c.env, db, encounter, transcript);
    await writeAudit(db, {
      user_id: c.get("auth").user_id,
      action: "note.generated",
      resource_type: "note",
      resource_id: note.id,
      details: { template: encounter.specialty_template },
      ip_address: clientIp(c),
    });
    return c.json(publicNote(note));
  } catch (err) {
    console.error(JSON.stringify({ event: "note_generation_failed", error: String(err) }));
    return jsonError(c, 500, "Note generation failed.");
  }
});

encounterRoutes.get("/:id/note", async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { data } = await db.from("clinical_notes").select("*").eq("encounter_id", encounter.id).maybeSingle();
  if (!data) return jsonError(c, 404, "No note found for this encounter.");
  return c.json(publicNote(data as NoteRow));
});

encounterRoutes.patch("/:id/note", requireRoles(["physician"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
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

  const db = createSupabase(c.env);
  const { data: note } = await db.from("clinical_notes").select("*").eq("encounter_id", encounter.id).maybeSingle();
  if (!note) return jsonError(c, 404, "No note found.");
  if (note.status === "locked") return jsonError(c, 400, "This note is locked. Create an addendum instead.");

  const updates: Record<string, unknown> = {};
  if (body.sections && typeof body.sections === "object") {
    for (const [section, raw] of Object.entries(body.sections)) {
      if (!EDITABLE_SECTIONS.has(section)) continue;
      if ((NOTE_JSON_FIELDS as readonly string[]).includes(section)) {
        if (typeof raw === "string") {
          try {
            updates[section] = JSON.parse(raw);
          } catch {
            return jsonError(c, 400, `Section ${section} must be valid JSON.`);
          }
        } else {
          updates[section] = raw;
        }
      } else {
        updates[section] = raw ?? "";
      }
    }
  } else {
    if (!body.section || !EDITABLE_SECTIONS.has(body.section)) {
      return jsonError(c, 400, "Invalid section.");
    }
    let content: unknown = body.content ?? "";
    if ((NOTE_JSON_FIELDS as readonly string[]).includes(body.section)) {
      try {
        content = typeof body.content === "string" ? JSON.parse(body.content) : body.content;
      } catch {
        return jsonError(c, 400, "Section content must be valid JSON.");
      }
    }
    updates[body.section] = content;
  }

  if (Object.keys(updates).length === 0) return jsonError(c, 400, "No editable fields were provided.");

  await db.from("note_versions").insert({
    note_id: note.id,
    version_number: note.current_version,
    content_snapshot: noteSnapshot(note as NoteRow),
    change_description: body.change_description ?? "Manual edit",
    edited_by: c.get("auth").user_id,
  });

  const { data: updated, error } = await db
    .from("clinical_notes")
    .update({ ...updates, current_version: note.current_version + 1 })
    .eq("id", note.id)
    .select("*")
    .single();
  if (error || !updated) return jsonError(c, 500, "Could not edit note.");

  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "note.edited",
    resource_type: "note",
    resource_id: note.id,
    details: { sections: Object.keys(updates), version: note.current_version + 1 },
    ip_address: clientIp(c),
  });
  return c.json(publicNote(updated as NoteRow));
});

encounterRoutes.post("/:id/sign-off", requireRoles(["physician"]), async (c) => {
  const body = (await c.req.json<{ confirmation?: boolean }>().catch(() => ({ confirmation: false }))) as {
    confirmation?: boolean;
  };
  if (!body.confirmation) {
    return jsonError(c, 400, "Sign-off requires explicit confirmation (confirmation=true).");
  }
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { data: note } = await db.from("clinical_notes").select("*").eq("encounter_id", encounter.id).maybeSingle();
  if (!note) return jsonError(c, 404, "No note found.");
  if (note.status === "locked") return jsonError(c, 400, "Note is already signed and locked.");

  const now = new Date().toISOString();
  await db.from("note_versions").insert({
    note_id: note.id,
    version_number: note.current_version,
    content_snapshot: noteSnapshot(note as NoteRow),
    change_description: "Physician sign-off — note locked",
    edited_by: c.get("auth").user_id,
  });
  await db
    .from("clinical_notes")
    .update({ status: "locked", signed_off_at: now, signed_off_by: c.get("auth").user_id })
    .eq("id", note.id);
  await db
    .from("encounters")
    .update({ status: "signed_off", signed_off_at: now, updated_at: now })
    .eq("id", encounter.id);
  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "note.signed_off",
    resource_type: "note",
    resource_id: note.id,
    details: { note_status: "locked" },
    ip_address: clientIp(c),
  });
  return c.json({ status: "signed_off", signed_off_at: now });
});

encounterRoutes.get("/:id/export/pdf", requireRoles(["physician", "admin"]), async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { data: note } = await db.from("clinical_notes").select("*").eq("encounter_id", encounter.id).maybeSingle();
  if (!note) return jsonError(c, 404, "No note found.");

  const user = c.get("auth").user;
  const patientName = await decryptText(c.env.SECRET_KEY, encounter.patient_name);
  const pdf = await generateClinicalPdf({
    note: note as unknown as Record<string, unknown>,
    encounter: {
      encounter_id: encounter.encounter_id,
      date: encounter.created_at.slice(0, 10),
      specialty_template: encounter.specialty_template,
      duration_seconds: encounter.duration_seconds,
    },
    physician: {
      full_name: user.full_name,
      credentials: user.credentials,
      specialty: user.specialty,
      institution: user.institution,
    },
    patientLabel: patientName ? "On file (encrypted at rest)" : "Not recorded",
  });

  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "pdf.exported",
    resource_type: "note",
    resource_id: note.id,
    details: { export_format: "pdf" },
    ip_address: clientIp(c),
  });

  const filename = `MedScribe_${encounter.encounter_id}_${encounter.created_at.slice(0, 10).replace(/-/g, "")}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

encounterRoutes.get("/:id/note/versions", async (c) => {
  const encounter = await loadEncounter(c.env, c.req.param("id") ?? "", c.get("auth").user_id);
  if (!encounter) return jsonError(c, 404, "Encounter not found.");
  const db = createSupabase(c.env);
  const { data: note } = await db.from("clinical_notes").select("*").eq("encounter_id", encounter.id).maybeSingle();
  if (!note) return jsonError(c, 404, "No note found.");
  const { data: versions } = await db
    .from("note_versions")
    .select("version_number, change_description, edited_by, created_at")
    .eq("note_id", note.id)
    .order("version_number", { ascending: false });
  return c.json({
    current_version: note.current_version,
    versions: versions ?? [],
  });
});
