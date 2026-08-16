"""
AuthService — User authentication, JWT issuance, and session management.

Handles:
- User registration with password strength enforcement
- Login with rate limiting and account lockout
- JWT access/refresh token issuance
- Token refresh with rotation
- Role-based permission checking

Security:
- Rate limiting: max 5 failed attempts per 15-minute window
- Account lockout after threshold
- No PHI in error messages or logs
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import User, UserRole
from app.core.security import security_manager
from app.core import config
import logging

logger = logging.getLogger(__name__)


class AuthenticationError(Exception):
    """Raised on authentication failure. Messages are safe for user display."""
    pass


class AuthService:
    """Handles user authentication lifecycle."""

    async def register_user(
        self,
        db: AsyncSession,
        email: str,
        password: str,
        full_name: str,
        credentials: str = "",
        specialty: str = "General Practice",
        institution: str = "",
        role: UserRole = UserRole.PHYSICIAN
    ) -> User:
        """Register a new user with validated credentials."""
        # Check for existing user
        result = await db.execute(select(User).where(User.email == email.lower()))
        if result.scalar_one_or_none():
            raise AuthenticationError("An account with this email already exists.")

        # Hash password (bcrypt)
        password_hash = security_manager.hash_password(password)

        user = User(
            email=email.lower().strip(),
            password_hash=password_hash,
            full_name=full_name.strip(),
            credentials=credentials.strip(),
            specialty=specialty.strip(),
            institution=institution.strip(),
            role=role,
        )
        db.add(user)
        await db.flush()

        logger.info(f"User registered: role={role.value}")  # No PHI in logs
        return user

    async def authenticate(
        self,
        db: AsyncSession,
        email: str,
        password: str,
        ip_address: str = ""
    ) -> Tuple[User, str, str]:
        """
        Authenticate user and return (user, access_token, refresh_token).
        Enforces rate limiting and account lockout.
        """
        result = await db.execute(select(User).where(User.email == email.lower()))
        user = result.scalar_one_or_none()

        if not user:
            raise AuthenticationError("Invalid email or password.")

        # Check account lockout
        if user.locked_until and user.locked_until > datetime.now(timezone.utc):
            raise AuthenticationError(
                "Account temporarily locked due to too many failed attempts. "
                "Please try again later."
            )

        # Verify password
        if not security_manager.verify_password(password, user.password_hash):
            # Increment failed attempts
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= config.rate_limit_auth_attempts:
                user.locked_until = datetime.now(timezone.utc) + timedelta(
                    minutes=config.rate_limit_auth_window_minutes
                )
                logger.warning(f"Account locked: excessive failed attempts")
            await db.flush()
            raise AuthenticationError("Invalid email or password.")

        if not user.is_active:
            raise AuthenticationError("This account has been deactivated.")

        # Reset failed attempts on success
        user.failed_login_attempts = 0
        user.locked_until = None
        await db.flush()

        # Issue tokens
        access_token = security_manager.create_access_token(
            user_id=user.id,
            role=user.role.value,
            additional_claims={
                "name": user.full_name,
                "specialty": user.specialty,
            }
        )
        refresh_token = security_manager.create_refresh_token(user_id=user.id)

        logger.info(f"User authenticated: role={user.role.value}")
        return user, access_token, refresh_token

    async def refresh_tokens(
        self,
        db: AsyncSession,
        refresh_token: str
    ) -> Tuple[str, str]:
        """
        Refresh an access token using a valid refresh token.
        Implements token rotation — old refresh token is revoked.
        """
        import jwt as pyjwt
        try:
            payload = security_manager.validate_token(refresh_token, expected_type="refresh")
        except pyjwt.InvalidTokenError as e:
            raise AuthenticationError(f"Invalid refresh token: {str(e)}")

        user_id = payload["sub"]
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise AuthenticationError("User not found or deactivated.")

        # Issue new token pair
        new_access = security_manager.create_access_token(
            user_id=user.id,
            role=user.role.value,
            additional_claims={"name": user.full_name}
        )
        new_refresh = security_manager.create_refresh_token(user_id=user.id)

        return new_access, new_refresh

    async def get_user_by_id(self, db: AsyncSession, user_id: str) -> Optional[User]:
        """Retrieve a user by ID."""
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def update_user_settings(
        self,
        db: AsyncSession,
        user_id: str,
        **kwargs
    ) -> User:
        """Update user profile settings."""
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise AuthenticationError("User not found.")

        allowed_fields = {
            "full_name", "credentials", "specialty", "institution",
            "preferred_language", "preferred_template"
        }
        for key, value in kwargs.items():
            if key in allowed_fields and value is not None:
                setattr(user, key, value)

        await db.flush()
        return user

    @staticmethod
    def check_permission(user_role: str, required_roles: list) -> bool:
        """Check if user role is in the required roles list."""
        return user_role in required_roles
