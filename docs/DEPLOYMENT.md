# MedScribe Deployment — Cloudflare Workers

The production runtime is a single Cloudflare Worker that serves the React SPA
(static assets) and the API / WhatsApp webhook on the same origin.

The Python FastAPI backend in `backend/` is legacy and is not deployed.

## Prerequisites

- Node.js 20+
- A Cloudflare account (`npx wrangler login`)
- A Supabase project (schema in `supabase/schema.sql`)
- A Groq API key
- WhatsApp Cloud API credentials (Meta)

## 1. Database

In the Supabase SQL Editor, run `supabase/schema.sql`.

Confirm Row Level Security is enabled. The Worker uses the **service role** key
and bypasses RLS; anon/authenticated clients cannot read clinical tables.

## 2. Local development

```bash
cp .env.example .dev.vars
# fill secrets in .dev.vars

npm install
cd frontend && npm install && cd ..

npx wrangler types
npm run dev                 # Worker on http://localhost:8787
# optional: npm run dev:frontend  # Vite on :5173, proxies /api to :8787
```

## 3. Production secrets

Never put secrets in `wrangler.toml`. Set them on the Worker so Cloudflare
injects them as `env` bindings (`c.env.DATABASE_URL`, etc.):

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put SECRET_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
```

Non-secret vars (`GROQ_MODEL`, `PHONE_NUMBER_ID`, etc.) live in `[vars]` inside
`wrangler.toml`. Local secrets belong in `.dev.vars` (see `.env.example`).

Neon is queried with `@neondatabase/serverless` over HTTP (`neon()`), which is
compatible with the Workers edge runtime. Do not use Node `net`/`tls` drivers.

## 4. Deploy (Workers & Pages)

Compile the Vite SPA into `./public` and publish the Worker (API + static assets):

```bash
npm run build
npm run deploy
```

`npm run build` installs frontend deps and runs Vite with `--outDir ../public`.
`npm run deploy` runs that build and then `wrangler deploy`.

### Cloudflare dashboard (Git)

Create a **Worker** (not a static-only Pages site) so the Hono API ships with the SPA:

| Setting | Value |
|---------|--------|
| Build command | `npm run build` |
| Output directory | `public` |
| Root directory | `/` |
| Node.js version | `20` |

Secrets still go in **Settings → Variables and Secrets** (or `wrangler secret put`).

After the first deploy, note the URL:

`https://medscribe.<subdomain>.workers.dev`

Attach a custom domain in the Cloudflare dashboard if needed.

## 5. WhatsApp webhook (Meta)

In Meta for Developers → your app → WhatsApp → Configuration:

- Callback URL: `https://<your-worker>/webhook/whatsapp`
- Verify token: the same value as `VERIFY_TOKEN`
- Subscribe to the `messages` field

The Worker answers Meta's GET challenge and processes POST events with
`ctx.waitUntil` so Meta receives HTTP 200 within a few seconds.

## Security checklist

- [ ] `SECRET_KEY` is a random 64-character string
- [ ] All secrets set via `wrangler secret put`, not committed
- [ ] Rotate any keys that were previously stored in `.env.example`
- [ ] `WHATSAPP_APP_SECRET` set so `X-Hub-Signature-256` is verified
- [ ] Supabase schema applied; service role key never exposed to the browser
- [ ] Custom domain + HTTPS (Workers provide TLS by default)
- [ ] Physicians link their WhatsApp number in Settings (digits only, country code)

## Plan note

Groq note generation and WhatsApp media download are I/O-bound but can exceed
the Workers **Free** plan wall-clock budget. Use **Workers Paid** for production
clinical traffic.
