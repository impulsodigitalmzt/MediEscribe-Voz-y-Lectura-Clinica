#!/usr/bin/env python3
"""
Database initialization script.
Creates all tables and optionally seeds with demo data.

Usage:
  python scripts/init_db.py          # Create tables only
  python scripts/init_db.py --seed   # Create tables + demo data
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.core.database import engine, init_db
from app.models.models import Base


async def main():
    print("MedScribe Database Initialization")
    print("=" * 40)

    print("Creating tables...")
    await init_db()
    print("Tables created successfully.")

    if "--seed" in sys.argv:
        print("\nSeeding demo data...")
        await seed_demo_data()
        print("Demo data seeded.")

    print("\nDone.")


async def seed_demo_data():
    """Create demo user for development."""
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.core.database import async_session_factory
    from app.services.auth_service import AuthService

    auth = AuthService()

    async with async_session_factory() as db:
        try:
            user = await auth.register_user(
                db=db,
                email="demo@medscribe.dev",
                password="DemoPass123!",
                full_name="Dr. Demo User",
                credentials="MD, FACP",
                specialty="General Practice",
                institution="MedScribe Demo Hospital",
            )
            await db.commit()
            print(f"  Created demo user: demo@medscribe.dev / DemoPass123!")
        except Exception as e:
            print(f"  Demo user may already exist: {e}")


if __name__ == "__main__":
    asyncio.run(main())
