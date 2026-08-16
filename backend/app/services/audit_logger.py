"""
AuditLogger — Append-only logging of all system events and data access.

Rules:
- Every data access, modification, export, and deletion is logged
- Logs include: user identity, timestamp, action, data affected
- Audit logs are append-only and immutable
- No user (including admins) may modify or delete audit entries
- No PHI is stored in audit log details
"""

from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog
import logging

logger = logging.getLogger(__name__)


class AuditLogger:
    """Append-only, immutable audit trail for all system events."""

    # Action constants
    USER_LOGIN = "user.login"
    USER_LOGOUT = "user.logout"
    USER_REGISTER = "user.register"
    USER_LOGIN_FAILED = "user.login_failed"
    USER_LOCKED = "user.locked"
    USER_SETTINGS_UPDATED = "user.settings_updated"

    ENCOUNTER_CREATED = "encounter.created"
    ENCOUNTER_RECORDING_STARTED = "encounter.recording_started"
    ENCOUNTER_RECORDING_PAUSED = "encounter.recording_paused"
    ENCOUNTER_RECORDING_RESUMED = "encounter.recording_resumed"
    ENCOUNTER_RECORDING_STOPPED = "encounter.recording_stopped"
    ENCOUNTER_DELETED = "encounter.deleted"

    NOTE_GENERATED = "note.generated"
    NOTE_EDITED = "note.edited"
    NOTE_SIGNED_OFF = "note.signed_off"
    NOTE_VERSION_CREATED = "note.version_created"
    NOTE_AMENDED = "note.amended"

    CONSENT_RECORDED = "consent.recorded"
    CONSENT_REVOKED = "consent.revoked"

    PDF_EXPORTED = "pdf.exported"

    DATA_ACCESSED = "data.accessed"
    DATA_DELETED = "data.deleted"
    DATA_EXPORTED = "data.exported"

    async def log(
        self,
        db: AsyncSession,
        action: str,
        resource_type: str,
        resource_id: str = None,
        user_id: str = None,
        details: dict = None,
        ip_address: str = "",
        user_agent: str = ""
    ) -> AuditLog:
        """
        Write an immutable audit log entry.
        Details dict must NEVER contain PHI.
        """
        # Sanitize details to prevent PHI leakage
        safe_details = self._sanitize_details(details or {})

        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=safe_details,
            ip_address=ip_address,
            user_agent=user_agent[:255] if user_agent else "",
            timestamp=datetime.now(timezone.utc)
        )
        db.add(entry)
        await db.flush()

        logger.info(
            f"AUDIT: action={action} resource={resource_type}/{resource_id} "
            f"user={user_id or 'system'}"
        )
        return entry

    @staticmethod
    def _sanitize_details(details: dict) -> dict:
        """
        Remove any potential PHI from audit log details.
        Only allows known-safe keys through.
        """
        safe_keys = {
            "section", "version", "status", "action_type", "template",
            "language", "export_format", "consent_type", "role",
            "error_type", "duration_seconds", "sections_modified",
            "missing_sections_count", "note_status", "encounter_status"
        }
        return {k: v for k, v in details.items() if k in safe_keys}


# Singleton
audit_logger = AuditLogger()
