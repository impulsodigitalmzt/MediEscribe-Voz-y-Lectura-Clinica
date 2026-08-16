"""
Integration Tests — API endpoint testing with realistic payloads.

Verifies authentication enforcement, RBAC, input validation,
and correct response schemas.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.database import engine, init_db
from app.models.models import Base


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create fresh database for each test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    """Async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient):
    """Register a user and return auth headers."""
    response = await client.post("/api/v1/auth/register", json={
        "email": "test@hospital.com",
        "password": "TestPass123!",
        "full_name": "Dr. Test User",
        "credentials": "MD",
        "specialty": "General Practice",
        "institution": "Test Hospital"
    })
    assert response.status_code == 201
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestHealthEndpoint:
    """Health check requires no auth."""

    @pytest.mark.asyncio
    async def test_health(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "MedScribe"


class TestAuthEndpoints:
    """Test registration, login, and token management."""

    @pytest.mark.asyncio
    async def test_register_success(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/register", json={
            "email": "new@hospital.com",
            "password": "NewPass123!",
            "full_name": "Dr. New User",
        })
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/auth/register", json={
            "email": "test@hospital.com",
            "password": "AnotherPass1!",
            "full_name": "Duplicate User",
        })
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_register_weak_password(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/register", json={
            "email": "weak@hospital.com",
            "password": "weak",
            "full_name": "Weak Password User",
        })
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/auth/login", json={
            "email": "test@hospital.com",
            "password": "TestPass123!",
        })
        assert response.status_code == 200
        assert "access_token" in response.json()

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/auth/login", json={
            "email": "test@hospital.com",
            "password": "WrongPassword1!",
        })
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_profile_requires_auth(self, client: AsyncClient):
        response = await client.get("/api/v1/auth/profile")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_profile_with_auth(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/auth/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@hospital.com"
        assert data["full_name"] == "Dr. Test User"
        assert data["role"] == "physician"


class TestEncounterEndpoints:
    """Test encounter creation and management."""

    @pytest.mark.asyncio
    async def test_create_encounter(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/encounters", json={
            "patient_name": "John Doe",
            "specialty_template": "general_practice",
            "spoken_language": "en",
            "output_language": "en",
        }, headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["encounter_id"].startswith("ENC-")
        assert data["status"] == "recording"
        assert data["patient_name"] == "[ENCRYPTED]"  # PHI not in API response

    @pytest.mark.asyncio
    async def test_create_encounter_no_auth(self, client: AsyncClient):
        response = await client.post("/api/v1/encounters", json={
            "patient_name": "Test",
        })
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_list_encounters(self, client: AsyncClient, auth_headers):
        # Create two encounters
        await client.post("/api/v1/encounters", json={}, headers=auth_headers)
        await client.post("/api/v1/encounters", json={}, headers=auth_headers)

        response = await client.get("/api/v1/encounters", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert len(data["encounters"]) == 2


class TestTemplateEndpoints:
    """Test template listing and retrieval."""

    @pytest.mark.asyncio
    async def test_list_templates(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/templates", headers=auth_headers)
        assert response.status_code == 200
        templates = response.json()["templates"]
        assert len(templates) == 8
        ids = [t["id"] for t in templates]
        assert "general_practice" in ids
        assert "emergency_medicine" in ids

    @pytest.mark.asyncio
    async def test_get_template(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/templates/pediatrics", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["specialty"] == "Pediatrics"
        assert "growth_parameters" in data["sections"]

    @pytest.mark.asyncio
    async def test_get_invalid_template(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/templates/nonexistent", headers=auth_headers)
        assert response.status_code == 404


class TestSecurityHeaders:
    """Verify security headers are present on all responses."""

    @pytest.mark.asyncio
    async def test_hsts_header(self, client: AsyncClient):
        response = await client.get("/health")
        assert "strict-transport-security" in response.headers

    @pytest.mark.asyncio
    async def test_no_sniff_header(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.headers.get("x-content-type-options") == "nosniff"

    @pytest.mark.asyncio
    async def test_frame_deny_header(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.headers.get("x-frame-options") == "DENY"

    @pytest.mark.asyncio
    async def test_no_cache_header(self, client: AsyncClient):
        response = await client.get("/health")
        assert "no-store" in response.headers.get("cache-control", "")
