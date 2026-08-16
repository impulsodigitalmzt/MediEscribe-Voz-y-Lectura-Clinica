"""
TemplateManager — Specialty template CRUD and encounter template assignment.

Provides customizable templates tailored to clinical specialties.
Each template defines which note sections are displayed, their order,
and any specialty-specific fields.
"""

import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class TemplateManager:
    """Manages specialty-specific clinical note templates."""

    # Default templates per the specification
    TEMPLATES: Dict[str, Dict[str, Any]] = {
        "general_practice": {
            "id": "general_practice",
            "name": "General Practice",
            "specialty": "General Practice",
            "description": "Full SOAP note with preventive care prompts and chronic disease tracking",
            "sections": [
                "chief_complaint", "hpi", "past_medical_history", "medications",
                "allergies", "family_history", "social_history", "review_of_systems",
                "physical_examination", "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "past_medical_history", "medications",
                "allergies", "family_history", "social_history", "review_of_systems",
                "physical_examination", "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "preventive_care_prompts": True,
                "chronic_disease_tracking": True,
            },
        },
        "emergency_medicine": {
            "id": "emergency_medicine",
            "name": "Emergency Medicine",
            "specialty": "Emergency Medicine",
            "description": "Triage priority, time-stamped interventions, disposition planning, trauma assessment",
            "sections": [
                "chief_complaint", "triage_priority", "hpi",
                "past_medical_history", "medications", "allergies",
                "review_of_systems", "physical_examination",
                "time_stamped_interventions", "assessment",
                "disposition_plan", "trauma_assessment", "follow_up"
            ],
            "section_order": [
                "triage_priority", "chief_complaint", "hpi",
                "time_stamped_interventions", "physical_examination",
                "assessment", "disposition_plan", "trauma_assessment", "follow_up"
            ],
            "custom_fields": {
                "triage_level": "",
                "arrival_mode": "",
                "disposition": "",
            },
        },
        "pediatrics": {
            "id": "pediatrics",
            "name": "Pediatrics",
            "specialty": "Pediatrics",
            "description": "Growth parameters, developmental milestones, immunization status, caregiver information",
            "sections": [
                "chief_complaint", "hpi", "past_medical_history", "medications",
                "allergies", "family_history", "social_history",
                "growth_parameters", "developmental_milestones",
                "immunization_status", "caregiver_information",
                "review_of_systems", "physical_examination",
                "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "growth_parameters",
                "developmental_milestones", "immunization_status",
                "past_medical_history", "medications", "allergies",
                "family_history", "caregiver_information",
                "review_of_systems", "physical_examination",
                "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "weight_percentile": "",
                "height_percentile": "",
                "head_circumference": "",
                "bmi_percentile": "",
            },
        },
        "surgery": {
            "id": "surgery",
            "name": "Surgery",
            "specialty": "Surgery",
            "description": "Pre-operative assessment, operative note, post-operative plan, consent documentation",
            "sections": [
                "chief_complaint", "hpi", "past_medical_history",
                "past_surgical_history", "medications", "allergies",
                "pre_operative_assessment", "operative_note",
                "post_operative_plan", "consent_documentation",
                "physical_examination", "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "pre_operative_assessment",
                "past_surgical_history", "past_medical_history",
                "medications", "allergies", "physical_examination",
                "operative_note", "assessment", "post_operative_plan",
                "consent_documentation", "follow_up"
            ],
            "custom_fields": {
                "procedure_name": "",
                "anesthesia_type": "",
                "estimated_blood_loss": "",
                "specimens_sent": "",
            },
        },
        "psychiatry": {
            "id": "psychiatry",
            "name": "Psychiatry",
            "specialty": "Psychiatry",
            "description": "Mental status exam, risk assessment, safety plan, therapy progress, medication reconciliation",
            "sections": [
                "chief_complaint", "hpi", "past_medical_history",
                "psychiatric_history", "medications",
                "medication_reconciliation", "allergies",
                "family_history", "social_history",
                "mental_status_exam", "risk_assessment",
                "safety_plan", "therapy_progress",
                "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "psychiatric_history",
                "mental_status_exam", "risk_assessment", "safety_plan",
                "therapy_progress", "medications", "medication_reconciliation",
                "past_medical_history", "family_history", "social_history",
                "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "phq9_score": "",
                "gad7_score": "",
                "suicidal_ideation": False,
                "homicidal_ideation": False,
            },
        },
        "cardiology": {
            "id": "cardiology",
            "name": "Cardiology",
            "specialty": "Cardiology",
            "description": "Cardiovascular exam detail, ECG interpretation, risk scores, hemodynamic data",
            "sections": [
                "chief_complaint", "hpi", "past_medical_history",
                "cardiac_history", "medications", "allergies",
                "family_history", "social_history", "review_of_systems",
                "cardiovascular_examination", "ecg_interpretation",
                "hemodynamic_data", "risk_scores",
                "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "cardiac_history",
                "cardiovascular_examination", "ecg_interpretation",
                "hemodynamic_data", "risk_scores",
                "past_medical_history", "medications", "allergies",
                "family_history", "social_history",
                "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "ejection_fraction": "",
                "nyha_class": "",
                "cha2ds2_vasc": "",
            },
        },
        "oncology": {
            "id": "oncology",
            "name": "Oncology",
            "specialty": "Oncology",
            "description": "Staging, treatment protocol, cycle tracking, adverse events, performance status",
            "sections": [
                "chief_complaint", "hpi", "cancer_staging",
                "treatment_protocol", "cycle_tracking",
                "adverse_events", "performance_status",
                "past_medical_history", "medications", "allergies",
                "family_history", "review_of_systems",
                "physical_examination", "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "chief_complaint", "hpi", "cancer_staging",
                "treatment_protocol", "cycle_tracking", "adverse_events",
                "performance_status", "physical_examination",
                "medications", "past_medical_history",
                "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "tnm_staging": "",
                "ecog_score": "",
                "current_cycle": "",
                "protocol_name": "",
            },
        },
        "telemedicine": {
            "id": "telemedicine",
            "name": "Telemedicine",
            "specialty": "Telemedicine",
            "description": "Connectivity documentation, remote exam limitations, patient environment notes, virtual visit consent",
            "sections": [
                "chief_complaint", "hpi", "connectivity_documentation",
                "remote_exam_limitations", "patient_environment",
                "virtual_visit_consent", "past_medical_history",
                "medications", "allergies", "family_history",
                "social_history", "review_of_systems",
                "limited_physical_examination",
                "assessment", "plan", "follow_up"
            ],
            "section_order": [
                "virtual_visit_consent", "connectivity_documentation",
                "patient_environment", "chief_complaint", "hpi",
                "past_medical_history", "medications", "allergies",
                "review_of_systems", "remote_exam_limitations",
                "limited_physical_examination",
                "assessment", "plan", "follow_up"
            ],
            "custom_fields": {
                "platform_used": "",
                "audio_quality": "",
                "video_quality": "",
            },
        },
    }

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a template by ID."""
        return self.TEMPLATES.get(template_id)

    def list_templates(self) -> List[Dict[str, Any]]:
        """List all available templates."""
        return [
            {
                "id": t["id"],
                "name": t["name"],
                "specialty": t["specialty"],
                "description": t["description"],
            }
            for t in self.TEMPLATES.values()
        ]

    def get_template_sections(self, template_id: str) -> List[str]:
        """Get ordered sections for a template."""
        template = self.get_template(template_id)
        if not template:
            template = self.TEMPLATES["general_practice"]
        return template["section_order"]

    def get_custom_fields(self, template_id: str) -> Dict[str, Any]:
        """Get custom fields for a template."""
        template = self.get_template(template_id)
        if not template:
            return {}
        return template.get("custom_fields", {})

    def validate_template_id(self, template_id: str) -> bool:
        """Check if a template ID is valid."""
        return template_id in self.TEMPLATES


template_manager = TemplateManager()
