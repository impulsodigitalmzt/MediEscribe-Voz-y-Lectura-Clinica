"""
API Schemas — Pydantic models for request/response validation.

All user inputs are validated, sanitized, and bounded.
Error states are handled gracefully with user-facing messages.
"""

from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import re


# --- Auth Schemas ---

class UserRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    credentials: str = Field(default="", max_length=100)
    specialty: str = Field(default="General Practice", max_length=100)
    institution: str = Field(default="", max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit")
        if not re.search(r"[^A-Za-z0-9]", v):
            raise ValueError("Password must contain at least one special character")
        return v

    @field_validator("full_name")
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        return v.strip()


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class UserProfileResponse(BaseModel):
    id: str
    email: str
    full_name: str
    credentials: str
    specialty: str
    institution: str
    role: str
    preferred_language: str
    preferred_template: str

    class Config:
        from_attributes = True


# --- Encounter Schemas ---

class EncounterCreateRequest(BaseModel):
    patient_name: str = Field(default="", max_length=255)
    patient_dob: str = Field(default="", max_length=10)
    patient_mrn: str = Field(default="", max_length=50)
    specialty_template: str = Field(default="general_practice", max_length=50)
    spoken_language: str = Field(default="en", max_length=10)
    output_language: str = Field(default="en", max_length=10)


class EncounterResponse(BaseModel):
    id: str
    encounter_id: str
    physician_id: str
    patient_name: str
    status: str
    specialty_template: str
    spoken_language: str
    output_language: str
    duration_seconds: int
    consent_recorded: bool
    created_at: datetime
    updated_at: datetime
    signed_off_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EncounterListResponse(BaseModel):
    encounters: List[EncounterResponse]
    total: int
    page: int
    page_size: int


# --- Transcript Schemas ---

class TranscriptSegment(BaseModel):
    speaker_label: str = Field(default="unknown", max_length=50)
    content: str = Field(max_length=10000)
    timestamp_start: float = 0.0
    timestamp_end: float = 0.0
    language_detected: str = Field(default="en", max_length=10)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class TranscriptResponse(BaseModel):
    segments: List[TranscriptSegment]
    encounter_id: str


# --- Clinical Note Schemas ---

class ClinicalNoteResponse(BaseModel):
    id: str
    encounter_id: str
    status: str
    chief_complaint: str
    hpi: str
    on_direct_questioning: str = ""
    past_medical_history: str
    past_surgical_history: str = ""
    drug_history: str = ""
    medications: str
    allergies: str
    family_history: str
    social_history: str
    nutritional_history: str = ""
    immunization_history: str = ""
    developmental_history: str = ""
    gynecological_history: str = ""
    obstetric_history: str = ""
    review_of_systems: Dict[str, Any]
    physical_examination: Dict[str, Any]
    lab_investigations: str = ""
    imaging_investigations: str = ""
    investigation_comments: str = ""
    provisional_diagnosis: str = ""
    differential_diagnosis: str = ""
    final_diagnosis: str = ""
    assessment: str
    plan: str
    recommended_plan: str = ""
    sbar_summary: str = ""
    primary_survey: str = ""
    secondary_survey: str = ""
    follow_up: str
    missing_sections: List[str]
    uncertain_fields: List[str]
    ai_generated: bool
    ai_disclaimer: str
    current_version: int
    generated_at: datetime
    signed_off_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NoteEditRequest(BaseModel):
    """Edit a specific section of a clinical note."""
    section: str = Field(description="Section name to edit (e.g., 'chief_complaint', 'hpi')")
    content: str = Field(max_length=50000)
    change_description: str = Field(default="Manual edit", max_length=500)

    @field_validator("section")
    @classmethod
    def validate_section(cls, v: str) -> str:
        valid_sections = {
            "chief_complaint", "hpi", "on_direct_questioning",
            "past_medical_history", "past_surgical_history", "drug_history", "medications",
            "allergies", "family_history", "social_history",
            "nutritional_history", "immunization_history",
            "developmental_history", "gynecological_history", "obstetric_history",
            "review_of_systems", "physical_examination",
            "lab_investigations", "imaging_investigations", "investigation_comments",
            "provisional_diagnosis", "differential_diagnosis", "final_diagnosis",
            "assessment", "plan", "recommended_plan", "sbar_summary", "primary_survey", "secondary_survey", "follow_up"
        }
        if v not in valid_sections:
            raise ValueError(f"Invalid section: {v}. Must be one of: {valid_sections}")
        return v


class NoteSignOffRequest(BaseModel):
    confirmation: bool = Field(description="Must be True to sign off")


# --- Consent Schemas ---

class ConsentRequest(BaseModel):
    consent_type: str = Field(default="recording", max_length=50)
    consented: bool
    consented_by: str = Field(default="", max_length=255)


# --- Template Schemas ---

class SpecialtyTemplate(BaseModel):
    id: str
    name: str
    specialty: str
    sections: List[str]
    section_order: List[str]
    custom_fields: Dict[str, Any] = {}
    description: str = ""


# --- Settings Schemas ---

class UserSettingsUpdate(BaseModel):
    preferred_language: Optional[str] = Field(None, max_length=10)
    preferred_template: Optional[str] = Field(None, max_length=50)
    full_name: Optional[str] = Field(None, max_length=255)
    credentials: Optional[str] = Field(None, max_length=100)
    specialty: Optional[str] = Field(None, max_length=100)
    institution: Optional[str] = Field(None, max_length=255)


# --- Error Schemas ---

class ErrorResponse(BaseModel):
    detail: str
    error_code: Optional[str] = None
