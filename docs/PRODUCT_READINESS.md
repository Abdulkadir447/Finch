# Co-op — Product Readiness Assessment

_Last updated: 2026-08-28 (product-readiness pass over the v1 feature set)._

**Verdict:** Co-op has a coherent, working v1 foundation: ingest →
understand → operate → report → explain → draft → confirm → meter, with
honest UI states wherever a capability is provisional. It is ready for
internal review and controlled early use. It is **not** ready for open
commercial launch until the payment decision is made (nothing can be
charged yet — deliberately) and the hardening backlog below is worked
down.

---

## 1. Ready today

| Area | Status | Where |
| --- | --- | --- |
| Auth + multi-tenant isolation | Clerk JWKS-verified; every route tenant-scoped (39 business routes audited — all authed; only `/healthcheck`, `/` public) | `backend/clerk_auth.py`, `backend/main.py` |
| Operational core (products, inventory, customers, orders) | Live, transactional, tested (stock ledger, optimistic locking, guarded status transitions, concurrency test) | `backend/main.py`, `backend/tests/` |
| Intelligent Import | 5-endpoint flow, deterministic mapper (LLM seam), read-only validate, commit with provenance + `source_order_ref` idempotency | `backend/importer.py`, `frontend/src/imports/` |
| Day 1 Briefing + first-run onboarding | Verified deterministic insights; `/onboarding/state` + Welcome gate | `backend/briefing.py`, `frontend/src/pages/Welcome/` |
| Reports + exports | One engine, one filter contract; Sales / P&L / Inventory / Customers; CSV/XLSX/PDF of exactly what's on screen | `backend/reports/`, `backend/exports/`, `frontend/src/pages/Reports/` |
| Co-op AI (real model) | Verified-context architecture; strict answer contract; fixed validated action registry; graceful fallback when the model is unreachable; deterministic revenue forecast (`/ai/forecast`, transparent trend — never ML, never negative) and owner-visible AI activity ledger (`ai_history`, `/ai/history`) — both tenant-scoped, tested, no model call | `backend/ai/`, `frontend/src/ai/`, `frontend/src/components/ai/` |
| Billing + credits | Real plan state, computed (never stored) credit balance from the `ai_usage` ledger, enforcement (402) on every AI request; payment collection unplugged by design | `backend/billing.py`, `frontend/src/pages/Billing/` |
| Tests | 113 backend tests (incl. frontend↔backend contract test; 7 forecast, 6 AI history, 2 for the report-chart alignment + report-route regressions) + 15 local-analytics port tests + a server↔local cross-check harness + 22 Electron data-layer/sync Node tests + tsc/build gates, all green locally. **CI itself is currently non-functional on `master` (wrong branch triggers + stale tooling) — corrected workflow pending owner push, see Appendix A** | `backend/tests/`, `frontend/test/`, `electron/test/`, `.github/workflows/ci.yml` |

## 2. The five parked areas — status and recommendation

### 2.1 Payment provider — **parked (decision needed, not engineering)**
Everything it plugs into exists: plans, allowances, ledger, remaining
balance, 402 enforcement, and UI states that already say "nothing is
charged yet". When the decision to charge is made, the work is: pick a
gateway (Stripe or Paystack, depending on market), add a
`POST /billing/checkout` + webhook receiver, flip
`payment_connected` to true, and remove the preview banner. **No
engineering should start until the charging decision exists.**

### 2.2 Offline / sync — **v1 commitment (ADR-002); foundation built**
**Decision locked (2026-08-28):** offline-first is a core Co-op v1
requirement, not a future enhancement. See `docs/architecture/adr-002-
offline-first-data-layer.md` for the full decision, the offline boundary
(core operations offline; AI + payments online-only), and the
non-negotiable rules (UI never calls FastAPI for core data; client ULID
ids; idempotent writes; operation-based inventory; visible sync state).

**Foundation delivered this phase (OFFLINE 1 + one-way sync protocol):**
- `electron/db/` — local SQLite data layer: driver contract (better-sqlite3
  for production Electron / node:sqlite for tests), versioned migrations,
  ULID `client_id` generation, repositories (business/customers/products/
  orders/stock) that write locally *and* enqueue sync ops, and a
  `sync_queue`. 10 passing Node tests.
