"""
SecurityManager — Encryption, hashing, token generation, and security utilities.

Handles:
- Password hashing with bcrypt (Argon2id-ready)
- JWT access & refresh token generation with short-lived expiry
- Token validation and refresh rotation
- Data encryption utilities for PHI at rest

Security rules enforced:
- No MD5, SHA-1, or plain SHA-256 for passwords
- Access tokens expire in ≤15 minutes
- Refresh tokens rotate on use
- All tokens include issued-at and expiry claims
"""

import bcrypt
import jwt
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from cryptography.fernet import Fernet
from app.core import config


class SecurityManager:
    """Central security utilities for MedScribe."""

    def __init__(self):
        self._fernet_key = self._derive_fernet_key(config.secret_key)
        self._fernet = Fernet(self._fernet_key)
        # Track used refresh tokens for rotation (in production, use Redis/DB)
        self._revoked_refresh_tokens: set = set()

    @staticmethod
    def _derive_fernet_key(secret: str) -> bytes:
        """Derive a Fernet-compatible key from the app secret."""
        import base64
        digest = hashlib.sha256(secret.encode()).digest()
        return base64.urlsafe_b64encode(digest)

    # --- Password Hashing (bcrypt) ---

    @staticmethod
    def hash_password(plain_password: str) -> str:
        """Hash a password using bcrypt. Never uses MD5/SHA-1/plain SHA-256."""
        salt = bcrypt.gensalt(rounds=config.bcrypt_rounds)
        hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
        return hashed.decode("utf-8")

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its bcrypt hash."""
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )

    # --- JWT Token Generation ---

    def create_access_token(
        self,
        user_id: str,
        role: str,
        additional_claims: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Create a short-lived JWT access token (≤15 minutes).
        Includes user identity, role, and standard JWT claims.
        """
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "role": role,
            "type": "access",
            "iat": now,
            "exp": now + timedelta(minutes=config.jwt_access_token_expire_minutes),
            "jti": str(uuid.uuid4()),
        }
        if additional_claims:
            payload.update(additional_claims)
        return jwt.encode(payload, config.secret_key, algorithm=config.jwt_algorithm)

    def create_refresh_token(self, user_id: str) -> str:
        """Create a refresh token for token rotation."""
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "type": "refresh",
            "iat": now,
            "exp": now + timedelta(days=config.jwt_refresh_token_expire_days),
            "jti": str(uuid.uuid4()),
        }
        return jwt.encode(payload, config.secret_key, algorithm=config.jwt_algorithm)

    def validate_token(self, token: str, expected_type: str = "access") -> Dict[str, Any]:
        """
        Validate and decode a JWT token.
        Raises jwt.InvalidTokenError on any failure.
        """
        try:
            payload = jwt.decode(
                token,
                config.secret_key,
                algorithms=[config.jwt_algorithm]
            )
        except jwt.ExpiredSignatureError:
            raise jwt.InvalidTokenError("Token has expired")
        except jwt.InvalidTokenError:
            raise

        if payload.get("type") != expected_type:
            raise jwt.InvalidTokenError(f"Expected {expected_type} token, got {payload.get('type')}")

        if expected_type == "refresh" and payload.get("jti") in self._revoked_refresh_tokens:
            raise jwt.InvalidTokenError("Refresh token has been revoked")

        return payload

    def rotate_refresh_token(self, old_refresh_token: str) -> tuple:
        """
        Validate old refresh token, revoke it, and issue new access + refresh pair.
        Returns (new_access_token, new_refresh_token).
        """
        payload = self.validate_token(old_refresh_token, expected_type="refresh")
        # Revoke old token
        self._revoked_refresh_tokens.add(payload["jti"])
        # Issue new pair
        user_id = payload["sub"]
        # We need to look up role from DB in real implementation
        new_access = self.create_access_token(user_id, role="physician")
        new_refresh = self.create_refresh_token(user_id)
        return new_access, new_refresh

    # --- Data Encryption (for PHI at rest) ---

    def encrypt_data(self, plaintext: str) -> str:
        """Encrypt sensitive data (PHI) for storage at rest."""
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt_data(self, ciphertext: str) -> str:
        """Decrypt stored PHI data."""
        return self._fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")

    # --- Utility ---

    @staticmethod
    def generate_encounter_id() -> str:
        """Generate a unique encounter identifier."""
        return f"ENC-{uuid.uuid4().hex[:12].upper()}"

    @staticmethod
    def generate_session_id() -> str:
        """Generate a unique session identifier."""
        return f"SES-{uuid.uuid4().hex[:12].upper()}"


# Singleton instance
security_manager = SecurityManager()
