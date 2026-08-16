import type { SupabaseClient } from "@supabase/supabase-js";
import { polishNote, polishedToNoteFields } from "./groq";
import { validateNoteSafety } from "./nlp";
import type { EncounterRow, NoteRow } from "./supabase";

export async function getTranscriptText(db: SupabaseClient, encounterId: string): Promise<string> {
  const { data, error } = await db
    .from("transcripts")
    .select("content, sequence_number")
    .eq("encounter_id", encounterId)
    .order("sequence_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.content)).join("\n").trim();
}

export async function nextSequence(db: SupabaseClient, encounterId: string): Promise<number> {
  const { data } = await db
    .from("transcripts")
    .select("sequence_number")
    .eq("encounter_id", encounterId)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sequence_number ?? 0) + 1;
}

export async function storeTranscript(
  db: SupabaseClient,
  encounterId: string,
  text: string,
  speaker = "unknown",
  language = "en",
  confidence = 1
) {
  const sequence = await nextSequence(db, encounterId);
  const { data, error } = await db
    .from("transcripts")
    .insert({
      encounter_id: encounterId,
      sequence_number: sequence,
      speaker_label: speaker,
      content: text,
      language_detected: language,
      confidence,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function generateAndStoreNote(
  env: Env,
  db: SupabaseClient,
  encounter: EncounterRow,
  transcriptText: string
): Promise<NoteRow> {
  const words = transcriptText.split(/\s+/);
  const clipped = words.length > 8000 ? words.slice(0, 8000).join(" ") : transcriptText;
  const polished = await polishNote(
    env,
    clipped,
    encounter.specialty_template,
    encounter.output_language,
    encounter.encounter_type
  );
  const safety = validateNoteSafety(polished, clipped);
  const fields = polishedToNoteFields(polished);
  if (!Array.isArray(fields.missing_sections) || (fields.missing_sections as string[]).length === 0) {
    fields.missing_sections = safety.missing_sections;
  }
  if (!Array.isArray(fields.uncertain_fields) || (fields.uncertain_fields as string[]).length === 0) {
    fields.uncertain_fields = safety.uncertain_fields;
  }

  const { data: existing } = await db
    .from("clinical_notes")
    .select("*")
    .eq("encounter_id", encounter.id)
    .maybeSingle();

  let note: NoteRow;
  if (existing) {
    const { data, error } = await db
      .from("clinical_notes")
      .update(fields)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Note update failed");
    note = data as NoteRow;
  } else {
    const { data, error } = await db
      .from("clinical_notes")
      .insert({ encounter_id: encounter.id, ...fields })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Note insert failed");
    note = data as NoteRow;
  }

  const now = new Date().toISOString();
  await db
    .from("encounters")
    .update({ status: "pending_review", updated_at: now })
    .eq("id", encounter.id);

  return note;
}