- `electron/preload.js` + `main.js` — secure IPC bridge (contextIsolation
  on, nodeIntegration off) exposing allow-listed data-layer methods;
  connectivity detection wired.
- Server idempotency: `client_id` on all syncable entities (migration 0006)
  + `POST /sync/push` applying a batch idempotently (a retried op applies
  once), resolving references by client_id, applying stock as operations,
  and re-validating (refuses negative stock). 8 passing tests.
- Frontend: `frontend/src/sync/` (types, connectivity, status store, local
  DB seam) + a visible TopBar **SyncIndicator** (Synced / Offline — saved
  on this device / Syncing / N to sync).

**OFFLINE 2 — local-first UI wiring (plumbing delivered; activation gated):**
- `frontend/src/repositories/` — the UI's data-access layer (ADR-002 rule):
  `identity` (tenant + local-business bootstrap), `customers`, `products`,
  `inventory`, `orders`. Each operation branches: local (SQLite + sync
  queue) on desktop, or the unchanged HTTP call in a browser.
- The four write-module hooks (`useCustomers`, `useProducts`,
  `useInventory`, `useOrders`) and `CreateOrderPage` now route their
  mutations through the repositories — the UI no longer calls FastAPI
  directly for core mutations.
- **Safety gate (important finding):** local mode is gated behind
  `isLocalModeActive()` (local DB present **and** mirror ready). It is
  **inactive** until OFFLINE 3, because activating local *writes* before
  local *reads* would (a) make locally-created records invisible to
  server-backed reads, and (b) drive local update/delete against rows that
  aren't mirrored yet (a null-row crash — now a clear error). So OFFLINE 2
  delivers the plumbing + a correct, hardened local branch; OFFLINE 3
  activates it. Until then the app's behaviour is unchanged (all HTTP).
- Local data layer hardened: update/delete on a non-local row now throws a
  clear "not in the local database" error instead of crashing on null.

**OFFLINE 3 — sync engine (delivered; the gate is now real):**
- Server: `GET /sync/pull` (full mirror or delta since cursor; every record
  carries server id + client_id; soft-deleted rows included so the mirror
  reflects deletions; stock movements delta on created_at). `POST /sync/push`
  now also applies order `update` ops (offline status changes — validated
  against the shared `ALLOWED_ORDER_TRANSITIONS` machine; the cancellation's
  stock restore travels as its own `stock_movement` op, so it applies exactly
  once — no double restore).
- Local: `electron/sync.js` — `applyPull` upserts the mirror in one
  transaction keyed by stable identity (ULID, or the synthetic `srv-<id>`
  for cloud-native rows), resolves cross-references through a new `id_map`
  table (local migration 0002), re-attaches soft deletes, dedupes the stock
  ledger by client_id, and — on a full pull — VERIFIES local counts against
  the cloud before committing (cursor stored last, so a failed pull keeps
  the old cursor). `markPushOutcome` marks acknowledged ops synced and
  refused ops failed (retried next cycle). 12 passing Node tests.
- Engine (renderer — it owns the Clerk-authenticated client): one cycle =
  PUSH (drain queue, idempotent) → PULL (initial full, then delta since
  cursor; a failed delta arms a one-shot re-verified full pull). Triggers:
  app startup, connectivity restored, 30 s online interval, manual "Sync
  now". A failed full pull/verification leaves mirror + cursor untouched.
- Activation (the OFFLINE 2 safety gate, now real): local mode flips on
  only when the initial pull succeeds (`mirrorReady` from main → status
  store → `setLocalMirrorReady`). Reads for Orders, Customers, Products and
  Inventory then come from SQLite with the server's exact list semantics
  (search/status/stock filters, ordering, page envelope); the summary the
  Inventory page shows is the same calculation computed from mirrored rows.
- User-facing sync behaviour: offline order appears in the list immediately
  with a "Pending sync" chip (live-updated as the queue drains), the
  success screen says "saved on this device" for local orders, the TopBar
  pill shows Synced / Offline — saved / Syncing / N to sync + a "Sync now"
  button, and the queue is retried on reconnect.
- Local order/order-item push payloads now carry client-id references
  (`customer_client_id`, `order_client_id`, `product_client_id`) — the
  reference gap that would have made every offline order refused by the
  server.

