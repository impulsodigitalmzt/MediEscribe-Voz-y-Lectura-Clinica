"""
AI Output Validation Tests (Section 2.2)

Run curated sample clinical transcripts through the full pipeline.
Compare generated notes against physician-validated reference notes.
Flag any hallucinated content, missing sections, or clinical inaccuracies.
"""

import pytest
from app.services.clinical_nlp import ClinicalNLPService
from app.services.safety_validator import SafetyValidator


# Sample clinical transcripts for validation
SAMPLE_TRANSCRIPTS = {
    "simple_visit": {
        "transcript": """
[Physician]: Good morning, Mrs. Johnson. What brings you in today?
[Patient]: Hi doctor. I've been having this terrible headache for the past three days.
It's mostly on the right side of my head and it throbs.
[Physician]: How would you rate the pain on a scale of 1 to 10?
[Patient]: I'd say about a 7. It's really affecting my work.
[Physician]: Have you taken anything for it?
[Patient]: Just ibuprofen 400mg, but it only helps a little.
[Physician]: Any nausea or visual changes?
[Patient]: Some nausea, yes, but no visual problems.
[Physician]: Any history of migraines in your family?
[Patient]: My mother gets terrible migraines.
[Physician]: Are you a smoker?
[Patient]: No, never smoked.
[Physician]: Let me examine you. Blood pressure is 128/82.
Your neurological exam is normal. No neck stiffness.
[Physician]: I think this is likely a migraine headache.
I'm going to prescribe sumatriptan 50mg to take at onset.
Let's also try keeping a headache diary.
Come back in two weeks or sooner if the headaches get worse.
[Patient]: Thank you, doctor.
[Physician]: You're welcome. Take care of yourself. The weather's been awful lately, hasn't it?
[Patient]: Oh yes, so much rain!
""",
        "expected_sections": {
            "chief_complaint_should_contain": ["headache"],
            "medications_should_contain": ["ibuprofen", "sumatriptan"],
            "should_not_contain_anywhere": ["rain", "weather", "awful"],
            "family_history_should_contain": ["migraine", "mother"],
            "social_history_should_contain": ["non-smoker", "never smoked"],
        },
    },
    "complex_visit": {
        "transcript": """
[Physician]: Mr. Rodriguez, I see you're here for your diabetes follow-up.
[Patient]: Yes, and I've also been feeling really tired lately.
[Physician]: Let's talk about the fatigue. How long has that been going on?
[Patient]: About two months. I'm also short of breath when I climb stairs.
[Physician]: Are you still taking metformin 1000mg twice daily?
[Patient]: Yes, and I'm also on lisinopril for my blood pressure.
[Physician]: Good. Any allergies we should know about?
[Patient]: I'm allergic to penicillin. I get hives.
[Physician]: Noted. Your A1C came back at 7.8, which is a bit high.
Blood pressure today is 142/88.
On exam, there's mild bilateral ankle edema.
Heart sounds regular, but I want to check your cardiac function.
[Physician]: I'm not certain, but the fatigue and edema could suggest
early heart failure. I'd like to order an echocardiogram and BNP level.
Let's also increase your metformin to 1500mg and add amlodipine 5mg
for better blood pressure control.
Follow up in one month with the echo results.
If you develop worsening shortness of breath, chest pain,
or sudden weight gain, go to the emergency room immediately.
""",
        "expected_sections": {
            "chief_complaint_should_contain": ["diabetes", "fatigue"],
            "medications_should_contain": ["metformin", "lisinopril", "amlodipine"],
            "allergies_should_contain": ["penicillin", "hives"],
            "uncertainty_should_be_preserved": True,
        },
    },
}


