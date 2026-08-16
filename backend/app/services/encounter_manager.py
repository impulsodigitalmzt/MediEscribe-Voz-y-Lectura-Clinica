"""
EncounterSessionManager — Lifecycle management for active clinical encounters.

Handles:
- Creating new encounters with unique IDs
- Start/stop/pause/resume recording state transitions
- Encounter status management through the full workflow
- Patient demographic capture (encrypted at rest)
- Duration tracking
- Encounter listing, filtering, and retrieval
"""

from datetime import datetime, timezone
from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from app.models import Encounter, EncounterStatus, ClinicalNote, NoteStatus
from app.core.security import security_manager
from app.services.audit_logger import audit_logger
import logging

logger = logging.getLogger(__name__)


class EncounterError(Exception):
    pass


class EncounterSessionManager:
    """Manages the full lifecycle of clinical encounter sessions."""

    VALID_TRANSITIONS = {
        EncounterStatus.RECORDING: [EncounterStatus.PAUSED, EncounterStatus.TRANSCRIBING],
        EncounterStatus.PAUSED: [EncounterStatus.RECORDING, EncounterStatus.TRANSCRIBING],
        EncounterStatus.TRANSCRIBING: [EncounterStatus.GENERATING_NOTE],
        EncounterStatus.GENERATING_NOTE: [EncounterStatus.PENDING_REVIEW],
        EncounterStatus.PENDING_REVIEW: [EncounterStatus.SIGNED_OFF, EncounterStatus.GENERATING_NOTE],
        EncounterStatus.SIGNED_OFF: [EncounterStatus.AMENDED],
        EncounterStatus.AMENDED: [],
    }

    async def create_encounter(
        self,
        db: AsyncSession,
        physician_id: str,
        patient_name: str = "",
        patient_dob: str = "",
        patient_mrn: str = "",
        specialty_template: str = "general_practice",
        spoken_language: str = "en",
        output_language: str = "en",
        ip_address: str = ""
    ) -> Encounter:
        """Create a new clinical encounter session."""
        encounter_id = security_manager.generate_encounter_id()

        # Encrypt PHI fields
        encrypted_name = security_manager.encrypt_data(patient_name) if patient_name else ""
        encrypted_dob = security_manager.encrypt_data(patient_dob) if patient_dob else ""
        encrypted_mrn = security_manager.encrypt_data(patient_mrn) if patient_mrn else ""

        encounter = Encounter(
            encounter_id=encounter_id,
            physician_id=physician_id,
            patient_name=encrypted_name,
            patient_dob=encrypted_dob,
            patient_mrn=encrypted_mrn,
            status=EncounterStatus.RECORDING,
            specialty_template=specialty_template,
            spoken_language=spoken_language,
            output_language=output_language,
        )
        db.add(encounter)
        await db.flush()

        await audit_logger.log(
            db=db,
            action=audit_logger.ENCOUNTER_CREATED,
            resource_type="encounter",
            resource_id=encounter.id,
            user_id=physician_id,
            details={"template": specialty_template, "language": spoken_language},
            ip_address=ip_address
        )

        logger.info(f"Encounter created: {encounter_id}")
        return encounter

    async def get_encounter(
        self,
        db: AsyncSession,
        encounter_db_id: str,
        physician_id: str
    ) -> Encounter:
        """Retrieve an encounter, verifying ownership."""
        result = await db.execute(
            select(Encounter).where(
                Encounter.id == encounter_db_id,
                Encounter.physician_id == physician_id
            )
        )
        encounter = result.scalar_one_or_none()
        if not encounter:
            raise EncounterError("Encounter not found or access denied.")
        return encounter

    async def get_encounter_by_eid(
        self,
        db: AsyncSession,
        encounter_id: str,
        physician_id: str
    ) -> Encounter:
        """Retrieve by human-readable encounter ID (ENC-XXXX)."""
        result = await db.execute(
            select(Encounter).where(
                Encounter.encounter_id == encounter_id,
                Encounter.physician_id == physician_id
            )
        )
        encounter = result.scalar_one_or_none()
        if not encounter:
            raise EncounterError("Encounter not found or access denied.")
        return encounter

    async def transition_status(
        self,
        db: AsyncSession,
        encounter: Encounter,
        new_status: EncounterStatus,
        user_id: str,
        ip_address: str = ""
    ) -> Encounter:
        """Transition encounter to a new status with validation."""
        allowed = self.VALID_TRANSITIONS.get(encounter.status, [])
        if new_status not in allowed:
            raise EncounterError(
                f"Cannot transition from {encounter.status.value} to {new_status.value}."
            )

        old_status = encounter.status
        encounter.status = new_status
        encounter.updated_at = datetime.now(timezone.utc)

        if new_status == EncounterStatus.SIGNED_OFF:
            encounter.signed_off_at = datetime.now(timezone.utc)

        await db.flush()

        action_map = {
            EncounterStatus.RECORDING: audit_logger.ENCOUNTER_RECORDING_STARTED,
            EncounterStatus.PAUSED: audit_logger.ENCOUNTER_RECORDING_PAUSED,
        }
        action = action_map.get(new_status, f"encounter.status_changed")

        await audit_logger.log(
            db=db,
            action=action,
            resource_type="encounter",
            resource_id=encounter.id,
            user_id=user_id,
            details={"status": new_status.value, "encounter_status": old_status.value},
            ip_address=ip_address
        )

        return encounter

    async def update_duration(
        self,
        db: AsyncSession,
        encounter: Encounter,
        duration_seconds: int
    ) -> None:
        """Update the encounter duration."""
        encounter.duration_seconds = duration_seconds
        await db.flush()

    async def list_encounters(
        self,
        db: AsyncSession,
        physician_id: str,
        status_filter: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        search_query: Optional[str] = None
    ) -> Tuple[List[Encounter], int]:
        """List encounters for a physician with filtering and pagination."""
        query = select(Encounter).where(Encounter.physician_id == physician_id)

        if status_filter:
            query = query.where(Encounter.status == status_filter)

        # Count total
        count_query = select(func.count()).select_from(
            query.subquery()
        )
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # Apply pagination and ordering
        query = query.order_by(desc(Encounter.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await db.execute(query)
        encounters = list(result.scalars().all())

        return encounters, total

    def decrypt_patient_info(self, encounter: Encounter) -> dict:
        """Decrypt patient demographic fields for display."""
        return {
            "patient_name": security_manager.decrypt_data(encounter.patient_name) if encounter.patient_name else "",
            "patient_dob": security_manager.decrypt_data(encounter.patient_dob) if encounter.patient_dob else "",
            "patient_mrn": security_manager.decrypt_data(encounter.patient_mrn) if encounter.patient_mrn else "",
        }


encounter_manager = EncounterSessionManager()
