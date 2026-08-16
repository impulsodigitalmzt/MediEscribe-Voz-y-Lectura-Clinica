# Changelog

All notable changes to MedScribe will be documented in this file.

## [1.0.0] — 2026-03-28

### Added
- **Backend (FastAPI)**
  - AppConfig: centralized environment-based configuration
  - SecurityManager: bcrypt hashing, JWT token generation, encryption utilities
  - AuthService: user registration, login, JWT issuance with refresh rotation
  - EncounterSessionManager: full encounter lifecycle management
  - AudioStreamHandler: WebSocket handler for real-time audio streaming
  - TranscriptionService: speech-to-text integration with streaming support
  - ClinicalNLPService: medical entity extraction and clinical concept identification
  - NotePolisher: Claude API integration for structured note generation
  - SafetyValidator: hallucination detection and completeness validation
  - ConsentManager: consent capture, verification, and audit trail
  - AuditLogger: append-only immutable event logging
  - ExportService: PDF generation with full clinical formatting
  - TemplateManager: specialty template CRUD and assignment
  - RBAC middleware with Physician, Nurse, Admin, System roles
  - Rate limiting on authentication endpoints
  - Comprehensive API routes for all features

- **Frontend (React / TypeScript / Tailwind)**
  - SplashScreen: branded launch screen with teal gradient
  - LoginPage & RegisterPage: secure auth with password strength enforcement
  - Dashboard: recent encounters, pending reviews, quick-start recording
  - LiveEncounterScreen: split-view transcript + note panel, recording controls, timer
  - ReviewEditScreen: section-by-section editing, uncertainty highlights, sign-off, PDF export
  - EncounterHistory: searchable, filterable list with status indicators
  - SettingsPage: profile, language, template selection, preferences
  - WebSocket audio streaming hook
  - Real-time transcription display
  - PDF export via single-click action

- **Multilingual Support**
  - Automatic language detection
  - Support for English, Spanish, French, Portuguese, Arabic, Mandarin, Hindi, Swahili
  - Clinician-selectable output language
  - Code-switching support

- **Specialty Templates**
  - General Practice, Emergency Medicine, Pediatrics, Surgery
  - Psychiatry, Cardiology, Oncology, Telemedicine

- **Security & Compliance**
  - HTTPS enforcement with HSTS
  - JWT with 15-min access tokens, refresh rotation
  - bcrypt password hashing
  - No PHI in logs
  - Append-only audit logs
  - Consent tracking per encounter
  - AI content labeling throughout

- **DevOps**
  - GitHub Actions CI/CD workflow
  - Automated test execution on PR
  - ZIP build packaging script

### Modified
- N/A (initial release)

### Fixed
- N/A (initial release)

### Breaking Changes
- N/A (initial release)

## [1.4.0] — 2026-03-29

### Changed — Web Speech API migration (no OpenAI key needed)
- **useAudioRecorder.ts** — Rewritten to use browser Web Speech API (SpeechRecognition) instead of MediaRecorder + Whisper. Free, zero-latency, no API key. Works in Chrome and Edge.
- **LiveEncounterScreen.tsx** — Shows amber warning when browser lacks Web Speech support, directs user to manual input. BCP-47 language codes correctly mapped.
- **ws_routes.py** — WebSocket now receives JSON text (not binary audio). No server-side audio processing needed.

### Added — medspaCy clinical NLP
- **requirements.txt** — Added medspacy>=1.3.0 and spacy>=3.7.0.
- **clinical_nlp.py** — medspaCy pipeline on startup: NER for medications/symptoms/procedures, ConText negation detection, merged with regex fallback.
- **render_build.sh** — Backend build script: pip install + python -m spacy download en_core_web_sm.

### Fixed (from v1.3.0)
- **tailwind.config.js** — Added darkMode: 'class' (dark mode was never activating).
- **SettingsPage.tsx** — Dark mode toggle replaced with animated pill switch, persists across reloads.
- **LiveEncounterScreen.tsx** — Removed duplicate Encounter Type section. Trauma card text overflow fixed with line-clamp-2.
