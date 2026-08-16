"""
Auth API Routes — Registration, login, token refresh, and profile management.

All authentication endpoints enforce rate limiting.
No PHI in error messages or log output.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core import config
from app.schemas import (
    UserRegisterRequest, UserLoginRequest, TokenResponse,
    RefreshTokenRequest, UserProfileResponse, UserSettingsUpdate,
    ErrorResponse
)
from app.services.auth_service import AuthService, AuthenticationError
from app.services.audit_logger import audit_logger
from app.api.dependencies import get_current_user, get_client_ip, get_user_agent

router = APIRouter(prefix="/auth", tags=["Authentication"])
auth_service = AuthService()


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": ErrorResponse}, 409: {"model": ErrorResponse}}
)
async def register(
    request: Request,
    body: UserRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """Register a new physician account."""
    try:
        user = await auth_service.register_user(
            db=db,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            credentials=body.credentials,
            specialty=body.specialty,
            institution=body.institution,
        )
    except AuthenticationError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        import logging
        logging.getLogger("medscribe").error(f"Registration error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Registration failed: {type(e).__name__}")

    # Log registration
    await audit_logger.log(
        db=db,
        action=audit_logger.USER_REGISTER,
        resource_type="user",
        resource_id=user.id,
        user_id=user.id,
        details={"role": user.role.value},
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request)
    )

    # Auto-login after registration
    from app.core.security import security_manager
    access_token = security_manager.create_access_token(
        user_id=user.id,
        role=user.role.value,
        additional_claims={"name": user.full_name, "specialty": user.specialty}
    )
    refresh_token = security_manager.create_refresh_token(user_id=user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=config.jwt_access_token_expire_minutes * 60
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}}
)
async def login(
    request: Request,
    body: UserLoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Authenticate and receive access + refresh tokens."""
    try:
        user, access_token, refresh_token = await auth_service.authenticate(
            db=db,
            email=body.email,
            password=body.password,
            ip_address=get_client_ip(request)
        )
    except AuthenticationError as e:
        # Log failed attempt
        await audit_logger.log(
            db=db,
            action=audit_logger.USER_LOGIN_FAILED,
            resource_type="user",
            details={"error_type": "auth_failed"},
            ip_address=get_client_ip(request),
            user_agent=get_user_agent(request)
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

    # Log success
    await audit_logger.log(
        db=db,
        action=audit_logger.USER_LOGIN,
        resource_type="user",
        resource_id=user.id,
        user_id=user.id,
        details={"role": user.role.value},
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request)
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=config.jwt_access_token_expire_minutes * 60
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}}
)
async def refresh_token(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
):
    """Refresh access token using a valid refresh token."""
    try:
        new_access, new_refresh = await auth_service.refresh_tokens(
            db=db,
            refresh_token=body.refresh_token
        )
    except AuthenticationError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        expires_in=config.jwt_access_token_expire_minutes * 60
    )


@router.get(
    "/profile",
    response_model=UserProfileResponse,
    responses={401: {"model": ErrorResponse}}
)
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get the current user's profile."""
    user = current_user["user"]
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        credentials=user.credentials,
        specialty=user.specialty,
        institution=user.institution,
        role=user.role.value,
        preferred_language=user.preferred_language,
        preferred_template=user.preferred_template,
    )


@router.patch(
    "/profile",
    response_model=UserProfileResponse,
    responses={401: {"model": ErrorResponse}}
)
async def update_profile(
    request: Request,
    body: UserSettingsUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user profile settings."""
    user = await auth_service.update_user_settings(
        db=db,
        user_id=current_user["user_id"],
        **body.model_dump(exclude_none=True)
    )

    await audit_logger.log(
        db=db,
        action=audit_logger.USER_SETTINGS_UPDATED,
        resource_type="user",
        resource_id=current_user["user_id"],
        user_id=current_user["user_id"],
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request)
    )

    return UserProfileResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        credentials=user.credentials,
        specialty=user.specialty,
        institution=user.institution,
        role=user.role.value,
        preferred_language=user.preferred_language,
        preferred_template=user.preferred_template,
    )
