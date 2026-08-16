"""
Encounter API Routes — Full encounter lifecycle management.

Covers:
- Encounter creation, retrieval, listing
- Status transitions (recording, pause, resume, stop)
- Consent management
- Note generation trigger
- Note editing and sign-off
- PDF export
- Transcript retrieval
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from typing import Optional
import json

from app.core.database import get_db
from app.models import (
    Encounter, EncounterStatus, ClinicalNote, NoteStatus, NoteVersion
)
from app.schemas import (
    EncounterCreateRequest, EncounterResponse, EncounterListResponse,
    NoteEditRequest, NoteSignOffRequest, ClinicalNoteResponse,
    ConsentRequest, ErrorResponse
)
from app.services import (
    encounter_manager, consent_manager, audit_logger,
    transcription_service, clinical_nlp, note_polisher,
    safety_validator, template_manager, export_service
)
from app.api.dependencies import (
    get_current_user, require_roles, get_client_ip, get_user_agent
)

router = APIRouter(prefix="/encounters", tags=["Encounters"])


# --- Encounter CRUD ---

@router.post(
    "",
    response_model=EncounterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_encounter(
    request: Request,
    body: EncounterCreateRequest,
    current_user: dict = Depends(require_roles(["physician", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Create a new clinical encounter session."""
    encounter = await encounter_manager.create_encounter(
        db=db,
        physician_id=current_user["user_id"],
        patient_name=body.patient_name,
        patient_dob=body.patient_dob,
        patient_mrn=body.patient_mrn,
        specialty_template=body.specialty_template,
        spoken_language=body.spoken_language,
        output_language=body.output_language,
        ip_address=get_client_ip(request),
    )
    return _encounter_to_response(encounter)


