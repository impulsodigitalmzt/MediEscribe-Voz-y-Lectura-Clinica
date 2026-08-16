"""
API Dependencies — Authentication middleware, RBAC, and request context.

Every API endpoint is protected by JWT authentication and role-based
access control. No unprotected endpoints exist for data operations.
"""

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
import jwt as pyjwt
from typing import List, Optional
from app.core.security import security_manager
from app.core.database import get_db
from app.services.auth_service import AuthService


security_scheme = HTTPBearer()
auth_service = AuthService()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Extract and validate the current user from the JWT token.
    Returns a dict with user info from the token payload.
    """
    token = credentials.credentials
    try:
        payload = security_manager.validate_token(token, expected_type="access")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify user still exists and is active
    user = await auth_service.get_user_by_id(db, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found or deactivated.",
        )

    return {
        "user_id": payload["sub"],
        "role": payload["role"],
        "name": payload.get("name", ""),
        "user": user,
    }


def require_roles(allowed_roles: List[str]):
    """
    Dependency factory for role-based access control.
    Usage: Depends(require_roles(["physician", "admin"]))
    """
    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action.",
            )
        return current_user
    return role_checker


def get_client_ip(request: Request) -> str:
    """Extract client IP address from request."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def get_user_agent(request: Request) -> str:
    """Extract user agent from request."""
    return request.headers.get("User-Agent", "")[:255]