**OFFLINE 3.5 — local Dashboard + Reports (delivered; the whole app surface
is now local-first except the model-based AI):**
- `frontend/src/analytics/` — local ports of the cloud engines over the
  mirror bundle: `localDashboard.ts` (summary, timeseries, by-category,
  top products, recent orders, inventory summary — exact status/rounding
  semantics), `localReports.ts` (filter contract + all four report builders,
  verbatim), `localBriefing.ts` (the deterministic insight engine, verbatim
  prose). `localData.ts` fetches the mirror once (short TTL + invalidation
  on every sync event).
- Dashboard, Reports (all four), Briefing page, Dashboard briefing banner
  and the deterministic AI-insights bundle all take the local path when
  local mode is active — same KPIs/tables/notes/prose as the cloud.
- Port fidelity is PINNED by tests: 15 unit tests on the calculators, plus
  a **cross-check harness that runs the actual server engines (FastAPI +
  SQLAlchemy) and the local port on the same fixture and diffs the JSON
  field-for-field** (clean: only timestamps and auto-assigned ids differ).
- Offline export: the Export menu computes CSV from the on-screen
  ReportData ("export exactly what you're looking at", offline); XLSX/PDF
  are server-rendered and honestly disabled offline. The model-based AI
  surfaces stay online-only (ADR-002) and degrade to the deterministic
  engine offline.
- Found + fixed while cross-checking: the report chart series took data
  from `dict.values()` (row insertion order) while the labels were sorted —
  values plotted under the wrong bucket whenever row order ≠ date order
  (affected Sales, P&L, Inventory donut and Customers charts). Data now
  follows the sorted label order; regression test added. Also fixed a
  latent 500 on `GET /reports/{key}` (`await build_report(...).to_dict()`
  called `.to_dict` on the coroutine — only reachable over HTTP, which the
  service-level tests never hit; route-level regression test added).

**Remaining (scheduled sub-phases):** OFFLINE 4 (conflict rules: customers
merge, products SKU-conflict flag, inventory operation-based), OFFLINE 5
(conflict-resolution UX; the sync indicator / manual sync / pending badges
landed with OFFLINE 3), OFFLINE 6 (E2E offline / restart / duplicate-sync
testing in the real Electron runtime). Dashboard/Reports reads stay
server-backed for now (the deterministic engines keep working from live
data); moving them to the local mirror is the natural next sub-phase.

### 2.3 Notifications — **partially live; daily summary is the gap**
Live: low-stock / out-of-stock alerts in the TopBar popover (real data,
deep-links to filtered inventory). Missing: the **daily business summary**
(PRD v1 item) — a verified digest (revenue today, new orders, stock risk,
quiet customers) shown once per day. Implementation is small-to-medium:
the numbers already come from `/dashboard/summary` + the briefing engine;
the work is a daily digest endpoint (or reuse briefing), a stored
"last-seen" per tenant, and a notification card in the popover. Desktop +
email channels come later (desktop needs the Electron work; email needs a
mailer — none exists in the repo).

### 2.4 Security / team features — **hardening backlog**
- **Persistent audit log** — the `audit_log` table exists; nothing writes
  to it yet. `AuditService.record()` logs to stdout. Recommended: write
  audit rows for mutations (orders, stock, imports, plan changes) via the
  existing service seam; add a read-only Audit view behind Settings→Security.
- **Users / roles / invitations** — single owner per business today (Clerk
  user auto-provisions a tenant). Plans advertise "up to N users" (display
  values) but there is no team model. Needed before selling multi-seat
  plans: `users`/`memberships` with roles (owner/admin/standard),
  invitations, and scoping.
- **Session management** — Clerk handles token lifecycle; the app has a
  session-expiry guard. Missing: active-session list / revoke (Clerk
  feature to wire) under Settings→Security.
- **Rate limiting** — none. Add a per-tenant limiter on `/ai/chat` (the
  expensive route) before open launch; the 402 credit gate is a cost backstop
  but not a rate control.
- **CORS** — defaults to `*` (no cookies/credentials, so lower risk); must
  be set explicitly (`CORS_ORIGINS`) in production.
- **Secrets** — verified clean: API key lives only in the gitignored
  `.env`; `.env.example` holds placeholders; no key appears in the tree.