@router.get("", response_model=EncounterListResponse)
async def list_encounters(
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List encounters for the current physician."""
    encounters, total = await encounter_manager.list_encounters(
        db=db,
        physician_id=current_user["user_id"],
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )
    return EncounterListResponse(
        encounters=[_encounter_to_response(e) for e in encounters],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{encounter_id}", response_model=EncounterResponse)
async def get_encounter(
    encounter_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific encounter by ID."""
    try:
        encounter = await encounter_manager.get_encounter(
            db, encounter_id, current_user["user_id"]
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Encounter not found.")
    return _encounter_to_response(encounter)


@router.delete("/{encounter_id}")
async def delete_encounter(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """Delete an encounter and all related data."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])

    await audit_logger.log(
        db=db,
        action=audit_logger.ENCOUNTER_DELETED,
        resource_type="encounter",
        resource_id=encounter.id,
        user_id=current_user["user_id"],
        ip_address=get_client_ip(request),
    )

    await db.delete(encounter)
    await db.flush()
    return {"status": "deleted"}


# --- Recording Controls ---

@router.post("/{encounter_id}/pause")
async def pause_recording(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Pause an active recording."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    try:
        await encounter_manager.transition_status(
            db, encounter, EncounterStatus.PAUSED,
            current_user["user_id"], get_client_ip(request)
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "paused"}


@router.post("/{encounter_id}/resume")
async def resume_recording(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Resume a paused recording."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    try:
        await encounter_manager.transition_status(
            db, encounter, EncounterStatus.RECORDING,
            current_user["user_id"], get_client_ip(request)
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "recording"}


@router.post("/{encounter_id}/stop")
async def stop_recording(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Stop recording and begin transcription processing."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    try:
        await encounter_manager.transition_status(
            db, encounter, EncounterStatus.TRANSCRIBING,
            current_user["user_id"], get_client_ip(request)
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "transcribing"}


# --- Consent ---

@router.post("/{encounter_id}/consent")
async def record_consent(
    encounter_id: str,
    body: ConsentRequest,
    request: Request,
    current_user: dict = Depends(require_roles(["physician", "nurse"])),
    db: AsyncSession = Depends(get_db)
):
    """Record patient consent for the encounter."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    record = await consent_manager.record_consent(
        db=db,
        encounter_id=encounter.id,
        consent_type=body.consent_type,
        consented=body.consented,
        consented_by=body.consented_by,
        recorded_by_user_id=current_user["user_id"],
        ip_address=get_client_ip(request),
    )
    return {"consent_id": record.id, "consented": record.consented}


# --- Transcript ---

@router.get("/{encounter_id}/transcript")
async def get_transcript(
    encounter_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get the full transcript for an encounter."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    segments = await transcription_service.get_full_transcript(db, encounter.id)
    return {
        "encounter_id": encounter_id,
        "segments": [
            {
                "sequence": s.sequence_number,
                "speaker": s.speaker_label,
                "content": s.content,
                "timestamp_start": s.timestamp_start,
                "timestamp_end": s.timestamp_end,
                "language": s.language_detected,
                "confidence": s.confidence,
            }
            for s in segments
        ]
    }


# --- Manual Transcript Input ---

@router.post("/{encounter_id}/manual-transcript")
async def submit_bulk_manual_transcript(
    encounter_id: str,
    body: dict,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Submit a full manual transcript (typed/pasted by physician)."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Transcript text cannot be empty.")

    # Store as a single transcript segment
    await transcription_service.store_transcript_segment(
        db=db,
        encounter_id=encounter.id,
        text=text,
        speaker_label="manual_input",
        language_detected=encounter.spoken_language,
        confidence=1.0,
    )

    # Transition status
    encounter.status = EncounterStatus.TRANSCRIBING
    await db.flush()

    await audit_logger.log(
        db=db,
        action="encounter.manual_transcript",
        resource_type="encounter",
        resource_id=encounter.id,
        user_id=current_user["user_id"],
        details={"status": "manual_input"},
        ip_address=get_client_ip(request),
    )

    return {"status": "transcript_received"}


@router.post("/{encounter_id}/transcript/manual")
async def submit_manual_transcript(
    encounter_id: str,
    body: dict,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Submit a manual transcript segment (typed by physician)."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])

    content = body.get("content", "").strip()
    speaker = body.get("speaker_label", "unknown")

    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty.")

    segment = await transcription_service.store_transcript_segment(
        db=db,
        encounter_id=encounter.id,
        text=content,
        speaker_label=speaker,
        language_detected=encounter.spoken_language,
        confidence=1.0,  # Manual input = full confidence
    )

    return {"id": segment.id, "sequence": segment.sequence_number}

@router.post("/{encounter_id}/generate-note")
async def generate_note(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Generate an AI clinical note from the encounter transcript."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])

    # Verify consent
    has_consent = await consent_manager.verify_consent(db, encounter.id)
    if not has_consent:
        raise HTTPException(
            status_code=400,
            detail="Recording consent must be captured before generating notes."
        )

    # Get transcript (deduplication happens inside get_transcript_text)
    transcript_text = await transcription_service.get_transcript_text(db, encounter.id)
    if not transcript_text.strip():
        raise HTTPException(
            status_code=400,
            detail="No transcript data available. Please record an encounter first."
        )

    # Safety cap: truncate to ~8000 words to avoid token limit errors
    words = transcript_text.split()
    if len(words) > 8000:
        transcript_text = " ".join(words[:8000])

    # NLP extraction
    entities = clinical_nlp.extract_clinical_entities(transcript_text)
    mapped = clinical_nlp.map_to_note_sections(entities, encounter.specialty_template)

    # AI polishing via Claude
    try:
        polished = await note_polisher.polish_note(
            raw_sections=mapped["sections"],
            transcript_text=transcript_text,
            template=encounter.specialty_template,
            output_language=encounter.output_language,
            encounter_type=getattr(encounter, 'encounter_type', 'regular') or 'regular',
        )
    except Exception as e:
        logger.error(f"Note generation failed for encounter {encounter_id}: {type(e).__name__}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Note generation failed: {str(e)}")

    # Safety validation
    validation = safety_validator.validate(polished, transcript_text, entities)
    if not validation.is_safe:
        # Still create the note but flag the issues
        polished["_safety_warnings"] = validation.to_dict()

    # Store or update note
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    existing_note = result.scalar_one_or_none()

    if existing_note:
        # Update existing
        for key in [
            "chief_complaint", "hpi", "on_direct_questioning",
            "past_medical_history", "past_surgical_history", "drug_history", "medications",
            "allergies", "family_history", "social_history",
            "nutritional_history", "immunization_history",
            "developmental_history", "gynecological_history", "obstetric_history",
            "lab_investigations", "imaging_investigations", "investigation_comments",
            "provisional_diagnosis", "differential_diagnosis", "final_diagnosis",
            "assessment", "plan", "recommended_plan", "sbar_summary", "primary_survey", "secondary_survey", "follow_up"
        ]:
            setattr(existing_note, key, polished.get(key, ""))
        existing_note.review_of_systems = polished.get("review_of_systems", {})
        existing_note.physical_examination = polished.get("physical_examination", {})
        existing_note.missing_sections = polished.get("missing_sections", [])
        existing_note.uncertain_fields = polished.get("uncertain_fields", [])
        existing_note.status = NoteStatus.PENDING_REVIEW
        note = existing_note
    else:
        note = ClinicalNote(
            encounter_id=encounter.id,
            chief_complaint=polished.get("chief_complaint", ""),
            hpi=polished.get("hpi", ""),
            past_medical_history=polished.get("past_medical_history", ""),
            past_surgical_history=polished.get("past_surgical_history", ""),
            drug_history=polished.get("drug_history", ""),
            medications=polished.get("medications", ""),
            allergies=polished.get("allergies", ""),
            family_history=polished.get("family_history", ""),
            social_history=polished.get("social_history", ""),
            on_direct_questioning=polished.get("on_direct_questioning", ""),
            nutritional_history=polished.get("nutritional_history", ""),
            immunization_history=polished.get("immunization_history", ""),
            developmental_history=polished.get("developmental_history", ""),
            gynecological_history=polished.get("gynecological_history", ""),
            obstetric_history=polished.get("obstetric_history", ""),
            review_of_systems=polished.get("review_of_systems", {}),
            physical_examination=polished.get("physical_examination", {}),
            lab_investigations=polished.get("lab_investigations", ""),
            imaging_investigations=polished.get("imaging_investigations", ""),
            investigation_comments=polished.get("investigation_comments", ""),
            provisional_diagnosis=polished.get("provisional_diagnosis", ""),
            differential_diagnosis=polished.get("differential_diagnosis", ""),
            final_diagnosis=polished.get("final_diagnosis", ""),
            assessment=polished.get("assessment", ""),
            plan=polished.get("plan", ""),
            recommended_plan=polished.get("recommended_plan", ""),
            sbar_summary=polished.get("sbar_summary", ""),
            primary_survey=polished.get("primary_survey", ""),
            secondary_survey=polished.get("secondary_survey", ""),
            follow_up=polished.get("follow_up", ""),
            missing_sections=polished.get("missing_sections", []),
            uncertain_fields=polished.get("uncertain_fields", []),
            status=NoteStatus.PENDING_REVIEW,
        )
        db.add(note)

    # Transition encounter status
    if encounter.status == EncounterStatus.TRANSCRIBING:
        encounter.status = EncounterStatus.GENERATING_NOTE
    encounter.status = EncounterStatus.PENDING_REVIEW
    await db.flush()

    await audit_logger.log(
        db=db,
        action=audit_logger.NOTE_GENERATED,
        resource_type="note",
        resource_id=note.id,
        user_id=current_user["user_id"],
        details={
            "template": encounter.specialty_template,
            "missing_sections_count": len(polished.get("missing_sections", [])),
        },
        ip_address=get_client_ip(request),
    )

    return _note_to_response(note)


# --- Note Retrieval & Editing ---

@router.get("/{encounter_id}/note", response_model=ClinicalNoteResponse)
async def get_note(
    encounter_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get the clinical note for an encounter."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="No note found for this encounter.")
    return _note_to_response(note)


@router.patch("/{encounter_id}/note")
async def edit_note(
    encounter_id: str,
    body: NoteEditRequest,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """Edit a section of the clinical note."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="No note found.")

    if note.status == NoteStatus.LOCKED:
        raise HTTPException(
            status_code=400,
            detail="This note is locked. Create an addendum instead."
        )

    # Save version snapshot before editing
    snapshot = _note_to_snapshot(note)
    version = NoteVersion(
        note_id=note.id,
        version_number=note.current_version,
        content_snapshot=snapshot,
        change_description=body.change_description,
        edited_by=current_user["user_id"],
    )
    db.add(version)

    # Apply edit
    if body.section in ["review_of_systems", "physical_examination"]:
        setattr(note, body.section, json.loads(body.content) if isinstance(body.content, str) else body.content)
    else:
        setattr(note, body.section, body.content)

    note.current_version += 1
    await db.flush()

    await audit_logger.log(
        db=db,
        action=audit_logger.NOTE_EDITED,
        resource_type="note",
        resource_id=note.id,
        user_id=current_user["user_id"],
        details={
            "section": body.section,
            "version": note.current_version,
        },
        ip_address=get_client_ip(request),
    )

    return _note_to_response(note)


# --- Sign-off ---

@router.post("/{encounter_id}/sign-off")
async def sign_off_note(
    encounter_id: str,
    body: NoteSignOffRequest,
    request: Request,
    current_user: dict = Depends(require_roles(["physician"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Sign off and lock a clinical note.
    Once signed, the note becomes read-only.
    """
    if not body.confirmation:
        raise HTTPException(
            status_code=400,
            detail="Sign-off requires explicit confirmation (confirmation=true)."
        )

    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="No note found.")

    if note.status == NoteStatus.LOCKED:
        raise HTTPException(status_code=400, detail="Note is already signed and locked.")

    now = datetime.now(timezone.utc)
    note.status = NoteStatus.SIGNED_OFF
    note.signed_off_at = now
    note.signed_off_by = current_user["user_id"]

    encounter.status = EncounterStatus.SIGNED_OFF
    encounter.signed_off_at = now

    # Lock after a final version snapshot
    snapshot = _note_to_snapshot(note)
    version = NoteVersion(
        note_id=note.id,
        version_number=note.current_version,
        content_snapshot=snapshot,
        change_description="Physician sign-off — note locked",
        edited_by=current_user["user_id"],
    )
    db.add(version)
    note.status = NoteStatus.LOCKED
    await db.flush()

    await audit_logger.log(
        db=db,
        action=audit_logger.NOTE_SIGNED_OFF,
        resource_type="note",
        resource_id=note.id,
        user_id=current_user["user_id"],
        details={"note_status": "locked"},
        ip_address=get_client_ip(request),
    )

    return {"status": "signed_off", "signed_off_at": now.isoformat()}


# --- PDF Export ---

@router.get("/{encounter_id}/export/pdf")
async def export_pdf(
    encounter_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(["physician", "admin"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Export the clinical note as a professionally formatted PDF.
    Single-click action — no multi-step wizard.
    """
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="No note found.")

    user = current_user["user"]
    patient_info = encounter_manager.decrypt_patient_info(encounter)

    note_dict = _note_to_snapshot(note)
    note_dict["ai_disclaimer"] = note.ai_disclaimer
    note_dict["signed_off_at"] = note.signed_off_at.isoformat() if note.signed_off_at else None
    note_dict["generated_at"] = note.generated_at.isoformat() if note.generated_at else None

    encounter_dict = {
        "encounter_id": encounter.encounter_id,
        "date": encounter.created_at.strftime("%Y-%m-%d"),
        "specialty_template": encounter.specialty_template,
        "duration_seconds": encounter.duration_seconds,
    }

    physician_dict = {
        "full_name": user.full_name,
        "credentials": user.credentials,
        "specialty": user.specialty,
        "institution": user.institution,
    }

    try:
        pdf_bytes = export_service.generate_pdf(
            note=note_dict,
            encounter=encounter_dict,
            physician=physician_dict,
            patient_info=patient_info,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail="PDF generation failed.")

    await audit_logger.log(
        db=db,
        action=audit_logger.PDF_EXPORTED,
        resource_type="note",
        resource_id=note.id,
        user_id=current_user["user_id"],
        details={"export_format": "pdf"},
        ip_address=get_client_ip(request),
    )

    filename = f"MedScribe_{encounter.encounter_id}_{encounter.created_at.strftime('%Y%m%d')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# --- Version History ---

@router.get("/{encounter_id}/note/versions")
async def get_note_versions(
    encounter_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get version history of a clinical note."""
    encounter = await _get_encounter_or_404(db, encounter_id, current_user["user_id"])
    result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.encounter_id == encounter.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="No note found.")

    versions_result = await db.execute(
        select(NoteVersion)
        .where(NoteVersion.note_id == note.id)
        .order_by(NoteVersion.version_number.desc())
    )
    versions = versions_result.scalars().all()

    return {
        "current_version": note.current_version,
        "versions": [
            {
                "version_number": v.version_number,
                "change_description": v.change_description,
                "edited_by": v.edited_by,
                "created_at": v.created_at.isoformat(),
            }
            for v in versions
        ]
    }


# --- Helpers ---

async def _get_encounter_or_404(db, encounter_id, user_id):
    try:
        return await encounter_manager.get_encounter(db, encounter_id, user_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Encounter not found.")


def _encounter_to_response(encounter: Encounter) -> EncounterResponse:
    return EncounterResponse(
        id=encounter.id,
        encounter_id=encounter.encounter_id,
        physician_id=encounter.physician_id,
        patient_name="[ENCRYPTED]",  # Never expose PHI in API responses
        status=encounter.status.value,
        specialty_template=encounter.specialty_template,
        spoken_language=encounter.spoken_language,
        output_language=encounter.output_language,
        duration_seconds=encounter.duration_seconds,
        consent_recorded=encounter.consent_recorded,
        created_at=encounter.created_at,
        updated_at=encounter.updated_at,
        signed_off_at=encounter.signed_off_at,
    )


def _note_to_response(note: ClinicalNote) -> ClinicalNoteResponse:
    return ClinicalNoteResponse(
        id=note.id,
        encounter_id=note.encounter_id,
        status=note.status.value,
        chief_complaint=note.chief_complaint,
        hpi=note.hpi,
        past_medical_history=note.past_medical_history,
        past_surgical_history=note.past_surgical_history or "",
        drug_history=note.drug_history or "",
        medications=note.medications,
        allergies=note.allergies,
        family_history=note.family_history,
        social_history=note.social_history,
        on_direct_questioning=note.on_direct_questioning or "",
        nutritional_history=note.nutritional_history or "",
        immunization_history=note.immunization_history or "",
        developmental_history=note.developmental_history or "",
        gynecological_history=note.gynecological_history or "",
        obstetric_history=note.obstetric_history or "",
        review_of_systems=note.review_of_systems or {},
        physical_examination=note.physical_examination or {},
        lab_investigations=note.lab_investigations or "",
        imaging_investigations=note.imaging_investigations or "",
        investigation_comments=note.investigation_comments or "",
        provisional_diagnosis=note.provisional_diagnosis or "",
        differential_diagnosis=note.differential_diagnosis or "",
        final_diagnosis=note.final_diagnosis or "",
        assessment=note.assessment,
        plan=note.plan,
        recommended_plan=note.recommended_plan or "",
        sbar_summary=note.sbar_summary or "",
        primary_survey=note.primary_survey or "",
        secondary_survey=note.secondary_survey or "",
        follow_up=note.follow_up,
        missing_sections=note.missing_sections or [],
        uncertain_fields=note.uncertain_fields or [],
        ai_generated=note.ai_generated,
        ai_disclaimer=note.ai_disclaimer,
        current_version=note.current_version,
        generated_at=note.generated_at,
        signed_off_at=note.signed_off_at,
    )


def _note_to_snapshot(note: ClinicalNote) -> dict:
    return {
        "chief_complaint": note.chief_complaint,
        "hpi": note.hpi,
        "past_medical_history": note.past_medical_history,
        "past_surgical_history": note.past_surgical_history or "",
        "drug_history": note.drug_history or "",
        "medications": note.medications,
        "allergies": note.allergies,
        "family_history": note.family_history,
        "social_history": note.social_history,
        "on_direct_questioning": note.on_direct_questioning or "",
        "nutritional_history": note.nutritional_history or "",
        "immunization_history": note.immunization_history or "",
        "developmental_history": note.developmental_history or "",
        "gynecological_history": note.gynecological_history or "",
        "obstetric_history": note.obstetric_history or "",
        "review_of_systems": note.review_of_systems,
        "physical_examination": note.physical_examination,
        "lab_investigations": note.lab_investigations or "",
        "imaging_investigations": note.imaging_investigations or "",
        "investigation_comments": note.investigation_comments or "",
        "provisional_diagnosis": note.provisional_diagnosis or "",
        "differential_diagnosis": note.differential_diagnosis or "",
        "final_diagnosis": note.final_diagnosis or "",
        "assessment": note.assessment,
        "plan": note.plan,
        "recommended_plan": note.recommended_plan or "",
        "sbar_summary": note.sbar_summary or "",
        "primary_survey": note.primary_survey or "",
        "secondary_survey": note.secondary_survey or "",
        "follow_up": note.follow_up,
        "missing_sections": note.missing_sections,
        "uncertain_fields": note.uncertain_fields,
    }
