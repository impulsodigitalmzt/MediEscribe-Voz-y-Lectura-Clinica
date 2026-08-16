import type { Sql } from "../db.js";
import { polishNote, polishedToNoteFields } from "./groq";
import { validateNoteSafety } from "./nlp";
import { getTranscriptText, storeTranscript, updateEncounter, upsertNote } from "./neon-store";
import type { EncounterRow, NoteRow } from "./models";

export { getTranscriptText, storeTranscript };

export async function generateAndStoreNote(
  env: Env,
  sql: Sql,
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

  const note = await upsertNote(sql, encounter.id, fields);
  await updateEncounter(sql, encounter.id, { status: "pending_review" });
  return note;
}
