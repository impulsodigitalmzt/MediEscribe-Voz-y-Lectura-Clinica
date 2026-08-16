-- MedScribe schema for Supabase (PostgreSQL).
-- Run in the Supabase SQL Editor. The Worker uses the service role key
-- and bypasses RLS; policies below lock down anon/authenticated access.

create extension if not exists "pgcrypto";

-- --- Users ---
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text not null,
  credentials text not null default '',
  specialty text not null default 'General Practice',
  institution text not null default '',
  role text not null default 'physician'
    check (role in ('physician', 'nurse', 'admin', 'system')),
  preferred_language text not null default 'en',
  preferred_template text not null default 'general_practice',
  whatsapp_phone text unique,
  is_active boolean not null default true,
  mfa_enabled boolean not null default false,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_users_email on public.users (email);
create index if not exists ix_users_whatsapp_phone on public.users (whatsapp_phone);

-- --- Encounters ---
create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  encounter_id text unique not null,
  physician_id uuid not null references public.users (id) on delete cascade,
  patient_name text not null default '',
  patient_dob text not null default '',
  patient_mrn text not null default '',
  status text not null default 'recording'
    check (status in (
      'recording', 'paused', 'transcribing', 'generating_note',
      'pending_review', 'signed_off', 'amended'
    )),
  specialty_template text not null default 'general_practice',
  encounter_type text not null default 'regular',
  spoken_language text not null default 'en',
  output_language text not null default 'en',
  duration_seconds integer not null default 0,
  consent_recorded boolean not null default false,
  source text not null default 'web'
    check (source in ('web', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  signed_off_at timestamptz
);

create index if not exists ix_encounters_physician_status
  on public.encounters (physician_id, status);
create index if not exists ix_encounters_encounter_id
  on public.encounters (encounter_id);

-- --- Transcripts ---
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  sequence_number integer not null,
  speaker_label text not null default 'unknown',
  content text not null,
  timestamp_start double precision not null default 0,
  timestamp_end double precision not null default 0,
  language_detected text not null default 'en',
  confidence double precision not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ix_transcripts_encounter_seq
  on public.transcripts (encounter_id, sequence_number);

-- --- Clinical notes ---
create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid unique not null references public.encounters (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'signed_off', 'locked', 'amended')),
  chief_complaint text not null default '',
  hpi text not null default '',
  on_direct_questioning text not null default '',
  past_medical_history text not null default '',
  past_surgical_history text not null default '',
  drug_history text not null default '',
  medications text not null default '',
  allergies text not null default '',
  family_history text not null default '',
  social_history text not null default '',
  nutritional_history text not null default '',
  immunization_history text not null default '',
  developmental_history text not null default '',
  gynecological_history text not null default '',
  obstetric_history text not null default '',
  review_of_systems jsonb not null default '{}'::jsonb,
  physical_examination jsonb not null default '{}'::jsonb,
  lab_investigations text not null default '',
  imaging_investigations text not null default '',
  investigation_comments text not null default '',
  provisional_diagnosis text not null default '',
  differential_diagnosis text not null default '',
  final_diagnosis text not null default '',
  assessment text not null default '',
  plan text not null default '',
  recommended_plan text not null default '',
  sbar_summary text not null default '',
  primary_survey text not null default '',
  secondary_survey text not null default '',
  follow_up text not null default '',
  missing_sections jsonb not null default '[]'::jsonb,
  uncertain_fields jsonb not null default '[]'::jsonb,
  ai_generated boolean not null default true,
  ai_disclaimer text not null default
    'This note was generated by AI and requires physician review before finalization.',
  current_version integer not null default 1,
  generated_at timestamptz not null default now(),
  signed_off_at timestamptz,
  signed_off_by uuid
);

-- --- Note versions ---
create table if not exists public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.clinical_notes (id) on delete cascade,
  version_number integer not null,
  content_snapshot jsonb not null,
  change_description text not null default '',
  edited_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists ix_note_versions_note_version
  on public.note_versions (note_id, version_number);

-- --- Audit logs (append-only) ---
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  ip_address text not null default '',
  user_agent text not null default '',
  timestamp timestamptz not null default now()
);

create index if not exists ix_audit_user_action on public.audit_logs (user_id, action);
create index if not exists ix_audit_resource on public.audit_logs (resource_type, resource_id);
create index if not exists ix_audit_timestamp on public.audit_logs (timestamp);

-- --- Consent ---
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  consent_type text not null default 'recording',
  consented boolean not null,
  consented_by text not null default '',
  recorded_by uuid not null,
  timestamp timestamptz not null default now()
);

-- --- WhatsApp inbound log (no PHI in details beyond phone + message id) ---
create table if not exists public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text unique,
  from_phone text not null,
  message_type text not null default 'text',
  encounter_id uuid references public.encounters (id) on delete set null,
  status text not null default 'received',
  created_at timestamptz not null default now()
);

-- Block client-side access; only the Worker service role may read/write.
alter table public.users enable row level security;
alter table public.encounters enable row level security;
alter table public.transcripts enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.note_versions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.consent_records enable row level security;
alter table public.whatsapp_events enable row level security;

-- Prevent UPDATE/DELETE on audit logs even for privileged roles via API.
revoke update, delete on public.audit_logs from anon, authenticated, service_role;
grant insert, select on public.audit_logs to service_role;
