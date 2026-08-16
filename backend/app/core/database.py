"""
Database connection and session management.
Supports both PostgreSQL (production) and SQLite (development).
Uses async SQLAlchemy for non-blocking database operations.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core import config
from app.models.models import Base


def get_async_database_url(url: str) -> str:
    """Convert a database URL to its async driver equivalent."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql+asyncpg://"):
        return url
    elif url.startswith("sqlite"):
        if "+aiosqlite" not in url:
            return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
        return url
    return url


async_url = get_async_database_url(config.database_url)

engine = create_async_engine(
    async_url,
    echo=config.debug and not config.is_production,
    future=True,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def init_db():
    """Create all tables on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """Dependency injection for database sessions."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
