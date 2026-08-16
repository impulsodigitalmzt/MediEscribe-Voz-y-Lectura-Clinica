export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  credentials: string;
  specialty: string;
  institution: string;
  role: string;
  preferred_language: string;
  preferred_template: string;
  whatsapp_phone: string | null;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
};

export type EncounterRow = {
  id: string;
  encounter_id: string;
  physician_id: string;
  patient_name: string;
  patient_dob: string;
  patient_mrn: string;
  status: string;
  specialty_template: string;
  encounter_type: string;
  spoken_language: string;
  output_language: string;
  duration_seconds: number;
  consent_recorded: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  signed_off_at: string | null;
};

export type TranscriptRow = {
  id: string;
  encounter_id: string;
  sequence_number: number;
  speaker_label: string;
  content: string;
  timestamp_start: number;
  timestamp_end: number;
  language_detected: string;
  confidence: number;
};

export type NoteRow = {
  id: string;
  encounter_id: string;
  status: string;
  chief_complaint: string;
  hpi: string;
  on_direct_questioning: string;
  past_medical_history: string;
  past_surgical_history: string;
  drug_history: string;
  medications: string;
  allergies: string;
  family_history: string;
  social_history: string;
  nutritional_history: string;
  immunization_history: string;
  developmental_history: string;
  gynecological_history: string;
  obstetric_history: string;
  review_of_systems: Record<string, unknown>;
  physical_examination: Record<string, unknown>;
  lab_investigations: string;
  imaging_investigations: string;
  investigation_comments: string;
  provisional_diagnosis: string;
  differential_diagnosis: string;
  final_diagnosis: string;
  assessment: string;
  plan: string;
  recommended_plan: string;
  sbar_summary: string;
  primary_survey: string;
  secondary_survey: string;
  follow_up: string;
  missing_sections: string[];
  uncertain_fields: string[];
  ai_generated: boolean;
  ai_disclaimer: string;
  current_version: number;
  generated_at: string;
  signed_off_at: string | null;
  signed_off_by: string | null;
};

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    credentials: user.credentials,
    specialty: user.specialty,
    institution: user.institution,
    role: user.role,
    preferred_language: user.preferred_language,
    preferred_template: user.preferred_template,
    whatsapp_phone: user.whatsapp_phone ?? "",
  };
}

export function publicEncounter(row: EncounterRow) {
  return {
    id: row.id,
    encounter_id: row.encounter_id,
    physician_id: row.physician_id,
    patient_name: "[ENCRYPTED]",
    status: row.status,
    specialty_template: row.specialty_template,
    spoken_language: row.spoken_language,
    output_language: row.output_language,
    duration_seconds: row.duration_seconds,
    consent_recorded: row.consent_recorded,
    created_at: row.created_at,
    updated_at: row.updated_at,
    signed_off_at: row.signed_off_at,
  };
}

export const NOTE_TEXT_FIELDS = [
  "chief_complaint",
  "hpi",
  "on_direct_questioning",
  "past_medical_history",
  "past_surgical_history",
  "drug_history",
  "medications",
  "allergies",
  "family_history",
  "social_history",
  "nutritional_history",
  "immunization_history",
  "developmental_history",
  "gynecological_history",
  "obstetric_history",
  "lab_investigations",
  "imaging_investigations",
  "investigation_comments",
  "provisional_diagnosis",
  "differential_diagnosis",
  "final_diagnosis",
  "assessment",
  "plan",
  "recommended_plan",
  "sbar_summary",
  "primary_survey",
  "secondary_survey",
  "follow_up",
] as const;

export const NOTE_JSON_FIELDS = ["review_of_systems", "physical_examination"] as const;

export const EDITABLE_SECTIONS = new Set<string>([...NOTE_TEXT_FIELDS, ...NOTE_JSON_FIELDS]);

export function publicNote(note: NoteRow) {
  return {
    id: note.id,
    encounter_id: note.encounter_id,
    status: note.status,
    chief_complaint: note.chief_complaint,
    hpi: note.hpi,
    on_direct_questioning: note.on_direct_questioning,
    past_medical_history: note.past_medical_history,
    past_surgical_history: note.past_surgical_history,
    drug_history: note.drug_history,
    medications: note.medications,
    allergies: note.allergies,
    family_history: note.family_history,
    social_history: note.social_history,
    nutritional_history: note.nutritional_history,
    immunization_history: note.immunization_history,
    developmental_history: note.developmental_history,
    gynecological_history: note.gynecological_history,
    obstetric_history: note.obstetric_history,
    review_of_systems: note.review_of_systems ?? {},
    physical_examination: note.physical_examination ?? {},
    lab_investigations: note.lab_investigations,
    imaging_investigations: note.imaging_investigations,
    investigation_comments: note.investigation_comments,
    provisional_diagnosis: note.provisional_diagnosis,
    differential_diagnosis: note.differential_diagnosis,
    final_diagnosis: note.final_diagnosis,
    assessment: note.assessment,
    plan: note.plan,
    recommended_plan: note.recommended_plan,
    sbar_summary: note.sbar_summary,
    primary_survey: note.primary_survey,
    secondary_survey: note.secondary_survey,
    follow_up: note.follow_up,
    missing_sections: note.missing_sections ?? [],
    uncertain_fields: note.uncertain_fields ?? [],
    ai_generated: note.ai_generated,
    ai_disclaimer: note.ai_disclaimer,
    current_version: note.current_version,
    generated_at: note.generated_at,
    signed_off_at: note.signed_off_at,
  };
}

export function noteSnapshot(note: NoteRow): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const field of NOTE_TEXT_FIELDS) snap[field] = note[field];
  snap.review_of_systems = note.review_of_systems;
  snap.physical_examination = note.physical_examination;
  snap.missing_sections = note.missing_sections;
  snap.uncertain_fields = note.uncertain_fields;
  return snap;
}
