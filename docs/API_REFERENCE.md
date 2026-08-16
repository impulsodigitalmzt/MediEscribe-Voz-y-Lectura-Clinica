# MedScribe API Reference

## Base URL
```
https://api.medscribe.app/api/v1
```

## Authentication
All endpoints (except `/health`, `/auth/login`, `/auth/register`) require a Bearer token.

```
Authorization: Bearer <access_token>
```

Access tokens expire after 15 minutes. Use the refresh endpoint to obtain new tokens.

---

## Auth Endpoints

### POST /auth/register
Create a new account.

**Body:**
```json
{
  "email": "doctor@hospital.com",
  "password": "SecurePass123!",
  "full_name": "Dr. Jane Smith",
  "credentials": "MD, FACP",
  "specialty": "General Practice",
  "institution": "City Hospital"
}
```

**Response:** `201 Created`
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 900
}
```

### POST /auth/login
Authenticate and receive tokens.

### POST /auth/refresh
Refresh an expired access token.

### GET /auth/profile
Get current user profile.

### PATCH /auth/profile
Update profile settings.

---

## Encounter Endpoints

### POST /encounters
Create a new encounter.

### GET /encounters
List encounters (paginated, filterable by status).

### GET /encounters/{id}
Get a specific encounter.

### POST /encounters/{id}/pause
Pause recording.

### POST /encounters/{id}/resume
Resume recording.

### POST /encounters/{id}/stop
Stop recording and begin processing.

### POST /encounters/{id}/consent
Record patient consent.

### GET /encounters/{id}/transcript
Get the full transcript.

### POST /encounters/{id}/generate-note
Generate an AI clinical note from the transcript.

### GET /encounters/{id}/note
Get the clinical note.

### PATCH /encounters/{id}/note
Edit a section of the note.

### POST /encounters/{id}/sign-off
Sign off and lock the note (requires `confirmation: true`).

### GET /encounters/{id}/export/pdf
Export the note as a PDF file.

### GET /encounters/{id}/note/versions
Get the version history.

---

## Template Endpoints

### GET /templates
List all specialty templates.

### GET /templates/{id}
Get a specific template with sections.

---

## WebSocket

### WS /ws/audio/{encounter_id}?token={jwt}
Real-time audio streaming for live transcription.

**Client → Server:**
- Binary: audio chunks (WebM/Ogg/WAV)
- JSON: `{"type": "pause"}`, `{"type": "resume"}`, `{"type": "stop"}`

**Server → Client:**
- `{"type": "transcript", "text": "...", "speaker": "...", "confidence": 0.95}`
- `{"type": "status", "status": "paused"}`
- `{"type": "error", "message": "..."}`

---

## Roles & Permissions

| Endpoint | Physician | Nurse | Admin |
|----------|-----------|-------|-------|
| Create Encounter | ✓ | ✗ | ✓ |
| Record Consent | ✓ | ✓ | ✗ |
| Generate Note | ✓ | ✗ | ✗ |
| Edit Note | ✓ | ✗ | ✗ |
| Sign Off | ✓ | ✗ | ✗ |
| Export PDF | ✓ | ✗ | ✓ |
| View Templates | ✓ | ✓ | ✓ |
| Manage Settings | ✓ | ✓ | ✓ |
