# Co-op backend image (Supabase/Postgres via asyncpg).
#
# The app is a package (`backend.main`); uvicorn is therefore launched from the
# repository root so `backend.main`'s relative imports resolve (Task 11 / audit
# C2 — the previous `uvicorn main:app` failed with "attempted relative import").
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
# config/<env>.json is read by backend/config.py at runtime (repo-root layout).
COPY config ./config

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
