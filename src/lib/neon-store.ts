import { createSql, type Sql } from "../db.js";
import { ensureExpedienteSchema } from "./expediente-schema";
import {
  NOTE_JSON_FIELDS,
  NOTE_TEXT_FIELDS,
  type EncounterRow,
  type NoteRow,
  type TranscriptRow,
  type UserRow,
} from "./models";

export type AuditEntry = {
  user_id?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_UPDATE_COLUMNS = new Set<string>([
  ...NOTE_TEXT_FIELDS,
  ...NOTE_JSON_FIELDS,
  "missing_sections",
  "uncertain_fields",
  "current_version",
  "status",
  "signed_off_at",
  "signed_off_by",
  "ai_generated",
  "ai_disclaimer",
]);

export async function withNeon<T>(env: Env, fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sql = createSql(env.DATABASE_URL);
  try {
    await ensureExpedienteSchema(sql);
    return await fn(sql);
  } finally {
    await sql.end().catch(() => undefined);
  }
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function asUserRow(row: Record<string, unknown>): UserRow {
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    full_name: String(row.full_name),
    credentials: String(row.credentials ?? ""),
    specialty: String(row.specialty ?? "General Practice"),
    institution: String(row.institution ?? ""),
    role: String(row.role ?? "physician"),
    preferred_language: String(row.preferred_language ?? "es"),
    preferred_template: String(row.preferred_template ?? "general_practice"),
    whatsapp_phone: row.whatsapp_phone == null ? null : String(row.whatsapp_phone),
    is_active: Boolean(row.is_active),
    failed_login_attempts: Number(row.failed_login_attempts ?? 0),
    locked_until: iso(row.locked_until),
  };
}

export function asEncounterRow(row: Record<string, unknown>): EncounterRow {
  return {
    id: String(row.id),
    encounter_id: String(row.encounter_id),
    physician_id: String(row.physician_id),
    patient_name: String(row.patient_name ?? ""),
    patient_dob: String(row.patient_dob ?? ""),
    patient_mrn: String(row.patient_mrn ?? ""),
    status: String(row.status),
    specialty_template: String(row.specialty_template ?? "general_practice"),
    encounter_type: String(row.encounter_type ?? "regular"),
    spoken_language: String(row.spoken_language ?? "es"),
    output_language: String(row.output_language ?? "es"),
    duration_seconds: Number(row.duration_seconds ?? 0),
    consent_recorded: Boolean(row.consent_recorded),
    source: String(row.source ?? "web"),
    created_at: iso(row.created_at) ?? new Date().toISOString(),
    updated_at: iso(row.updated_at) ?? new Date().toISOString(),
    signed_off_at: iso(row.signed_off_at),
  };
}

export function asNoteRow(row: Record<string, unknown>): NoteRow {
  return {
    id: String(row.id),
    encounter_id: String(row.encounter_id),
    status: String(row.status ?? "draft"),
    chief_complaint: String(row.chief_complaint ?? ""),
    hpi: String(row.hpi ?? ""),
    on_direct_questioning: String(row.on_direct_questioning ?? ""),
    past_medical_history: String(row.past_medical_history ?? ""),
    past_surgical_history: String(row.past_surgical_history ?? ""),
    drug_history: String(row.drug_history ?? ""),
    medications: String(row.medications ?? ""),
    allergies: String(row.allergies ?? ""),
    family_history: String(row.family_history ?? ""),
    social_history: String(row.social_history ?? ""),
    nutritional_history: String(row.nutritional_history ?? ""),
    immunization_history: String(row.immunization_history ?? ""),
    developmental_history: String(row.developmental_history ?? ""),
    gynecological_history: String(row.gynecological_history ?? ""),
    obstetric_history: String(row.obstetric_history ?? ""),
    review_of_systems: asObject(row.review_of_systems),
    physical_examination: asObject(row.physical_examination),
    lab_investigations: String(row.lab_investigations ?? ""),
    imaging_investigations: String(row.imaging_investigations ?? ""),
    investigation_comments: String(row.investigation_comments ?? ""),
    provisional_diagnosis: String(row.provisional_diagnosis ?? ""),
    differential_diagnosis: String(row.differential_diagnosis ?? ""),
    final_diagnosis: String(row.final_diagnosis ?? ""),
    assessment: String(row.assessment ?? ""),
    plan: String(row.plan ?? ""),
    recommended_plan: String(row.recommended_plan ?? ""),
    sbar_summary: String(row.sbar_summary ?? ""),
    primary_survey: String(row.primary_survey ?? ""),
    secondary_survey: String(row.secondary_survey ?? ""),
    follow_up: String(row.follow_up ?? ""),
    missing_sections: asStringArray(row.missing_sections),
    uncertain_fields: asStringArray(row.uncertain_fields),
    ai_generated: row.ai_generated !== false,
    ai_disclaimer: String(row.ai_disclaimer ?? ""),
    current_version: Number(row.current_version ?? 1),
    generated_at: iso(row.generated_at) ?? new Date().toISOString(),
    signed_off_at: iso(row.signed_off_at),
    signed_off_by: row.signed_off_by == null ? null : String(row.signed_off_by),
  };
}

export async function writeAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  try {
    const recursoId = entry.resource_id && UUID_RE.test(entry.resource_id) ? entry.resource_id : null;
    await sql`
      INSERT INTO audit_logs (
        user_id, actor_id, accion, recurso, recurso_id, entidad_afectada_id,
        details, ip, user_agent, "timestamp"
      ) VALUES (
        ${entry.user_id ?? null},
        ${entry.user_id ?? null},
        ${entry.action},
        ${entry.resource_type},
        ${recursoId},
        ${recursoId},
        ${sql.json(entry.details ?? {})},
        ${entry.ip_address ?? ""},
        ${entry.user_agent ?? ""},
        NOW()
      )
    `;
  } catch (error) {
    console.error(JSON.stringify({
      event: "audit_write_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
}

export async function findUserByEmail(sql: Sql, email: string): Promise<UserRow | null> {
  const rows = await sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  return rows[0] ? asUserRow(rows[0] as Record<string, unknown>) : null;
}

export async function findUserById(sql: Sql, id: string): Promise<UserRow | null> {
  const rows = await sql`SELECT * FROM users WHERE id = ${id}::uuid LIMIT 1`;
  return rows[0] ? asUserRow(rows[0] as Record<string, unknown>) : null;
}

export async function findUserByWhatsapp(sql: Sql, phone: string): Promise<UserRow | null> {
  const rows = await sql`
    SELECT * FROM users
    WHERE whatsapp_phone = ${phone} AND is_active = true
    LIMIT 1
  `;
  return rows[0] ? asUserRow(rows[0] as Record<string, unknown>) : null;
}

export async function insertUser(
  sql: Sql,
  input: {
    email: string;
    password_hash: string;
    full_name: string;
    credentials?: string;
    specialty?: string;
    institution?: string;
    role?: string;
    preferred_language?: string;
    preferred_template?: string;
    is_active?: boolean;
  }
): Promise<UserRow> {
  const rows = await sql`
    INSERT INTO users (
      email, password_hash, full_name, credentials, specialty, institution,
      role, preferred_language, preferred_template, is_active
    ) VALUES (
      ${input.email},
      ${input.password_hash},
      ${input.full_name},
      ${input.credentials ?? ""},
      ${input.specialty ?? "General Practice"},
      ${input.institution ?? ""},
      ${input.role ?? "physician"},
      ${input.preferred_language ?? "es"},
      ${input.preferred_template ?? "general_practice"},
      ${input.is_active ?? true}
    )
    RETURNING *
  `;
  if (!rows[0]) throw new Error("User insert failed");
  return asUserRow(rows[0] as Record<string, unknown>);
}

export async function updateUser(
  sql: Sql,
  id: string,
  patch: Record<string, unknown>
): Promise<UserRow | null> {
  const allowed = new Set([
    "password_hash",
    "full_name",
    "credentials",
    "specialty",
    "institution",
    "preferred_language",
    "preferred_template",
    "whatsapp_phone",
    "is_active",
    "failed_login_attempts",
    "locked_until",
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return findUserById(sql, id);
  const setSql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);
  const rows = await sql.query(
    `UPDATE users SET ${setSql}, updated_at = NOW() WHERE id = $${entries.length + 1}::uuid RETURNING *`,
    values
  );
  return rows[0] ? asUserRow(rows[0]) : null;
}

export async function findEncounter(sql: Sql, encounterId: string, userId: string): Promise<EncounterRow | null> {
  const rows = await sql`
    SELECT * FROM encounters
    WHERE physician_id = ${userId}::uuid
      AND (id::text = ${encounterId} OR encounter_id = ${encounterId})
    LIMIT 1
  `;
  return rows[0] ? asEncounterRow(rows[0] as Record<string, unknown>) : null;
}

export async function insertEncounter(
  sql: Sql,
  input: {
    encounter_id: string;
    physician_id: string;
    patient_name?: string;
    patient_dob?: string;
    patient_mrn?: string;
    specialty_template?: string;
    encounter_type?: string;
    spoken_language?: string;
    output_language?: string;
    status?: string;
    source?: string;
    consent_recorded?: boolean;
  }
): Promise<EncounterRow> {
  const rows = await sql`
    INSERT INTO encounters (
      encounter_id, physician_id, patient_name, patient_dob, patient_mrn,
      specialty_template, encounter_type, spoken_language, output_language,
      status, source, consent_recorded
    ) VALUES (
      ${input.encounter_id},
      ${input.physician_id}::uuid,
      ${input.patient_name ?? ""},
      ${input.patient_dob ?? ""},
      ${input.patient_mrn ?? ""},
      ${input.specialty_template ?? "general_practice"},
      ${input.encounter_type ?? "regular"},
      ${input.spoken_language ?? "es"},
      ${input.output_language ?? "es"},
      ${input.status ?? "recording"},
      ${input.source ?? "web"},
      ${input.consent_recorded ?? false}
    )
    RETURNING *
  `;
  if (!rows[0]) throw new Error("Encounter insert failed");
  return asEncounterRow(rows[0] as Record<string, unknown>);
}

export async function listEncounters(
  sql: Sql,
  userId: string,
  page: number,
  pageSize: number,
  statusFilter?: string
): Promise<{ rows: EncounterRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const countRows = statusFilter
    ? await sql`SELECT count(*)::int AS total FROM encounters WHERE physician_id = ${userId}::uuid AND status = ${statusFilter}`
    : await sql`SELECT count(*)::int AS total FROM encounters WHERE physician_id = ${userId}::uuid`;
  const total = Number((countRows[0] as { total?: number } | undefined)?.total ?? 0);
  const rows = statusFilter
    ? await sql`
        SELECT * FROM encounters
        WHERE physician_id = ${userId}::uuid AND status = ${statusFilter}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `
    : await sql`
        SELECT * FROM encounters
        WHERE physician_id = ${userId}::uuid
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
  return {
    rows: rows.map((row) => asEncounterRow(row as Record<string, unknown>)),
    total,
  };
}

export async function deleteEncounter(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM encounters WHERE id = ${id}::uuid`;
}

export async function updateEncounter(
  sql: Sql,
  id: string,
  patch: {
    status?: string;
    consent_recorded?: boolean;
    duration_seconds?: number;
    signed_off_at?: string | null;
  }
): Promise<void> {
  await sql`
    UPDATE encounters SET
      status = COALESCE(${patch.status ?? null}, status),
      consent_recorded = COALESCE(${patch.consent_recorded ?? null}, consent_recorded),
      duration_seconds = COALESCE(${patch.duration_seconds ?? null}, duration_seconds),
      signed_off_at = COALESCE(${patch.signed_off_at ?? null}, signed_off_at),
      updated_at = NOW()
    WHERE id = ${id}::uuid
  `;
}

export async function insertConsent(
  sql: Sql,
  input: {
    encounter_id: string;
    consent_type: string;
    consented: boolean;
    consented_by: string;
    recorded_by: string;
  }
): Promise<{ id: string; consented: boolean }> {
  const rows = await sql`
    INSERT INTO consent_records (encounter_id, consent_type, consented, consented_by, recorded_by)
    VALUES (
      ${input.encounter_id}::uuid,
      ${input.consent_type},
      ${input.consented},
      ${input.consented_by},
      ${input.recorded_by}::uuid
    )
    RETURNING id, consented
  `;
  const row = rows[0] as { id: string; consented: boolean } | undefined;
  if (!row) throw new Error("Consent insert failed");
  return { id: String(row.id), consented: Boolean(row.consented) };
}

export async function listTranscripts(sql: Sql, encounterId: string): Promise<TranscriptRow[]> {
  const rows = await sql`
    SELECT * FROM transcripts
    WHERE encounter_id = ${encounterId}::uuid
    ORDER BY sequence_number ASC
  `;
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id),
      encounter_id: String(item.encounter_id),
      sequence_number: Number(item.sequence_number),
      speaker_label: String(item.speaker_label ?? "unknown"),
      content: String(item.content ?? ""),
      timestamp_start: Number(item.timestamp_start ?? 0),
      timestamp_end: Number(item.timestamp_end ?? 0),
      language_detected: String(item.language_detected ?? ""),
      confidence: Number(item.confidence ?? 0),
    };
  });
}

export async function getTranscriptText(sql: Sql, encounterId: string): Promise<string> {
  const rows = await listTranscripts(sql, encounterId);
  return rows.map((row) => row.content).join("\n").trim();
}

export async function storeTranscript(
  sql: Sql,
  encounterId: string,
  text: string,
  speaker = "unknown",
  language = "es",
  confidence = 1
): Promise<TranscriptRow> {
  const last = await sql`
    SELECT sequence_number FROM transcripts
    WHERE encounter_id = ${encounterId}::uuid
    ORDER BY sequence_number DESC
    LIMIT 1
  `;
  const sequence = Number((last[0] as { sequence_number?: number } | undefined)?.sequence_number ?? 0) + 1;
  const rows = await sql`
    INSERT INTO transcripts (
      encounter_id, sequence_number, speaker_label, content, language_detected, confidence
    ) VALUES (
      ${encounterId}::uuid, ${sequence}, ${speaker}, ${text}, ${language}, ${confidence}
    )
    RETURNING *
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Transcript insert failed");
  return {
    id: String(row.id),
    encounter_id: String(row.encounter_id),
    sequence_number: Number(row.sequence_number),
    speaker_label: String(row.speaker_label),
    content: String(row.content),
    timestamp_start: Number(row.timestamp_start ?? 0),
    timestamp_end: Number(row.timestamp_end ?? 0),
    language_detected: String(row.language_detected ?? language),
    confidence: Number(row.confidence ?? confidence),
  };
}

export async function getNoteByEncounter(sql: Sql, encounterId: string): Promise<NoteRow | null> {
  const rows = await sql`SELECT * FROM clinical_notes WHERE encounter_id = ${encounterId}::uuid LIMIT 1`;
  return rows[0] ? asNoteRow(rows[0] as Record<string, unknown>) : null;
}

export async function upsertNote(sql: Sql, encounterId: string, fields: Record<string, unknown>): Promise<NoteRow> {
  const existing = await getNoteByEncounter(sql, encounterId);
  if (existing) {
    const updated = await updateClinicalNote(sql, existing.id, fields);
    if (!updated) throw new Error("Note update failed");
    return updated;
  }
  const rows = await sql`
    INSERT INTO clinical_notes (
      encounter_id, chief_complaint, hpi, on_direct_questioning, past_medical_history,
      past_surgical_history, drug_history, medications, allergies, family_history,
      social_history, nutritional_history, immunization_history, developmental_history,
      gynecological_history, obstetric_history, review_of_systems, physical_examination,
      lab_investigations, imaging_investigations, investigation_comments,
      provisional_diagnosis, differential_diagnosis, final_diagnosis, assessment, plan,
      recommended_plan, sbar_summary, primary_survey, secondary_survey, follow_up,
      missing_sections, uncertain_fields
    ) VALUES (
      ${encounterId}::uuid,
      ${String(fields.chief_complaint ?? "")},
      ${String(fields.hpi ?? "")},
      ${String(fields.on_direct_questioning ?? "")},
      ${String(fields.past_medical_history ?? "")},
      ${String(fields.past_surgical_history ?? "")},
      ${String(fields.drug_history ?? "")},
      ${String(fields.medications ?? "")},
      ${String(fields.allergies ?? "")},
      ${String(fields.family_history ?? "")},
      ${String(fields.social_history ?? "")},
      ${String(fields.nutritional_history ?? "")},
      ${String(fields.immunization_history ?? "")},
      ${String(fields.developmental_history ?? "")},
      ${String(fields.gynecological_history ?? "")},
      ${String(fields.obstetric_history ?? "")},
      ${sql.json(fields.review_of_systems ?? {})},
      ${sql.json(fields.physical_examination ?? {})},
      ${String(fields.lab_investigations ?? "")},
      ${String(fields.imaging_investigations ?? "")},
      ${String(fields.investigation_comments ?? "")},
      ${String(fields.provisional_diagnosis ?? "")},
      ${String(fields.differential_diagnosis ?? "")},
      ${String(fields.final_diagnosis ?? "")},
      ${String(fields.assessment ?? "")},
      ${String(fields.plan ?? "")},
      ${String(fields.recommended_plan ?? "")},
      ${String(fields.sbar_summary ?? "")},
      ${String(fields.primary_survey ?? "")},
      ${String(fields.secondary_survey ?? "")},
      ${String(fields.follow_up ?? "")},
      ${sql.json(fields.missing_sections ?? [])},
      ${sql.json(fields.uncertain_fields ?? [])}
    )
    RETURNING *
  `;
  if (!rows[0]) throw new Error("Note insert failed");
  return asNoteRow(rows[0] as Record<string, unknown>);
}

export async function updateClinicalNote(
  sql: Sql,
  id: string,
  updates: Record<string, unknown>
): Promise<NoteRow | null> {
  const entries = Object.entries(updates).filter(([key]) => NOTE_UPDATE_COLUMNS.has(key));
  if (!entries.length) return getNoteById(sql, id);
  const setSql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);
  const rows = await sql.query(
    `UPDATE clinical_notes SET ${setSql} WHERE id = $${entries.length + 1}::uuid RETURNING *`,
    values
  );
  return rows[0] ? asNoteRow(rows[0]) : null;
}

async function getNoteById(sql: Sql, id: string): Promise<NoteRow | null> {
  const rows = await sql`SELECT * FROM clinical_notes WHERE id = ${id}::uuid LIMIT 1`;
  return rows[0] ? asNoteRow(rows[0] as Record<string, unknown>) : null;
}

export async function insertNoteVersion(
  sql: Sql,
  input: {
    note_id: string;
    version_number: number;
    content_snapshot: Record<string, unknown>;
    change_description: string;
    edited_by: string;
  }
): Promise<void> {
  await sql`
    INSERT INTO note_versions (note_id, version_number, content_snapshot, change_description, edited_by)
    VALUES (
      ${input.note_id}::uuid,
      ${input.version_number},
      ${sql.json(input.content_snapshot)},
      ${input.change_description},
      ${input.edited_by}::uuid
    )
  `;
}

export async function listNoteVersions(sql: Sql, noteId: string) {
  return sql`
    SELECT version_number, change_description, edited_by, created_at
    FROM note_versions
    WHERE note_id = ${noteId}::uuid
    ORDER BY version_number DESC
  `;
}

export async function findWhatsappEvent(sql: Sql, messageId: string): Promise<boolean> {
  const rows = await sql`SELECT id FROM whatsapp_events WHERE wa_message_id = ${messageId} LIMIT 1`;
  return Boolean(rows[0]);
}

export async function insertWhatsappEvent(
  sql: Sql,
  input: { wa_message_id: string; from_phone: string; message_type: string; status: string }
): Promise<void> {
  await sql`
    INSERT INTO whatsapp_events (wa_message_id, from_phone, message_type, status)
    VALUES (${input.wa_message_id}, ${input.from_phone}, ${input.message_type}, ${input.status})
  `;
}

export async function completeWhatsappEvent(sql: Sql, messageId: string, encounterId: string): Promise<void> {
  await sql`
    UPDATE whatsapp_events
    SET encounter_id = ${encounterId}::uuid, status = 'completed'
    WHERE wa_message_id = ${messageId}
  `;
}
