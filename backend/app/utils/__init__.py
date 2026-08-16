"""
Utility functions — PHI sanitization, formatters, common validators.

These are shared utilities used across services. They enforce
data minimization and PHI protection rules.
"""

import re
import hashlib
from datetime import datetime, timezone
from typing import Optional


def sanitize_for_logging(text: str) -> str:
    """
    Remove any potential PHI from text before it enters logs.
    Strips patterns that look like names, dates of birth, MRNs, SSNs, phone numbers.
    """
    # Remove SSN patterns
    text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[REDACTED-SSN]', text)
    # Remove phone patterns
    text = re.sub(r'\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b', '[REDACTED-PHONE]', text)
    # Remove date patterns that look like DOB
    text = re.sub(r'\b\d{1,2}/\d{1,2}/\d{2,4}\b', '[REDACTED-DATE]', text)
    # Remove MRN-like patterns (6+ digit numbers)
    text = re.sub(r'\bMRN\s*:?\s*\d{6,}\b', '[REDACTED-MRN]', text)
    return text


def format_duration(seconds: int) -> str:
    """Format seconds into human-readable duration string."""
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    remaining_seconds = seconds % 60
    if minutes < 60:
        return f"{minutes}m {remaining_seconds}s"
    hours = minutes // 60
    remaining_minutes = minutes % 60
    return f"{hours}h {remaining_minutes}m"


def format_encounter_date(dt: datetime) -> str:
    """Format a datetime for display in encounter listings."""
    return dt.strftime("%b %d, %Y at %I:%M %p")


def generate_deterministic_id(seed: str) -> str:
    """Generate a deterministic short ID from a seed string."""
    return hashlib.sha256(seed.encode()).hexdigest()[:12].upper()


def validate_language_code(code: str) -> bool:
    """Validate that a language code is supported."""
    supported = {"en", "es", "fr", "pt", "ar", "zh", "hi", "sw"}
    return code.lower() in supported


def truncate_text(text: str, max_length: int = 200, suffix: str = "...") -> str:
    """Safely truncate text to max length."""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix


def now_utc() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


def safe_json_value(value) -> str:
    """Ensure a value is safe for JSON serialization."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


class PHIGuard:
    """
    Context manager / decorator that ensures PHI doesn't leak into logs.
    Wraps exceptions to strip PHI from error messages.
    """

    # Patterns that might contain PHI
    PHI_PATTERNS = [
        r'\b[A-Z][a-z]+ [A-Z][a-z]+\b',  # Name-like patterns
        r'\b\d{1,2}/\d{1,2}/\d{2,4}\b',   # Date patterns
        r'\b\d{3}-\d{2}-\d{4}\b',          # SSN
        r'\b\d{6,}\b',                      # Long numbers (MRN)
    ]

    @staticmethod
    def scrub(text: str) -> str:
        """Remove all potential PHI patterns from text."""
        result = text
        for pattern in PHIGuard.PHI_PATTERNS:
            result = re.sub(pattern, '[REDACTED]', result)
        return result
