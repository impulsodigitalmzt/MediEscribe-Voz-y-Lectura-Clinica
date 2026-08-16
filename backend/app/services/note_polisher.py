"""
NotePolisher — Claude API integration for note polishing and structuring.

Handles:
- Sending structured section data to Claude API for professional polishing
- Clinical-grade language transformation
- Preserving clinical uncertainty (never fabricating certainty)
- Removing filler words, false starts, conversational artifacts
- Normalizing grammar and medical terminology
- Supporting multilingual output
- Never hallucinating — only documenting what was spoken

AI Processing Rules (strictly enforced):
1. Remove filler words, false starts, conversational artifacts
2. Ignore non-clinical conversation
3. Normalize grammar and medical terminology
4. Preserve clinical uncertainty
5. Never hallucinate
6. Highlight missing information
"""

import logging
import json
from typing import Dict, Any, Optional
from app.core import config

logger = logging.getLogger(__name__)


class NotePolishError(Exception):
    pass


class NotePolisher:
    """Claude API integration for transforming raw clinical data into polished notes."""

    SYSTEM_PROMPT = """You are MedScribe's clinical documentation engine. Transform raw clinical conversation extracts into polished, professional, detailed medical documentation.

STRICT RULES:

1. NEVER HALLUCINATE: Do not add clinical details not stated in the transcript. Mark uncertain items with [UNCERTAIN].

2. PRESERVE UNCERTAINTY: Never convert uncertain statements into definitive assertions.

3. REMOVE NON-CLINICAL CONTENT: Remove greetings, small talk, filler words.

4. PROFESSIONAL LANGUAGE: Use standard medical terminology and abbreviations.

5. DETAIL LEVEL: Write each section with adequate clinical detail — not too scanty, not excessively verbose. Expand abbreviations and provide context. For example:
   - Instead of "CP x 2 days" write "Patient presents with a 2-day history of chest pain, described as sharp in character, localized to the left precordial region."
   - Include relevant positives AND pertinent negatives.
   - For medications, include dose, route, frequency where mentioned.

6. MISSING SECTIONS: Output "[NOT DISCUSSED]" for sections with no content.

7. EVIDENCE-BASED RECOMMENDATIONS: In "recommended_plan", provide:
   - Specific evidence-based management recommendations relevant to the presentation
   - Name the guideline or protocol (e.g., "Per ACC/AHA 2023 Chest Pain Guidelines", "NICE CG95", "WHO IMCI Protocol")
   - Rationale for each recommendation — explain WHY each action is recommended
   - Include reference links to guidelines, journals, or protocols where available (use real URLs from UpToDate, BMJ Best Practice, NICE, WHO, PubMed)
   - Always end with: "⚠ These are AI-generated suggestions based on available guidelines and do not replace clinical judgment."

8. SBAR SUMMARY: Generate a detailed SBAR for clinical handoff.

9. DIAGNOSIS HIERARCHY:
   - provisional_diagnosis: Based on history and examination alone
   - differential_diagnosis: List 3-5 differentials with brief reasoning for each
   - final_diagnosis: Only if investigations confirmed. Otherwise "[PENDING INVESTIGATIONS]"

10. EMERGENCY/TRAUMA FORMAT: If the encounter_type is "emergency" or "trauma", additionally populate:
   - primary_survey (Airway, Breathing, Circulation, Disability, Exposure — ABCDE format)
   - secondary_survey (Head-to-toe systematic examination findings)
   - trauma_assessment (mechanism of injury, injuries identified, GCS if mentioned)
   - triage_priority (based on clinical presentation)
   - time_stamped_interventions (any interventions with timing)
   - disposition (admission, discharge, transfer, observation)

11. OUTPUT FORMAT: Return a valid JSON object with these keys:
   - chief_complaint
   - hpi (detailed chronological narrative with onset, character, radiation, associations, timing, exacerbating/relieving factors, severity)
   - on_direct_questioning (systematic targeted questions and responses)
   - past_medical_history (with dates and details where available)
   - past_surgical_history (procedures, dates, complications)
   - drug_history (current and past medications, substance use, recreational drugs, compliance)
   - medications (current medications with dose, route, frequency)
   - allergies (drug, food, environmental — with reaction type and severity)
   - family_history (relevant conditions with affected relatives)
   - social_history (occupation, smoking/alcohol/drugs with quantification, living situation, exercise, diet)
   - nutritional_history
   - immunization_history
   - developmental_history (for pediatrics)
   - gynecological_history (for OB/GYN)
   - obstetric_history (for OB/GYN — gravida, para, details of each pregnancy)
   - review_of_systems (organized by organ system as JSON object — include pertinent negatives)
   - physical_examination (organized by system as JSON object — include vital signs)
   - lab_investigations (tests ordered or results, with values if discussed)
   - imaging_investigations (imaging ordered or results)
   - investigation_comments (clinician interpretation and clinical correlation)
   - provisional_diagnosis
   - differential_diagnosis (list with brief reasoning for each)
   - final_diagnosis (or "[PENDING INVESTIGATIONS]")
   - assessment (clinical summary and reasoning)
   - plan (physician's stated management plan)
   - recommended_plan (evidence-based recommendations with rationale, guideline names, and reference URLs)
   - sbar_summary (Situation-Background-Assessment-Recommendation)
   - follow_up (timing, warning signs, patient education)
   - primary_survey (ABCDE — for emergency/trauma encounters, otherwise "[N/A - Regular Encounter]")
   - secondary_survey (head-to-toe — for emergency/trauma, otherwise "[N/A - Regular Encounter]")
   - uncertain_fields (list)
   - missing_sections (list)

Return ONLY the JSON object. No preamble, no explanation, no markdown."""

    def __init__(self):
        self._client = None

    async def _get_client(self):
        """Lazy-initialize the Anthropic client."""
        if self._client is None:
            try:
                import anthropic
                self._client = anthropic.AsyncAnthropic(
                    api_key=config.anthropic_api_key
                )
            except Exception as e:
                logger.error(f"Failed to initialize Anthropic client: {type(e).__name__}")
                raise NotePolishError("AI service unavailable.")
        return self._client

    async def polish_note(
        self,
        raw_sections: Dict[str, str],
        transcript_text: str,
        template: str = "general_practice",
        output_language: str = "en",
        encounter_type: str = "regular",
        patient_context: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Polish raw clinical data into a structured, professional note.
        """
        if not config.anthropic_api_key:
            return self._dev_fallback(raw_sections)

        try:
            client = await self._get_client()

            user_prompt = self._build_prompt(
                raw_sections, transcript_text, template, output_language, encounter_type
            )

            response = await client.messages.create(
                model=config.claude_model,
                max_tokens=config.claude_max_tokens,
                system=self.SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}]
            )

            # Extract text content
            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text

            # Parse JSON response
            polished = self._parse_response(content)
            return polished

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response as JSON: {content[:500]}")
            raise NotePolishError("AI returned an invalid response. Please try again.")
        except Exception as e:
            logger.error(f"Note polishing error: {type(e).__name__}: {str(e)}")
            raise NotePolishError(f"AI processing failed: {type(e).__name__} — {str(e)}")

    async def translate_note(
        self,
        note_sections: Dict[str, Any],
        target_language: str
    ) -> Dict[str, Any]:
        """Translate a polished note to a different language."""
        if not config.anthropic_api_key:
            return note_sections

        language_names = {
            "en": "English", "es": "Spanish", "fr": "French",
            "pt": "Portuguese", "ar": "Arabic", "zh": "Mandarin Chinese",
            "hi": "Hindi", "sw": "Swahili"
        }
        lang_name = language_names.get(target_language, "English")

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=config.claude_model,
                max_tokens=config.claude_max_tokens,
                system=(
                    f"Translate the following clinical note sections to {lang_name}. "
                    "Preserve all medical terminology accurately. "
                    "Maintain the JSON structure exactly. "
                    "Return ONLY the translated JSON object."
                ),
                messages=[{
                    "role": "user",
                    "content": json.dumps(note_sections, ensure_ascii=False)
                }]
            )

            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text

            return self._parse_response(content)

        except Exception as e:
            logger.error(f"Translation error: {type(e).__name__}")
            return note_sections  # Return original on failure

    async def generate_patient_instructions(
        self,
        plan: str,
        follow_up: str,
        target_language: str = "en"
    ) -> str:
        """Generate patient-friendly discharge instructions."""
        if not config.anthropic_api_key:
            return f"Plan: {plan}\nFollow-up: {follow_up}"

        language_names = {
            "en": "English", "es": "Spanish", "fr": "French",
            "pt": "Portuguese", "ar": "Arabic", "zh": "Mandarin Chinese",
            "hi": "Hindi", "sw": "Swahili"
        }
        lang_name = language_names.get(target_language, "English")

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=config.claude_model,
                max_tokens=1024,
                system=(
                    f"Generate clear, patient-friendly discharge instructions in {lang_name}. "
                    "Use simple language a non-medical person can understand. "
                    "Include warning signs to watch for. "
                    "Be concise and organized with bullet points."
                ),
                messages=[{
                    "role": "user",
                    "content": f"Treatment Plan:\n{plan}\n\nFollow-up:\n{follow_up}"
                }]
            )

            content = ""
            for block in response.content:
                if block.type == "text":
                    content += block.text
            return content

        except Exception as e:
            logger.error(f"Patient instructions error: {type(e).__name__}")
            return f"Plan: {plan}\nFollow-up: {follow_up}"

    def _build_prompt(
        self,
        raw_sections: Dict[str, str],
        transcript_text: str,
        template: str,
        output_language: str,
        encounter_type: str = "regular"
    ) -> str:
        """Build the prompt for Claude with all context."""
        language_names = {
            "en": "English", "es": "Spanish", "fr": "French",
            "pt": "Portuguese", "ar": "Arabic", "zh": "Mandarin Chinese",
            "hi": "Hindi", "sw": "Swahili", "de": "German", "it": "Italian",
            "ja": "Japanese", "ko": "Korean", "ru": "Russian", "tr": "Turkish",
            "ha": "Hausa", "yo": "Yoruba", "ig": "Igbo", "am": "Amharic",
            "tw": "Twi/Akan", "zu": "Zulu"
        }
        lang_name = language_names.get(output_language, "English")

        encounter_instruction = ""
        if encounter_type in ("emergency", "trauma"):
            encounter_instruction = f"""
ENCOUNTER TYPE: {encounter_type.upper()}
This is an {encounter_type} encounter. You MUST populate:
- primary_survey: Full ABCDE assessment (Airway status, Breathing rate/pattern/SpO2, Circulation including BP/HR/cap refill, Disability including GCS/pupils, Exposure findings)
- secondary_survey: Systematic head-to-toe examination findings
For trauma: include mechanism of injury, injuries identified, GCS score if mentioned.
"""
        else:
            encounter_instruction = """
ENCOUNTER TYPE: REGULAR CLERKING
This is a standard clinical encounter. Set primary_survey and secondary_survey to "[N/A - Regular Encounter]".
"""

        prompt = f"""Specialty Template: {template}
Output Language: {lang_name}
{encounter_instruction}

IMPORTANT: Write each section with adequate clinical detail. Expand findings with context. Include pertinent negatives. Do not be too brief or too verbose — aim for the detail level expected in a professional medical record.

For the recommended_plan section:
- Provide specific evidence-based recommendations with rationale
- Cite guideline names (e.g., "ACC/AHA 2023", "NICE NG203", "WHO IMCI")
- For each recommendation, explain WHY it is recommended
- Include real reference URLs from trusted sources (PubMed, NICE, WHO, UpToDate, BMJ Best Practice)
- Format each recommendation as: "Action — Rationale (Guideline Name) [URL]"

=== FULL TRANSCRIPT ===
{transcript_text}

=== EXTRACTED CLINICAL DATA (pre-processed) ===
{json.dumps(raw_sections, indent=2, ensure_ascii=False)}

Transform the above into a polished, professional clinical note following all rules in your system instructions. Output the result as a JSON object."""

        return prompt

    @staticmethod
    def _parse_response(content: str) -> Dict[str, Any]:
        """Parse Claude's JSON response, handling markdown fences."""
        content = content.strip()
        # Remove markdown code fences if present
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        return json.loads(content)

    @staticmethod
    def _dev_fallback(raw_sections: Dict[str, str]) -> Dict[str, Any]:
        """Development fallback when Claude API is not configured."""
        result = {
            "chief_complaint": raw_sections.get("chief_complaint", "[NOT DISCUSSED]"),
            "hpi": raw_sections.get("hpi", "[NOT DISCUSSED]"),
            "on_direct_questioning": raw_sections.get("on_direct_questioning", "[NOT DISCUSSED]"),
            "past_medical_history": raw_sections.get("past_medical_history", "[NOT DISCUSSED]"),
            "past_surgical_history": raw_sections.get("past_surgical_history", "[NOT DISCUSSED]"),
            "drug_history": raw_sections.get("drug_history", "[NOT DISCUSSED]"),
            "medications": raw_sections.get("medications", "[NOT DISCUSSED]"),
            "allergies": raw_sections.get("allergies", "[NOT DISCUSSED]"),
            "family_history": raw_sections.get("family_history", "[NOT DISCUSSED]"),
            "social_history": raw_sections.get("social_history", "[NOT DISCUSSED]"),
            "nutritional_history": raw_sections.get("nutritional_history", "[NOT DISCUSSED]"),
            "immunization_history": raw_sections.get("immunization_history", "[NOT DISCUSSED]"),
            "developmental_history": raw_sections.get("developmental_history", "[NOT DISCUSSED]"),
            "gynecological_history": raw_sections.get("gynecological_history", "[NOT DISCUSSED]"),
            "obstetric_history": raw_sections.get("obstetric_history", "[NOT DISCUSSED]"),
            "review_of_systems": {},
            "physical_examination": {},
            "lab_investigations": raw_sections.get("lab_investigations", "[NOT DISCUSSED]"),
            "imaging_investigations": raw_sections.get("imaging_investigations", "[NOT DISCUSSED]"),
            "investigation_comments": raw_sections.get("investigation_comments", "[NOT DISCUSSED]"),
            "provisional_diagnosis": raw_sections.get("provisional_diagnosis", "[NOT DISCUSSED]"),
            "differential_diagnosis": raw_sections.get("differential_diagnosis", "[NOT DISCUSSED]"),
            "final_diagnosis": raw_sections.get("final_diagnosis", "[PENDING INVESTIGATIONS]"),
            "assessment": raw_sections.get("assessment", "[NOT DISCUSSED]"),
            "plan": raw_sections.get("plan", "[NOT DISCUSSED]"),
            "recommended_plan": "AI recommendation not available in development mode.",
            "sbar_summary": "[NOT GENERATED]",
            "primary_survey": "[N/A - Regular Encounter]",
            "secondary_survey": "[N/A - Regular Encounter]",
            "follow_up": raw_sections.get("follow_up", "[NOT DISCUSSED]"),
            "uncertain_fields": [],
            "missing_sections": [
                k for k, v in raw_sections.items()
                if not v or v == "[NOT DISCUSSED]"
            ],
        }
        return result

    async def close(self):
        """Clean up client resources."""
        if self._client:
            await self._client.close()
            self._client = None


note_polisher = NotePolisher()