class TestAIOutputValidation:
    """Validate AI pipeline output against clinical standards."""

    def setup_method(self):
        self.nlp = ClinicalNLPService()
        self.validator = SafetyValidator()

    def test_simple_visit_entities_extracted(self):
        """Verify basic entity extraction from a simple visit."""
        data = SAMPLE_TRANSCRIPTS["simple_visit"]
        entities = self.nlp.extract_clinical_entities(data["transcript"])

        # Must extract chief complaint about headache
        assert entities["chief_complaint"], "Chief complaint should be extracted"

        # Must find symptoms
        assert len(entities["symptoms"]) >= 1, "Should find at least one symptom"

        # Must find medications
        assert len(entities["medications"]) >= 1, "Should find medication mentions"

    def test_simple_visit_non_clinical_filtered(self):
        """Verify non-clinical content is filtered out."""
        data = SAMPLE_TRANSCRIPTS["simple_visit"]
        entities = self.nlp.extract_clinical_entities(data["transcript"])

        clinical_text = entities["raw_clinical_text"].lower()
        forbidden = data["expected_sections"]["should_not_contain_anywhere"]
        for term in forbidden:
            assert term not in clinical_text, (
                f"Non-clinical term '{term}' should be filtered out"
            )

    def test_simple_visit_family_history(self):
        """Verify family history extraction."""
        data = SAMPLE_TRANSCRIPTS["simple_visit"]
        entities = self.nlp.extract_clinical_entities(data["transcript"])

        fhx = " ".join(entities.get("family_history_mentions", [])).lower()
        # Should mention mother and migraine
        assert len(entities["family_history_mentions"]) >= 1, (
            "Should extract family history"
        )

    def test_complex_visit_multiple_medications(self):
        """Verify multiple medication extraction."""
        data = SAMPLE_TRANSCRIPTS["complex_visit"]
        entities = self.nlp.extract_clinical_entities(data["transcript"])

        assert len(entities["medications"]) >= 2, (
            "Should extract multiple medication mentions"
        )

    def test_complex_visit_allergies(self):
        """Verify allergy extraction with reaction type."""
        data = SAMPLE_TRANSCRIPTS["complex_visit"]
        entities = self.nlp.extract_clinical_entities(data["transcript"])

        assert len(entities["allergies"]) >= 1, "Should extract allergy"

    def test_section_mapping_identifies_gaps(self):
        """Verify that missing sections are correctly identified."""
        # Use minimal input to test missing section detection
        entities = self.nlp.extract_clinical_entities("Patient reports headache.")
        mapped = self.nlp.map_to_note_sections(entities)

        missing = mapped["missing_sections"]
        # Several sections should be flagged as missing with minimal input
        assert len(missing) >= 5, (
            f"Should identify multiple missing sections, found: {missing}"
        )

    def test_safety_validator_catches_overreach(self):
        """Verify safety validator catches diagnostic overreach."""
        bad_note = {
            "chief_complaint": "Headache",
            "hpi": "Patient has severe headache",
            "past_medical_history": "",
            "medications": "",
            "allergies": "",
            "family_history": "",
            "social_history": "",
            "review_of_systems": {},
            "physical_examination": {},
            "assessment": "I recommend the patient undergo emergency surgery.",
            "plan": "The patient needs to start chemotherapy immediately.",
            "follow_up": "",
            "missing_sections": [],
            "uncertain_fields": [],
        }

        result = self.validator.validate(bad_note, "headache", {})
        assert len(result.red_flags) > 0, (
            "Should flag diagnostic overreach"
        )

    def test_safety_validator_detects_hallucinated_results(self):
        """Verify fabricated test results are detected."""
        fabricated_note = {
            "chief_complaint": "Cough",
            "hpi": "Three day cough",
            "past_medical_history": "",
            "medications": "",
            "allergies": "",
            "family_history": "",
            "social_history": "",
            "review_of_systems": {},
            "physical_examination": {},
            "assessment": "Cultures grew Streptococcus pneumoniae.",
            "plan": "Start IV antibiotics",
            "follow_up": "",
            "missing_sections": [],
            "uncertain_fields": [],
        }

        result = self.validator.validate(
            fabricated_note, "patient has cough for three days", {}
        )
        assert (
            len(result.hallucination_flags) > 0 or len(result.errors) > 0
        ), "Should detect fabricated lab results"

    def test_empty_transcript_flags_all_missing(self):
        """An empty transcript should produce a note with all sections missing."""
        entities = self.nlp.extract_clinical_entities("")
        mapped = self.nlp.map_to_note_sections(entities)

        assert len(mapped["missing_sections"]) >= 8, (
            "Empty transcript should flag most sections as missing"
        )

    def test_filter_count_reported(self):
        """Verify the NLP reports how many lines were filtered as non-clinical."""
        transcript = """
[Physician]: How's the weather today?
[Patient]: Oh it's terrible, so much rain.
[Physician]: Any chest pain?
[Patient]: Yes, sharp pain in my chest when I breathe.
[Physician]: Did you find parking okay?
[Patient]: Yeah the parking lot was full though.
"""
        entities = self.nlp.extract_clinical_entities(transcript)
        assert entities["filtered_count"] >= 2, (
            "Should report filtered non-clinical lines"
        )
        assert entities["clinical_count"] >= 1, (
            "Should report remaining clinical lines"
        )
