# Co-op — Your Business Advisor, Powered by Real Data

Co-op is an AI-powered business management platform for small businesses.
It is not an ERP with an AI feature bolted on: the product promise is that
Co-op **understands your business** — it ingests your history, operates on
your data through controlled workflows, reports on it, explains what
matters, and drafts the next action for you to confirm.

> **Run your business anywhere. Co-op works offline and syncs when you're
> back online.** (v1 commitment — see ADR-002.)

### Offline boundary (v1)

- **Works offline:** Dashboard, Products, Inventory, Customers, Orders,
  order status changes, local invoices, Reports, CSV/XLSX import, and the
  locally-calculated deterministic insights.
- **Requires internet:** real LLM calls, AI model-based explanations, cloud
  billing/payment, cloud account auth/refresh.

The desktop app owns a local SQLite database (Electron main process); the UI
writes locally first and syncs to the cloud when connectivity returns. The
model-based assistant degrades to an honest "unavailable offline" state while
your data and workflows keep working.

```
INGEST → UNDERSTAND → OPERATE → REPORT → EXPLAIN → DRAFT → CONFIRM → METER
```

## What's live

- **Operational core** — products, inventory (adjustments + immutable stock
  ledger + optimistic locking), customers, orders (transactional stock,
  guarded status transitions, printable invoices), dashboard analytics.
- **Intelligent Import** — bring your history from an old system
  (CSV/XLSX). Co-op detects the dataset, suggests a column mapping, runs a
  read-only validation pass, and commits in one transaction with provenance
  (`import_batch_id`) and idempotency (`source_order_ref` — re-importing the
  same file never duplicates).
- **Day 1 Briefing** — verified, deterministic analyses of your business
  (revenue trend, top products, quiet customers, stock risk, margin), each
  with its evidence and an optional *Draft Follow-up* that hands off to the
  real order flow for your confirmation.
- **Reports + exports** — one deterministic reporting engine (Sales,
  Profit & Loss, Inventory, Customers) with shared filters and comparison
  periods, powering the Reports UI and CSV / Excel / PDF exports of exactly
  what's on screen.
- **Co-op AI (real model, verified context)** — Ask Co-op answers from a
  verified business context the backend rebuilds per request: the model
  never queries the database and never invents numbers. It can explain any
  report you're looking at and propose *drafts* from a fixed, validated
  action registry — execution always requires your explicit confirmation.
- **Real billing + credits** — plans and monthly AI-credit allowances are
  real server-side state; credits are computed from the `ai_usage` ledger
  (nothing mutable to drift) and enforced on every AI request (402 when
  exhausted). Payment collection is the one deliberately unplugged part —
  the UI says so.
- **Multi-tenant** — Clerk authentication; every query is scoped to the
  caller's auto-provisioned business.

Provisional by design: payment provider (nothing is charged yet),
offline/sync for the desktop wrapper, and the Settings "coming soon"
sections. See `docs/PRODUCT_READINESS.md` for the full status.

## Repository layout

```
frontend/   React 18 + Vite + Ant Design app (src/), nginx config, Dockerfile
backend/    FastAPI app (main.py) + domain modules:
            ai/ (LLM seam, verified context, action registry, usage)
            reports/ (reporting engine)  exports/ (CSV/XLSX/PDF)
            billing.py (plans + credits) briefing.py (Day 1 Briefing)
            importer.py (intelligent import)
            Alembic migrations (backend/alembic/), pytest suite (backend/tests/)
database/   Reference SQLite schema (schema.sql)
tools/      Operational scripts (e.g. inspect_db_schema.py)
config/     Per-environment, non-secret configuration (JSON) — incl. AI
            credit policy and plan allowances
electron/   Optional Electron desktop wrapper
Documents/  Product documentation (PRD, TRD, BSD, AFD, IPD, UXDS chapters)
```

## Prerequisites

- Node.js **>= 22**, Python **3.11+**
- A Clerk application (publishable key for the frontend, Frontend API host
  for the backend)
- A Supabase/Postgres database
- (Optional) an OpenAI API key for the real AI assistant — without it,
  Ask Co-op gracefully falls back to the deterministic data engine

## Environment variables

Copy `.env.example` to `.env` and fill in real values. The important ones:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | frontend | Clerk publishable key (baked at build/dev time) |
| `DATABASE_URL` (or `SUPABASE_DB_URL`) | backend (prod + dev) | Supabase/Postgres connection string |
| `CLERK_FRONTEND_API` | backend (prod) | Clerk Frontend API host used to verify session tokens |
| `CLERK_ALLOWED_ORIGINS` | optional | Comma-separated `azp` allow-list |
| `CORS_ORIGINS` | optional | Comma-separated CORS allow-list (defaults to `*`) |
| `COOP_ENV` | optional | `development` (default) \| `testing` \| `production` |
| `OPENAI_API_KEY` | optional | Enables the real AI assistant |
| `OPENAI_MODEL` | optional | Model override (default from `config/*.json`) |
| `TEST_DATABASE_URL` | tests | Postgres URL to enable true-concurrency tests |

> SQLite is used **only** when `COOP_ENV=testing` (or by the test suite).
> There is no silent fallback in production/development.
>
> Plan names, monthly credit allowances and the AI credit policy live in
> `config/<env>.json` (`billing` and `ai` sections) — non-secret product
> configuration, changeable without code.

## Running locally

Backend:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
DATABASE_URL=postgresql://... .venv/bin/uvicorn backend.main:app --reload
```

Frontend (dev server, proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev
```

Desktop wrapper (optional): `npm run start` from the repo root.

## Key API surface

```
CRUD        /products /customers /orders (+ /adjust, /movements, /status)
Dashboard   /dashboard/summary /revenue/timeseries /inventory/by-category
            /revenue/today /revenue/month /growth /low-stock /top-products
Import      GET /imports/schema  POST /imports/preview /imports/map
            POST /imports/validate  POST /imports/commit
Reports     GET /reports/meta  GET /reports/{sales|profit-loss|inventory|customers}
            GET /reports/{key}/export?format=csv|xlsx|pdf
AI          POST /ai/chat   (verified context, structured answer, 402 when out
                             of credits)   GET /ai/usage
Billing     GET /billing/summary   POST /billing/plan
Onboarding  GET /onboarding/state
Auth        /auth/me  /business/settings  /healthcheck
```

## Database migrations (Supabase/Postgres)

Migrations live in `backend/alembic/` (baseline → import provenance →
`source_order_ref` → `ai_usage` → `subscriptions`) and are applied with
Alembic.

1. **Inspect first** — never migrate blind:

   ```bash
   DATABASE_URL=postgresql://... python tools/inspect_db_schema.py
   ```

2. **Review** the output, then apply:

   ```bash
   DATABASE_URL=postgresql://... alembic upgrade head
   ```

All migrations are idempotent (guarded DDL), additive, and never rewrite
business data.

## Tests

```bash
# Backend (requires a venv with backend/requirements.txt + pytest + pytest-asyncio)
.venv/bin/python -m pytest

# Frontend type check + production build
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run build
```

The suite includes a **contract test** that scans every frontend API call
and asserts a matching backend route exists — the guard that makes a
frontend/backend endpoint mismatch impossible. Set `TEST_DATABASE_URL` to a
Postgres URL to additionally run the true-concurrency stock test.

## Documentation

Product documentation (PRD, TRD, BSD, AFD, IPD, UXDS) lives in
`Documents/`; engineering docs (branch protection, ADRs, coding standards)
in `docs/`; current readiness status in `docs/PRODUCT_READINESS.md`.
