"""
Note Generation Templates — Specialty-specific prompts and section configurations.

These templates customize the Claude API prompt for each specialty,
ensuring the AI focuses on the most relevant clinical elements.
"""

SPECIALTY_PROMPTS = {
    "general_practice": {
        "context": (
            "This is a general practice / primary care encounter. "
            "Focus on comprehensive SOAP-style documentation. "
            "Include preventive care observations and chronic disease management notes if discussed."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "medications", "allergies",
            "review_of_systems", "physical_examination", "assessment", "plan"
        ],
    },
    "emergency_medicine": {
        "context": (
            "This is an emergency department encounter. "
            "Prioritize time-stamped interventions and acute assessment. "
            "Focus on triage priority, stabilization measures, and disposition planning. "
            "Include trauma assessment details if relevant."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "physical_examination",
            "assessment", "plan", "follow_up"
        ],
    },
    "pediatrics": {
        "context": (
            "This is a pediatric encounter. "
            "Document growth parameters (weight, height percentiles) if mentioned. "
            "Include developmental milestones, immunization status, and caregiver information. "
            "Use age-appropriate clinical documentation standards."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "medications",
            "physical_examination", "assessment", "plan"
        ],
    },
    "surgery": {
        "context": (
            "This is a surgical encounter. "
            "Document pre-operative assessment, surgical history, and consent discussion if mentioned. "
            "If this is a post-operative encounter, focus on recovery status and complications. "
            "Include operative note details if discussed during the encounter."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "past_medical_history",
            "physical_examination", "assessment", "plan"
        ],
    },
    "psychiatry": {
        "context": (
            "This is a psychiatric encounter. "
            "Document mental status examination findings thoroughly. "
            "Include risk assessment (suicidal ideation, homicidal ideation, self-harm) if discussed. "
            "Note therapy progress, medication reconciliation, and safety planning. "
            "Include validated screening scores (PHQ-9, GAD-7) if mentioned."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "medications",
            "assessment", "plan", "follow_up"
        ],
    },
    "cardiology": {
        "context": (
            "This is a cardiology encounter. "
            "Document cardiovascular examination findings in detail. "
            "Include ECG interpretation, hemodynamic data, and cardiac risk scores if discussed. "
            "Note ejection fraction, NYHA classification, and CHA2DS2-VASc scores if mentioned."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "physical_examination",
            "medications", "assessment", "plan"
        ],
    },
    "oncology": {
        "context": (
            "This is an oncology encounter. "
            "Document cancer staging (TNM), treatment protocol, and current cycle if discussed. "
            "Include adverse event documentation and performance status (ECOG). "
            "Note any changes in treatment plan or new imaging results discussed."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "medications",
            "physical_examination", "assessment", "plan"
        ],
    },
    "telemedicine": {
        "context": (
            "This is a telemedicine / virtual visit encounter. "
            "Document connectivity quality and any technical limitations. "
            "Note that physical examination is limited to visual assessment via video. "
            "Document virtual visit consent and the patient's environment observations. "
            "Flag any findings that require in-person follow-up."
        ),
        "priority_sections": [
            "chief_complaint", "hpi", "review_of_systems",
            "assessment", "plan", "follow_up"
        ],
    },
}


# Section display labels for all template types
SECTION_DISPLAY_NAMES = {
    "chief_complaint": "Chief Complaint (CC)",
    "hpi": "History of Present Illness (HPI)",
    "past_medical_history": "Past Medical History (PMH)",
    "medications": "Medications",
    "allergies": "Allergies",
    "family_history": "Family History (FHx)",
    "social_history": "Social History (SHx)",
    "review_of_systems": "Review of Systems (ROS)",
    "physical_examination": "Physical Examination",
    "assessment": "Assessment",
    "plan": "Plan",
    "follow_up": "Follow-up Instructions",
    # Specialty-specific sections
    "triage_priority": "Triage Priority",
    "time_stamped_interventions": "Time-Stamped Interventions",
    "disposition_plan": "Disposition Plan",
    "trauma_assessment": "Trauma Assessment",
    "growth_parameters": "Growth Parameters",
    "developmental_milestones": "Developmental Milestones",
    "immunization_status": "Immunization Status",
    "caregiver_information": "Caregiver Information",
    "pre_operative_assessment": "Pre-Operative Assessment",
    "operative_note": "Operative Note",
    "post_operative_plan": "Post-Operative Plan",
    "consent_documentation": "Consent Documentation",
    "psychiatric_history": "Psychiatric History",
    "mental_status_exam": "Mental Status Examination",
    "risk_assessment": "Risk Assessment",
    "safety_plan": "Safety Plan",
    "therapy_progress": "Therapy Progress",
    "medication_reconciliation": "Medication Reconciliation",
    "cardiac_history": "Cardiac History",
    "cardiovascular_examination": "Cardiovascular Examination",
    "ecg_interpretation": "ECG Interpretation",
    "hemodynamic_data": "Hemodynamic Data",
    "risk_scores": "Risk Scores",
    "cancer_staging": "Cancer Staging",
    "treatment_protocol": "Treatment Protocol",
    "cycle_tracking": "Cycle Tracking",
    "adverse_events": "Adverse Events",
    "performance_status": "Performance Status",
    "connectivity_documentation": "Connectivity Documentation",
    "remote_exam_limitations": "Remote Exam Limitations",
    "patient_environment": "Patient Environment",
    "virtual_visit_consent": "Virtual Visit Consent",
    "limited_physical_examination": "Limited Physical Examination",
}


def get_specialty_prompt(template_id: str) -> dict:
    """Get the specialty-specific prompt configuration."""
    return SPECIALTY_PROMPTS.get(template_id, SPECIALTY_PROMPTS["general_practice"])


def get_section_label(section_key: str) -> str:
    """Get the display label for a section key."""
    return SECTION_DISPLAY_NAMES.get(section_key, section_key.replace("_", " ").title())
