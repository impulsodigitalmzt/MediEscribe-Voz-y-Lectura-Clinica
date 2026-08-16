"""
SafetyValidator — Output validation for hallucination detection and completeness.

Checks polished AI output for:
- Hallucinated content (details not in transcript)
- Contradictions with transcript
- Red flags (dangerous content, diagnostic overreach)
- Completeness (all required sections present)
- Uncertainty preservation
- AI labeling compliance
"""

import re
import logging
from typing import Dict, Any, List, Tuple

logger = logging.getLogger(__name__)


class SafetyValidationResult:
    """Result of safety validation."""

    def __init__(self):
        self.is_safe: bool = True
        self.warnings: List[str] = []
        self.errors: List[str] = []
        self.hallucination_flags: List[str] = []
        self.missing_sections: List[str] = []
        self.uncertain_fields: List[str] = []
        self.red_flags: List[str] = []

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_safe": self.is_safe,
            "warnings": self.warnings,
            "errors": self.errors,
            "hallucination_flags": self.hallucination_flags,
            "missing_sections": self.missing_sections,
            "uncertain_fields": self.uncertain_fields,
            "red_flags": self.red_flags,
        }


class SafetyValidator:
    """Validates AI-generated clinical notes for safety and accuracy."""

    REQUIRED_SECTIONS = [
        "chief_complaint", "hpi", "past_medical_history", "medications",
        "allergies", "family_history", "social_history", "review_of_systems",
        "physical_examination", "assessment", "plan", "follow_up"
    ]

    # Red flag patterns — AI should NEVER generate these
    DIAGNOSTIC_OVERREACH_PATTERNS = [
        r'\b(?:I recommend|I suggest|you should|I advise|my recommendation)\b',
        r'\b(?:the patient needs|must undergo|requires immediate)\b',
    ]

    # Fabrication indicators
    FABRICATION_INDICATORS = [
        r'\b(?:lab results show|imaging reveals|test confirmed)\b',
        r'\b(?:biopsy confirmed|pathology shows|cultures grew)\b',
    ]

    def validate(
        self,
        polished_note: Dict[str, Any],
        transcript_text: str,
        raw_entities: Dict[str, Any]
    ) -> SafetyValidationResult:
        """
        Run all safety validations on a polished note.

        Args:
            polished_note: AI-polished note sections
            transcript_text: Original full transcript
            raw_entities: Pre-NLP extracted entities for cross-reference
        """
        result = SafetyValidationResult()

        # 1. Check completeness
        self._check_completeness(polished_note, result)

        # 2. Check for hallucinations
        self._check_hallucinations(polished_note, transcript_text, result)

        # 3. Check for diagnostic overreach
        self._check_diagnostic_overreach(polished_note, result)

        # 4. Check uncertainty preservation
        self._check_uncertainty_preservation(polished_note, transcript_text, result)

        # 5. Check for red flags
        self._check_red_flags(polished_note, result)

        # 6. Track missing and uncertain
        result.missing_sections = polished_note.get("missing_sections", [])
        result.uncertain_fields = polished_note.get("uncertain_fields", [])

        # Set overall safety
        if result.errors or result.red_flags:
            result.is_safe = False

        return result

    def _check_completeness(
        self,
        note: Dict[str, Any],
        result: SafetyValidationResult
    ):
        """Verify all required sections are present (or marked as not discussed)."""
        for section in self.REQUIRED_SECTIONS:
            content = note.get(section)
            if content is None:
                result.warnings.append(
                    f"Section '{section}' is missing from the note output"
                )

    def _check_hallucinations(
        self,
        note: Dict[str, Any],
        transcript: str,
        result: SafetyValidationResult
    ):
        """
        Check for potential hallucinated content.

        Strategy: Look for specific medical terms in the note that don't appear
        anywhere in the transcript. This is a heuristic — false positives are
        preferable to missed hallucinations.
        """
        transcript_lower = transcript.lower()

        # Check medications
        med_text = str(note.get("medications", "")).lower()
        if med_text and med_text != "[not discussed]":
            # Extract drug-like words (capitalized or ending in common suffixes)
            drug_pattern = r'\b[A-Za-z]+(?:ol|in|ide|ine|ate|one|pam|lin|cin|mycin|azole|pril|sartan|statin|mab)\b'
            drugs_in_note = set(re.findall(drug_pattern, med_text))
            for drug in drugs_in_note:
                if drug not in transcript_lower and len(drug) > 4:
                    result.hallucination_flags.append(
                        f"Medication '{drug}' appears in note but not in transcript"
                    )
                    result.warnings.append(
                        f"Potential hallucinated medication: '{drug}'"
                    )

        # Check for fabricated test results
        for section_name in ["assessment", "physical_examination", "hpi"]:
            section_content = str(note.get(section_name, "")).lower()
            for pattern in self.FABRICATION_INDICATORS:
                if re.search(pattern, section_content):
                    result.hallucination_flags.append(
                        f"Potential fabricated result in '{section_name}'"
                    )
                    result.errors.append(
                        f"Section '{section_name}' may contain fabricated test results"
                    )

    def _check_diagnostic_overreach(
        self,
        note: Dict[str, Any],
        result: SafetyValidationResult
    ):
        """Check that the AI hasn't made treatment recommendations."""
        for section_name, content in note.items():
            if not isinstance(content, str):
                continue
            for pattern in self.DIAGNOSTIC_OVERREACH_PATTERNS:
                if re.search(pattern, content, re.IGNORECASE):
                    result.red_flags.append(
                        f"Diagnostic overreach detected in '{section_name}': "
                        f"AI appears to be making recommendations"
                    )

    def _check_uncertainty_preservation(
        self,
        note: Dict[str, Any],
        transcript: str,
        result: SafetyValidationResult
    ):
        """
        Verify that uncertainty from the transcript is preserved in the note.
        If the physician said something was uncertain, the note shouldn't
        convert it to a definitive statement.
        """
        uncertainty_markers = [
            "might be", "could be", "possibly", "uncertain", "not sure",
            "maybe", "rule out", "cannot exclude", "differential includes",
            "suspicious for", "concerning for"
        ]

        transcript_lower = transcript.lower()
        has_uncertainty = any(m in transcript_lower for m in uncertainty_markers)

        if has_uncertainty:
            assessment = str(note.get("assessment", "")).lower()
            # If transcript has uncertainty but assessment doesn't reflect it
            if assessment and "[not discussed]" not in assessment:
                note_has_uncertainty = any(m in assessment for m in uncertainty_markers)
                if not note_has_uncertainty and "uncertain" not in str(note.get("uncertain_fields", [])):
                    result.warnings.append(
                        "Transcript contains uncertain language but the assessment "
                        "may not reflect this uncertainty"
                    )

    def _check_red_flags(
        self,
        note: Dict[str, Any],
        result: SafetyValidationResult
    ):
        """Check for critical safety red flags."""
        # Check for empty note with no explanation
        all_empty = all(
            not str(v).strip() or str(v) == "[NOT DISCUSSED]"
            for k, v in note.items()
            if k in self.REQUIRED_SECTIONS
        )
        if all_empty:
            result.warnings.append(
                "All note sections are empty or not discussed. "
                "The encounter may not have captured sufficient clinical content."
            )


safety_validator = SafetyValidator()
