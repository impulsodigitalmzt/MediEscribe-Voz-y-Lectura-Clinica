"""
Unit Tests — Core service classes.

Tests security manager, clinical NLP, safety validator, template manager.
Mocks external dependencies.
"""

import pytest
import jwt as pyjwt
from datetime import datetime, timezone
from app.core.security import SecurityManager
from app.services.clinical_nlp import ClinicalNLPService
from app.services.safety_validator import SafetyValidator
from app.services.template_manager import TemplateManager


class TestSecurityManager:
    """Tests for SecurityManager."""

    def setup_method(self):
        self.sm = SecurityManager()

    def test_hash_password_returns_bcrypt_hash(self):
        hashed = self.sm.hash_password("TestPassword123!")
        assert hashed.startswith("$2b$")
        assert len(hashed) > 50

    def test_verify_correct_password(self):
        password = "MySecureP@ss1"
        hashed = self.sm.hash_password(password)
        assert self.sm.verify_password(password, hashed) is True

    def test_verify_wrong_password(self):
        hashed = self.sm.hash_password("CorrectPassword1!")
        assert self.sm.verify_password("WrongPassword1!", hashed) is False

    def test_create_access_token_valid(self):
        token = self.sm.create_access_token("user-123", "physician")
        assert isinstance(token, str)
        payload = self.sm.validate_token(token, expected_type="access")
        assert payload["sub"] == "user-123"
        assert payload["role"] == "physician"
        assert payload["type"] == "access"

    def test_create_refresh_token_valid(self):
        token = self.sm.create_refresh_token("user-123")
        payload = self.sm.validate_token(token, expected_type="refresh")
        assert payload["sub"] == "user-123"
        assert payload["type"] == "refresh"

    def test_validate_token_wrong_type_fails(self):
        token = self.sm.create_access_token("user-123", "physician")
        with pytest.raises(pyjwt.InvalidTokenError):
            self.sm.validate_token(token, expected_type="refresh")

    def test_encrypt_decrypt_roundtrip(self):
        plaintext = "Patient John Doe, DOB 1990-01-15"
        encrypted = self.sm.encrypt_data(plaintext)
        assert encrypted != plaintext
        decrypted = self.sm.decrypt_data(encrypted)
        assert decrypted == plaintext

    def test_generate_encounter_id_format(self):
        eid = self.sm.generate_encounter_id()
        assert eid.startswith("ENC-")
        assert len(eid) == 16

    def test_generate_session_id_format(self):
        sid = self.sm.generate_session_id()
        assert sid.startswith("SES-")


class TestClinicalNLPService:
    """Tests for ClinicalNLPService."""

    def setup_method(self):
        self.nlp = ClinicalNLPService()

    def test_filter_non_clinical_content(self):
        sentences = [
            "The patient reports chest pain for two days.",
            "How's the weather outside today?",
            "Blood pressure is 140/90.",
            "Did you find parking okay?",
        ]
        filtered = self.nlp._filter_clinical_content(sentences)
        assert len(filtered) == 2
        assert "chest pain" in filtered[0]
        assert "Blood pressure" in filtered[1]

    def test_extract_symptoms(self):
        sentences = [
            "I've been having severe headache for three days.",
            "There's also some nausea in the morning.",
            "My cat is doing well though.",
        ]
        symptoms = self.nlp._extract_symptoms(sentences)
        assert len(symptoms) == 2

    def test_extract_medications(self):
        sentences = [
            "Currently taking metformin 500mg twice daily.",
            "She went to the store yesterday.",
        ]
        meds = self.nlp._extract_medications(sentences)
        assert len(meds) == 1
        assert "500mg" in meds[0]

    def test_extract_chief_complaint(self):
        sentences = [
            "Good morning doctor.",
            "I came here because of persistent back pain.",
            "It started last week.",
        ]
        cc = self.nlp._extract_chief_complaint(sentences)
        assert "back pain" in cc.lower()

    def test_extract_clinical_entities_full(self):
        transcript = """
        [Physician]: What brings you in today?
        [Patient]: I've been having chest pain for the past two days.
        It gets worse when I breathe deeply.
        [Physician]: Any shortness of breath?
        [Patient]: Yes, especially when climbing stairs.
        [Physician]: Are you taking any medications?
        [Patient]: I'm on aspirin 81mg daily and lisinopril 10mg.
        [Physician]: Any allergies?
        [Patient]: I'm allergic to penicillin, I get a rash.
        [Physician]: Let me examine you. Heart sounds are regular, no murmur.
        Lungs clear to auscultation bilaterally.
        [Physician]: I suspect this could be costochondritis,
        but we should rule out cardiac causes.
        I'll order an ECG and chest X-ray.
        Follow up in one week.
        """
        entities = self.nlp.extract_clinical_entities(transcript)
        assert entities["chief_complaint"] != ""
        assert len(entities["symptoms"]) > 0
        assert len(entities["medications"]) > 0

    def test_map_to_note_sections_identifies_missing(self):
        entities = {
            "chief_complaint": "chest pain",
            "symptoms": ["chest pain"],
            "medications": [],
            "allergies": [],
            "procedures": [],
            "vitals": [],
            "diagnoses": [],
            "family_history_mentions": [],
            "social_history_mentions": [],
            "exam_findings": [],
            "plan_items": [],
            "follow_up": [],
            "raw_clinical_text": "chest pain",
            "filtered_count": 0,
            "clinical_count": 1,
        }
        result = self.nlp.map_to_note_sections(entities)
        assert "medications" in result["missing_sections"]
        assert "allergies" in result["missing_sections"]


