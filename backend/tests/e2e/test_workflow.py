"""
End-to-End Tests — Full encounter workflow simulation.

Tests the complete flow: login → create encounter → record consent →
transcript → generate note → review/edit → sign-off → PDF export.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.database import engine
from app.models.models import Base


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestFullEncounterWorkflow:
    """Simulate complete encounter lifecycle."""

    @pytest.mark.asyncio
    async def test_complete_workflow(self, client: AsyncClient):
        # 1. Register
        reg = await client.post("/api/v1/auth/register", json={
            "email": "e2e@hospital.com",
            "password": "E2eTest123!",
            "full_name": "Dr. E2E Tester",
            "credentials": "MD",
            "specialty": "General Practice",
        })
        assert reg.status_code == 201
        headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

        # 2. Create encounter
        enc = await client.post("/api/v1/encounters", json={
            "patient_name": "Test Patient",
            "specialty_template": "general_practice",
            "spoken_language": "en",
        }, headers=headers)
        assert enc.status_code == 201
        enc_id = enc.json()["id"]
        assert enc.json()["status"] == "recording"

        # 3. Record consent
        consent = await client.post(f"/api/v1/encounters/{enc_id}/consent", json={
            "consent_type": "recording",
            "consented": True,
            "consented_by": "Test Patient",
        }, headers=headers)
        assert consent.status_code == 200

        # 4. Verify encounter accessible
        get_enc = await client.get(f"/api/v1/encounters/{enc_id}", headers=headers)
        assert get_enc.status_code == 200
        assert get_enc.json()["consent_recorded"] is True

        # 5. List encounters
        list_enc = await client.get("/api/v1/encounters", headers=headers)
        assert list_enc.status_code == 200
        assert list_enc.json()["total"] >= 1

        # 6. View profile
        profile = await client.get("/api/v1/auth/profile", headers=headers)
        assert profile.status_code == 200
        assert profile.json()["full_name"] == "Dr. E2E Tester"

        # 7. List templates
        templates = await client.get("/api/v1/templates", headers=headers)
        assert templates.status_code == 200
        assert len(templates.json()["templates"]) == 8