### 2.5 Product positioning — **mostly there; polish the last mile**
The advisor/operator identity is already visible: Welcome screen, Day 1
Briefing, "Co-op AI · Live Insights" on the Dashboard, "Ask Co-op"
throughout, Reports with "Ask Co-op about this report", and drafts-never-
acts copy in the AI composer. Residual ERP-feel:
- **Settings** shows 7 "coming soon" sections (appearance, AI prefs,
  notifications, security, backup, sync, about). Honest, but prominent —
  either implement the cheap ones (About, Appearance display prefs) or
  collapse the list to what's actually planned.
- **List pages** (Products/Customers/Orders/Inventory) are conventional
  tables — acceptable for an operational tool; the advisor voice lives in
  the Dashboard/AI/Briefing/Reports surfaces.
- **README/docs** previously still said "multi-tenant ERP" — corrected in
  this pass.

## 3. Readiness defects found and fixed in this pass

1. **CI never runs on the real branches** — the workflow targets
   `main`/`develop` (default is `master`) and uses pnpm filters + lint
   scripts the repo doesn't have (guaranteed red). The corrected workflow
   is specified in **Appendix A** — the session's agent token lacks GitHub
   `workflows` permission, so the repo owner needs to apply it (copy-paste +
   push). Until then, CI provides no enforcement on `master`.
2. **README stale** — still framed Co-op as "a multi-tenant ERP", listed
   old import endpoints, and omitted import/reports/AI/billing/briefing.
   Rewritten with the true positioning and the current API surface.
3. **CONTRIBUTING stale** — pnpm instructions, `develop` branch,
   pre-Clerk env vars, nonexistent project structure. Rewritten.
4. **Dashboard docstring** still described the AI card as a "module
   pending" placeholder (the module exists). Corrected.

## 4. Hardening backlog (before open launch)

- [ ] **Apply the corrected CI workflow (Appendix A)** — needs repo-owner
      push; until then no CI enforcement on `master`
- [ ] Lint tooling wired into CI (flake8/black/mypy for backend, eslint for
      frontend) — only after the codebase passes, or with an explicit
      grandfathering strategy
- [ ] commitlint in CI (repo already has commitlint config locally)
- [ ] Per-tenant rate limiting on `/ai/chat`
- [ ] `CORS_ORIGINS` set explicitly in production config
- [ ] Audit log persistence + read view
- [ ] Team model (memberships, roles, invitations) before multi-seat sales
- [ ] Daily business summary notification
- [ ] Settings: implement or trim the "coming soon" sections
- [ ] Decide + document offline-first scope (or adjust copy to "online web
      app with desktop wrapper")
- [ ] Payment provider integration (after the charging decision)

## 5. Pre-release checklist

- [ ] Run migrations on target Postgres: `alembic upgrade head` (5
      migrations, all idempotent/additive)
- [ ] Set production env: `DATABASE_URL`, `CLERK_FRONTEND_API`,
      `CORS_ORIGINS`, `OPENAI_API_KEY`
- [ ] Verify `/healthcheck`, a login, an import, a report export, an AI
      question, and a plan change on the deployed instance
- [ ] Confirm no `.env` in the deploy artifact and no secrets in logs

---

## Appendix A — Pending CI fix (requires repo-owner push)

The agent token used in this session lacks GitHub `workflows` permission,
so the CI fix below **could not be committed** and is recorded here for the
repo owner to apply (replace `.github/workflows/ci.yml`, then push).
Everything else in this pass is already committed.

```yaml
name: CI

# Co-op's enforced gates — the ones the repo actually maintains:
#   backend  — full pytest suite (incl. the frontend<->backend contract test,
#              which needs the whole repo, so it runs from the repo root)
#   frontend — TypeScript check + production build
#
# Lint tooling (flake8/black/mypy, eslint/prettier) and commitlint are NOT
# wired here yet — see docs/PRODUCT_READINESS.md (hardening backlog). A gate
# that can't pass (or can't fail) doesn't belong in CI.

on:
  push:
    branches:
      - master
  pull_request:
    branches:
      - master
  workflow_dispatch:

env:
  PYTHON_VERSION: '3.11'
  NODE_VERSION: '22'

jobs:
  backend:
    name: Backend tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r backend/requirements.txt
          pip install pytest pytest-asyncio

      - name: Run test suite
        run: python -m pytest

  frontend:
    name: Frontend type-check + build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Type check
        working-directory: frontend
        run: npx tsc --noEmit -p tsconfig.json

      - name: Production build
        working-directory: frontend
        run: npm run build
```
