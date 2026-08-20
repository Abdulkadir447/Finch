# Finch — AI-powered Business Management Platform

Finch is a multi-tenant ERP (products, inventory, customers, orders, dashboard
analytics) with a React + Ant Design frontend, a FastAPI backend, Clerk
authentication, and a Supabase/Postgres data store.

## Repository layout

```
frontend/   React 18 + Vite + Ant Design app (src/), nginx config, Dockerfile
backend/    FastAPI app (main.py, models.py, schemas.py, services.py),
            Alembic migrations (backend/alembic/), pytest suite (backend/tests/)
database/   Reference SQLite schema (schema.sql)
tools/      Operational scripts (e.g. inspect_db_schema.py)
config/     Per-environment, non-secret configuration (JSON)
electron/   Optional Electron desktop wrapper
```

## Prerequisites

- Node.js **>= 22** (see `package.json` engines)
- Python **3.11+**
- A Clerk application (publishable key for the frontend, Frontend API host for
  the backend)
- A Supabase/Postgres database

## Environment variables

Copy `.env.example` to `.env` and fill in real values. The important ones:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | frontend | Clerk publishable key (baked at build/dev time) |
| `DATABASE_URL` (or `SUPABASE_DB_URL`) | backend (prod + dev) | Supabase/Postgres connection string |
| `CLERK_FRONTEND_API` | backend (prod) | Clerk Frontend API host used to verify session tokens |
| `CLERK_ALLOWED_ORIGINS` | optional | Comma-separated `azp` allow-list |
| `CORS_ORIGINS` | optional | Comma-separated CORS allow-list (defaults to `*`) |
| `FINCH_ENV` | optional | `development` (default) \| `testing` \| `production` |
| `TEST_DATABASE_URL` | tests | Postgres URL to enable true-concurrency tests |

> SQLite is used **only** when `FINCH_ENV=testing` (or by the test suite).
> There is no silent fallback in production/development.

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

## Database migrations (Supabase/Postgres)

Migrations live in `backend/alembic/` and are applied with Alembic.

1. **Inspect first** — never migrate blind. Dump the live schema and check for
   conflicting duplicates:

   ```bash
   DATABASE_URL=postgresql://... python tools/inspect_db_schema.py
   ```

2. **Review** the output against
   `backend/alembic/versions/0001_postgres_baseline.py`, then apply:

   ```bash
   DATABASE_URL=postgresql://... alembic upgrade head
   ```

The baseline migration is idempotent (guarded DDL) and only adds objects and
swaps the products/customers uniqueness rules; it never rewrites business data.

## Tests

```bash
# Backend (requires a venv with backend/requirements.txt + pytest + pytest-asyncio)
.venv/bin/python -m pytest

# Frontend type check + production build
cd frontend && npx tsc --noEmit && npm run build
```

Set `TEST_DATABASE_URL` to a Postgres URL to additionally run the
true-concurrency stock test.

## Containers

`podman-compose.yml` runs a local Postgres plus the backend and frontend
images:

```bash
podman-compose up --build
```

The backend runs `uvicorn backend.main:app` (package-relative imports), and
nginx proxies `/api/*` to the backend service.
