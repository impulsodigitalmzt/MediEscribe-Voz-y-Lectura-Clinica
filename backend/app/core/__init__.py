"""
AppConfig — Centralized configuration management from environment variables.

All application settings are loaded from environment variables with sensible
defaults for development. In production, every secret MUST be set explicitly.
No secrets are ever hardcoded or committed to source control.
"""

from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from typing import List
import os


class AppConfig(BaseSettings):
    """Centralized configuration loaded from environment variables."""

    # --- Application ---
    app_name: str = "MedScribe"
    app_version: str = "1.0.0"
    environment: str = Field(default="development", description="development | staging | production")
    debug: bool = Field(default=False, description="Enable debug mode (NEVER in production)")
    log_level: str = "INFO"

    # --- Security ---
    secret_key: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-USE-64-RANDOM-CHARS",
        description="Secret key for JWT signing and encryption"
    )
    jwt_access_token_expire_minutes: int = Field(default=15, le=30, description="Max 30 minutes per spec")
    jwt_refresh_token_expire_days: int = Field(default=7)
    jwt_algorithm: str = "HS256"
    bcrypt_rounds: int = Field(default=12, ge=10, le=16)

    # --- Database ---
    database_url: str = Field(default="sqlite+aiosqlite:///./medscribe.db")

    # --- Anthropic Claude API ---
    anthropic_api_key: str = Field(default="", description="Anthropic API key for Claude")
    claude_model: str = "claude-sonnet-4-5"
    claude_max_tokens: int = 16000

    # --- Transcription ---
    transcription_api_url: str = ""
    transcription_api_key: str = ""
    transcription_model: str = "whisper-1"

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # --- Rate Limiting ---
    rate_limit_auth_attempts: int = 5
    rate_limit_auth_window_minutes: int = 15

    # --- Data Retention ---
    data_retention_days: int = 365
    audit_log_retention_days: int = 2555  # ~7 years

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if v == "CHANGE-ME-IN-PRODUCTION-USE-64-RANDOM-CHARS":
            env = os.getenv("ENVIRONMENT", "development")
            if env == "production":
                raise ValueError("SECRET_KEY must be changed in production!")
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


# Singleton instance
config = AppConfig()
