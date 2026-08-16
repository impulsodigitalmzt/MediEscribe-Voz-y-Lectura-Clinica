"""
ConsentManager — Consent capture, verification, and audit trail.

Rules:
- Every encounter MUST have consent recorded before recording begins
- Consent status is auditable
- Consent cannot be retroactively created for past encounters
"""

from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import ConsentRecord, Encounter
from app.services.audit_logger import audit_logger
import logging

logger = logging.getLogger(__name__)


class ConsentError(Exception):
    pass


class ConsentManager:
    """Manages consent capture and verification for clinical encounters."""

    async def record_consent(
        self,
        db: AsyncSession,
        encounter_id: str,
        consent_type: str,
        consented: bool,
        consented_by: str,
        recorded_by_user_id: str,
        ip_address: str = ""
    ) -> ConsentRecord:
        """Record consent for an encounter."""
        # Verify encounter exists
        result = await db.execute(
            select(Encounter).where(Encounter.id == encounter_id)
        )
        encounter = result.scalar_one_or_none()
        if not encounter:
            raise ConsentError("Encounter not found.")

        record = ConsentRecord(
            encounter_id=encounter_id,
            consent_type=consent_type,
            consented=consented,
            consented_by=consented_by,
            recorded_by=recorded_by_user_id,
            timestamp=datetime.now(timezone.utc)
        )
        db.add(record)

        # Update encounter consent flag
        if consented and consent_type == "recording":
            encounter.consent_recorded = True

        await db.flush()

        # Audit log
        await audit_logger.log(
            db=db,
            action=audit_logger.CONSENT_RECORDED,
            resource_type="encounter",
            resource_id=encounter_id,
            user_id=recorded_by_user_id,
            details={"consent_type": consent_type},
            ip_address=ip_address
        )

        return record

    async def verify_consent(
        self,
        db: AsyncSession,
        encounter_id: str,
        consent_type: str = "recording"
    ) -> bool:
        """Verify that valid consent exists for an encounter."""
        result = await db.execute(
            select(ConsentRecord).where(
                ConsentRecord.encounter_id == encounter_id,
                ConsentRecord.consent_type == consent_type,
                ConsentRecord.consented == True
            )
        )
        return result.scalar_one_or_none() is not None

    async def get_consent_records(
        self,
        db: AsyncSession,
        encounter_id: str
    ) -> list:
        """Get all consent records for an encounter."""
        result = await db.execute(
            select(ConsentRecord)
            .where(ConsentRecord.encounter_id == encounter_id)
            .order_by(ConsentRecord.timestamp.desc())
        )
        return list(result.scalars().all())


consent_manager = ConsentManager()
