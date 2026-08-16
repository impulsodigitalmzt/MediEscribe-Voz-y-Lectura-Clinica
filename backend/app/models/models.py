"""
Database Models — SQLAlchemy ORM definitions for MedScribe.

Models:
- User: physicians, nurses, admins
- Encounter: clinical encounter sessions
- Transcript: raw transcription data per encounter
- ClinicalNote: AI-generated and physician-edited clinical notes
- NoteVersion: version history for every note edit
- AuditLog: append-only immutable audit trail
- ConsentRecord: consent tracking per encounter
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float,
    DateTime, ForeignKey, Enum, JSON, Index
)
from sqlalchemy.orm import DeclarativeBase, relationship
import enum


class Base(DeclarativeBase):
    pass


# --- Enums ---

class UserRole(str, enum.Enum):
    PHYSICIAN = "physician"
    NURSE = "nurse"
    ADMIN = "admin"
    SYSTEM = "system"


class EncounterStatus(str, enum.Enum):
    RECORDING = "recording"
    PAUSED = "paused"
    TRANSCRIBING = "transcribing"
    GENERATING_NOTE = "generating_note"
    PENDING_REVIEW = "pending_review"
    SIGNED_OFF = "signed_off"
    AMENDED = "amended"


class NoteStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    SIGNED_OFF = "signed_off"
    LOCKED = "locked"
    AMENDED = "amended"


# --- Models ---

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    credentials = Column(String(100), default="")  # e.g., "MD, FACP"
    specialty = Column(String(100), default="General Practice")
    institution = Column(String(255), default="")
    role = Column(Enum(UserRole, native_enum=False), default=UserRole.PHYSICIAN, nullable=False)
    preferred_language = Column(String(10), default="en")
    preferred_template = Column(String(50), default="general_practice")
    is_active = Column(Boolean, default=True)
    mfa_enabled = Column(Boolean, default=False)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    encounters = relationship("Encounter", back_populates="physician")


class Encounter(Base):
    __tablename__ = "encounters"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    encounter_id = Column(String(20), unique=True, nullable=False, index=True)  # ENC-XXXXXXXXXXXX
    physician_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    patient_name = Column(String(255), default="")
    patient_dob = Column(String(10), default="")  # Stored encrypted
    patient_mrn = Column(String(50), default="")  # Medical Record Number, encrypted
    status = Column(Enum(EncounterStatus, native_enum=False), default=EncounterStatus.RECORDING)
    specialty_template = Column(String(50), default="general_practice")
    encounter_type = Column(String(20), default="regular")  # regular, emergency, trauma
    spoken_language = Column(String(10), default="en")
    output_language = Column(String(10), default="en")
    duration_seconds = Column(Integer, default=0)
    consent_recorded = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    signed_off_at = Column(DateTime, nullable=True)

    physician = relationship("User", back_populates="encounters")
    transcripts = relationship("Transcript", back_populates="encounter", cascade="all, delete-orphan")
    clinical_note = relationship("ClinicalNote", back_populates="encounter", uselist=False, cascade="all, delete-orphan")
    consent_records = relationship("ConsentRecord", back_populates="encounter", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_encounters_physician_status", "physician_id", "status"),
    )


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    encounter_id = Column(String(36), ForeignKey("encounters.id"), nullable=False)
    sequence_number = Column(Integer, nullable=False)
    speaker_label = Column(String(50), default="unknown")  # "physician", "patient", "unknown"
    content = Column(Text, nullable=False)
    timestamp_start = Column(Float, default=0.0)
    timestamp_end = Column(Float, default=0.0)
    language_detected = Column(String(10), default="en")
    confidence = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    encounter = relationship("Encounter", back_populates="transcripts")

    __table_args__ = (
        Index("ix_transcripts_encounter_seq", "encounter_id", "sequence_number"),
    )


class ClinicalNote(Base):
    __tablename__ = "clinical_notes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    encounter_id = Column(String(36), ForeignKey("encounters.id"), unique=True, nullable=False)
    status = Column(Enum(NoteStatus, native_enum=False), default=NoteStatus.DRAFT)

    # Structured note sections (stored as JSON for flexibility)
    chief_complaint = Column(Text, default="")
    hpi = Column(Text, default="")  # History of Present Illness
    on_direct_questioning = Column(Text, default="")  # Targeted questions after HPI
    past_medical_history = Column(Text, default="")
    past_surgical_history = Column(Text, default="")  # Previous surgeries
    drug_history = Column(Text, default="")  # Detailed drug/substance history
    medications = Column(Text, default="")
    allergies = Column(Text, default="")
    family_history = Column(Text, default="")
    social_history = Column(Text, default="")
    nutritional_history = Column(Text, default="")
    immunization_history = Column(Text, default="")
    developmental_history = Column(Text, default="")  # Pediatrics/Neonatology
    gynecological_history = Column(Text, default="")  # OB/GYN
    obstetric_history = Column(Text, default="")  # OB/GYN
    review_of_systems = Column(JSON, default=dict)  # Organized by organ system
    physical_examination = Column(JSON, default=dict)  # Organized by system
    lab_investigations = Column(Text, default="")  # Lab results and orders
    imaging_investigations = Column(Text, default="")  # Imaging results and orders
    investigation_comments = Column(Text, default="")  # Clinician comments on results
    provisional_diagnosis = Column(Text, default="")  # Based on history alone
    differential_diagnosis = Column(Text, default="")  # Differential list
    final_diagnosis = Column(Text, default="")  # After investigations
    assessment = Column(Text, default="")
    plan = Column(Text, default="")
    recommended_plan = Column(Text, default="")  # AI-suggested evidence-based plan
    sbar_summary = Column(Text, default="")  # Situation-Background-Assessment-Recommendation
    primary_survey = Column(Text, default="")  # ABCDE for emergency/trauma
    secondary_survey = Column(Text, default="")  # Head-to-toe for emergency/trauma
    follow_up = Column(Text, default="")

    # Metadata
    missing_sections = Column(JSON, default=list)  # Sections with no data captured
    uncertain_fields = Column(JSON, default=list)  # Fields with low AI confidence
    ai_generated = Column(Boolean, default=True)
    ai_disclaimer = Column(String(500), default="This note was generated by AI and requires physician review before finalization.")
    current_version = Column(Integer, default=1)

    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    signed_off_at = Column(DateTime, nullable=True)
    signed_off_by = Column(String(36), nullable=True)

    encounter = relationship("Encounter", back_populates="clinical_note")
    versions = relationship("NoteVersion", back_populates="clinical_note", cascade="all, delete-orphan")


class NoteVersion(Base):
    __tablename__ = "note_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    note_id = Column(String(36), ForeignKey("clinical_notes.id"), nullable=False)
    version_number = Column(Integer, nullable=False)
    content_snapshot = Column(JSON, nullable=False)  # Full note content at this version
    change_description = Column(Text, default="")
    edited_by = Column(String(36), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    clinical_note = relationship("ClinicalNote", back_populates="versions")

    __table_args__ = (
        Index("ix_note_versions_note_version", "note_id", "version_number"),
    )


class AuditLog(Base):
    """
    Append-only immutable audit log.
    No user, including administrators, may modify or delete entries.
    """
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=True)  # Null for system events
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=False)  # "encounter", "note", "user", etc.
    resource_id = Column(String(36), nullable=True)
    details = Column(JSON, default=dict)  # Additional context (never contains PHI)
    ip_address = Column(String(45), default="")
    user_agent = Column(String(255), default="")
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        Index("ix_audit_user_action", "user_id", "action"),
        Index("ix_audit_resource", "resource_type", "resource_id"),
    )


class ConsentRecord(Base):
    """Consent tracking — every encounter requires consent before recording."""
    __tablename__ = "consent_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    encounter_id = Column(String(36), ForeignKey("encounters.id"), nullable=False)
    consent_type = Column(String(50), default="recording")  # recording, ai_processing, data_storage
    consented = Column(Boolean, nullable=False)
    consented_by = Column(String(255), default="")  # Who gave consent
    recorded_by = Column(String(36), nullable=False)  # User who recorded the consent
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    encounter = relationship("Encounter", back_populates="consent_records")
