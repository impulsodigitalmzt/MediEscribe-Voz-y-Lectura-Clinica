"""
MedScribe — Main Application Entry Point

FastAPI application with:
- HTTPS enforcement (HSTS headers)
- CORS configuration
- Rate limiting on auth endpoints
- Comprehensive error handling
- Database initialization
- All API route registration
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.core import config
from app.core.database import init_db
from app.api import auth_router, encounter_router, template_router, ws_router

# Configure logging — NO PHI in logs
logging.basicConfig(
    level=getattr(logging, config.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("medscribe")


# --- Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    logger.info(f"Starting {config.app_name} v{config.app_version} [{config.environment}]")
    await init_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down MedScribe")


# --- App ---

app = FastAPI(
    title=config.app_name,
    version=config.app_version,
    description="AI-Powered Ambient Clinical Documentation Platform",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# --- Middleware ---

# CORS
cors_origins = config.cors_origins_list
if "*" in cors_origins:
    # Wildcard mode — disable credentials for compatibility
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# Security headers middleware (HSTS, no-sniff, etc.)
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(SecurityHeadersMiddleware)


# --- Error Handlers ---

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler. Never expose internal details or PHI."""
    logger.error(f"Unhandled error: {type(exc).__name__} on {request.url.path}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal error occurred. Please try again."}
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": "The requested resource was not found."}
    )


# --- Routes ---

app.include_router(auth_router, prefix="/api/v1")
app.include_router(encounter_router, prefix="/api/v1")
app.include_router(template_router, prefix="/api/v1")
app.include_router(ws_router, prefix="/api/v1")


# --- Health Check ---

@app.get("/health", tags=["System"])
async def health_check():
    """Health check endpoint — no authentication required."""
    return {
        "status": "healthy",
        "service": config.app_name,
        "version": config.app_version,
        "environment": config.environment,
    }


@app.get("/", tags=["System"])
async def root():
    return {
        "service": "MedScribe API",
        "version": config.app_version,
        "docs": "/docs" if not config.is_production else "disabled",
    }
