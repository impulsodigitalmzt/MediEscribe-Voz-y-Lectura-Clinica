# MedScribe — AI-Powered Ambient Clinical Documentation Platform

> **Transform clinical conversations into polished medical notes — automatically.**

MedScribe listens to doctor–patient conversations in real time, extracts clinically relevant content, filters noise and small talk, and generates structured, professional clinical notes that physicians can review, edit, approve, and export as PDF.

## ⚕️ What MedScribe Is

- An AI-powered **clinical documentation copilot**
- A tool that **documents** what is said during clinical encounters
- A system that places the **physician in full control** of the final output

## 🚫 What MedScribe Is NOT

- NOT a clinical decision-maker
- NOT a diagnostic tool
- NOT a treatment recommender

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           Frontend (React/TS) — static assets           │
│  Splash → Login → Dashboard → Encounter → Review → PDF  │
└─────────────────┬───────────────────────────────────────┘
                  │ same origin (Cloudflare Worker)
┌─────────────────▼───────────────────────────────────────┐
│         Cloudflare Worker (Hono / Edge runtime)         │
│  Auth → Transcript → Groq note → PDF → WhatsApp webhook │
└─────────────┬───────────────────────────┬───────────────┘
              │                           │
              ▼                           ▼
        Supabase (Postgres)         Groq + Meta Graph
```

## Quick Start

```bash
cp .env.example .dev.vars   # fill secrets
npm install
cd frontend && npm install && cd ..
npx wrangler types
npm run dev                      # http://localhost:8787
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Supabase schema, secrets, and the Meta webhook.

## Tech Stack

| Layer      | Technology                                         |
|------------|----------------------------------------------------|
| Frontend   | React 18, TypeScript, Tailwind CSS, Vite           |
| Runtime    | Cloudflare Workers (Hono, `nodejs_compat`)         |
| AI Engine  | Groq (chat + Whisper)                              |
| Messaging  | WhatsApp Cloud API                                 |
| Audio      | Web Speech API + Worker WebSocket                  |
| PDF Export | pdf-lib (Edge-compatible)                          |
| Auth       | JWT (jose) + PBKDF2 (Web Crypto)                   |
| Database   | Neon HTTP (`@neondatabase/serverless`) + Supabase  |

## Security

- HTTPS enforced on all connections
- JWT with 15-minute access tokens and refresh rotation
- PBKDF2-SHA256 password hashing (Web Crypto)
- RBAC: Physician, Nurse, Admin, System roles
- No PHI in logs, errors, or telemetry
- TLS 1.2+ for all data in transit
- Encryption at rest for stored encounter data
- Append-only immutable audit logs

## License

Proprietary — For internal development use only.