class TestSafetyValidator:
    """Tests for SafetyValidator."""

    def setup_method(self):
        self.validator = SafetyValidator()

    def test_valid_note_passes(self):
        note = {
            "chief_complaint": "Chest pain",
            "hpi": "Patient presents with two-day history of chest pain.",
            "past_medical_history": "Hypertension",
            "medications": "Lisinopril 10mg daily",
            "allergies": "Penicillin — rash",
            "family_history": "Father had MI at age 55",
            "social_history": "Non-smoker",
            "review_of_systems": {"cardiovascular": "Chest pain, no palpitations"},
            "physical_examination": {"heart": "RRR, no murmurs"},
            "assessment": "Possible costochondritis, rule out ACS",
            "plan": "ECG, troponin levels, chest X-ray",
            "follow_up": "Return in one week or sooner if symptoms worsen",
            "missing_sections": [],
            "uncertain_fields": [],
        }
        transcript = "chest pain lisinopril penicillin rash father MI costochondritis ECG"
        result = self.validator.validate(note, transcript, {})
        assert result.is_safe is True

    def test_diagnostic_overreach_flagged(self):
        note = {
            "chief_complaint": "Headache",
            "hpi": "",
            "past_medical_history": "",
            "medications": "",
            "allergies": "",
            "family_history": "",
            "social_history": "",
            "review_of_systems": {},
            "physical_examination": {},
            "assessment": "I recommend starting a course of antibiotics immediately.",
            "plan": "The patient needs to undergo an MRI.",
            "follow_up": "",
            "missing_sections": [],
            "uncertain_fields": [],
        }
        result = self.validator.validate(note, "headache", {})
        assert len(result.red_flags) > 0

    def test_fabricated_results_detected(self):
        note = {
            "chief_complaint": "Cough",
            "hpi": "",
            "past_medical_history": "",
            "medications": "",
            "allergies": "",
            "family_history": "",
            "social_history": "",
            "review_of_systems": {},
            "physical_examination": {},
            "assessment": "Lab results show elevated WBC count.",
            "plan": "",
            "follow_up": "",
            "missing_sections": [],
            "uncertain_fields": [],
        }
        result = self.validator.validate(note, "cough only", {})
        assert len(result.hallucination_flags) > 0 or len(result.errors) > 0


class TestTemplateManager:
    """Tests for TemplateManager."""

    def setup_method(self):
        self.tm = TemplateManager()

    def test_list_templates_returns_all(self):
        templates = self.tm.list_templates()
        assert len(templates) == 8
        names = [t["id"] for t in templates]
        assert "general_practice" in names
        assert "emergency_medicine" in names
        assert "pediatrics" in names
        assert "surgery" in names
        assert "psychiatry" in names
        assert "cardiology" in names
        assert "oncology" in names
        assert "telemedicine" in names

    def test_get_template_returns_sections(self):
        template = self.tm.get_template("general_practice")
        assert template is not None
        assert "chief_complaint" in template["sections"]
        assert len(template["section_order"]) > 0

    def test_invalid_template_returns_none(self):
        assert self.tm.get_template("nonexistent") is None

    def test_validate_template_id(self):
        assert self.tm.validate_template_id("general_practice") is True
        assert self.tm.validate_template_id("fake") is False

    def test_pediatrics_has_growth_parameters(self):
        template = self.tm.get_template("pediatrics")
        assert "growth_parameters" in template["sections"]
        assert "weight_percentile" in template["custom_fields"]

    def test_emergency_has_triage(self):
        template = self.tm.get_template("emergency_medicine")
        assert "triage_priority" in template["sections"]
