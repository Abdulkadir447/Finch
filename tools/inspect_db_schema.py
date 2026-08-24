#!/usr/bin/env python3
"""Inspect the live Postgres/Supabase schema BEFORE running migrations.

Task 11 / audit H4: never migrate blind. This script connects to the real
database and prints exactly what is there — tables, columns, indexes and
unique constraints — so the Alembic baseline can be reviewed against reality.

Usage:
    DATABASE_URL=postgresql://user:pass@host:5432/finch \
        python tools/inspect_db_schema.py

It reads DATABASE_URL (or SUPABASE_DB_URL). No credentials are written here or
required as arguments.
"""
from __future__ import annotations

import asyncio
import os
import sys

try:
    import asyncpg
except ImportError:
    sys.exit(
        "asyncpg is not installed. Run: pip install asyncpg "
        "(it is already in backend/requirements.txt)."
    )


def _url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not url:
        sys.exit("Set DATABASE_URL (or SUPABASE_DB_URL) to the Supabase/Postgres URL.")
    return url


async def main() -> None:
    conn = await asyncpg.connect(_url())

    print("== TABLES ==")
    tables = await conn.fetch(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
        """
    )
    for t in tables:
        print(f"  {t['table_name']}")

    print("\n== COLUMNS ==")
    cols = await conn.fetch(
        """
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
        """
    )
    for c in cols:
        print(
            f"  {c['table_name']}.{c['column_name']} "
            f"{c['data_type']} nullable={c['is_nullable']} default={c['column_default']}"
        )

    print("\n== INDEXES ==")
    idx = await conn.fetch(
        """
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
        """
    )
    for i in idx:
        print(f"  {i['tablename']}.{i['indexname']} :: {i['indexdef']}")

    print("\n== UNIQUE CONSTRAINTS ==")
    uniq = await conn.fetch(
        """
        SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype = 'u' AND connamespace = 'public'::regnamespace
        ORDER BY 1, 2
        """
    )
    for u in uniq:
        print(f"  {u['table_name']}.{u['conname']} :: {u['def']}")

    # The two rules the baseline migration swaps (Task 11 / audit H2 + SKU parity).
    print("\n== UNIQUENESS CHECK (products/customers) ==")
    for table, cols_sql in (
        ("products", "business_id, sku"),
        ("customers", "business_id, email"),
    ):
        rows = await conn.fetch(
            f"""
            SELECT {cols_sql}, count(*) AS n
            FROM {table}
            WHERE deleted_at IS NULL
            GROUP BY {cols_sql}
            HAVING count(*) > 1
            """
        )
        if rows:
            print(f"  ! DUPLICATES among live {table} rows (resolve before migrating):")
            for r in rows:
                print(f"      {dict(r)}")
        else:
            print(f"  OK: no live-row duplicates on ({cols_sql}) in {table}")

    await conn.close()
    print("\nDone. Compare the output above with backend/alembic/versions/0001_postgres_baseline.py.")


if __name__ == "__main__":
    asyncio.run(main())
