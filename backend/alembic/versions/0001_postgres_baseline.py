"""Postgres/Supabase baseline — idempotent and introspective.

Revision ID: 0001_postgres_baseline
Revises:
Create Date: 2026-08-20

SAFETY (Task 11 / audit H4):
  * Run ``python tools/inspect_db_schema.py`` against the live database FIRST
    and compare its output with this file before running ``alembic upgrade``.
  * Every statement is guarded (``IF NOT EXISTS`` / ``pg_catalog`` checks), so
    the migration is idempotent and compatible with either a fresh database or
    one created by an earlier phase. It only ADDS columns/tables/indexes and
    swaps the customers/products uniqueness rules; it never rewrites or drops
    business data.
"""
from alembic import op

revision = "0001_postgres_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Core tables (fresh installs). FK names are explicit so the
    #    "add missing FK" guards below stay idempotent.
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS businesses (
            id          BIGSERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL,
            owner_id    VARCHAR(255),
            owner_email VARCHAR(255),
            industry    VARCHAR(100),
            currency    VARCHAR(8) DEFAULT 'USD',
            address     VARCHAR(500),
            phone       VARCHAR(20),
            tax_id      VARCHAR(100),
            website     VARCHAR(255),
            timezone    VARCHAR(64),
            created_by  VARCHAR(255),
            updated_by  VARCHAR(255),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ,
            deleted_at  TIMESTAMPTZ,
            deleted_by  VARCHAR(255),
            version     INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id            BIGSERIAL PRIMARY KEY,
            business_id   INTEGER,
            sku           VARCHAR(100) NOT NULL,
            name          VARCHAR(255) NOT NULL,
            description   VARCHAR(1000),
            category      VARCHAR(100),
            unit_price    DOUBLE PRECISION NOT NULL,
            cost_price    DOUBLE PRECISION,
            current_stock INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER NOT NULL DEFAULT 5,
            created_by    VARCHAR(255),
            updated_by    VARCHAR(255),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ,
            deleted_at    TIMESTAMPTZ,
            deleted_by    VARCHAR(255),
            version       INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
            id            BIGSERIAL PRIMARY KEY,
            business_id   INTEGER,
            full_name     VARCHAR(255) NOT NULL,
            email         VARCHAR(255) NOT NULL,
            phone         VARCHAR(20),
            address       VARCHAR(500),
            company       VARCHAR(255),
            password_hash VARCHAR(255),
            created_by    VARCHAR(255),
            updated_by    VARCHAR(255),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ,
            deleted_at    TIMESTAMPTZ,
            deleted_by    VARCHAR(255),
            version       INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id           BIGSERIAL PRIMARY KEY,
            business_id  INTEGER,
            customer_id  INTEGER NOT NULL,
            order_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
            status       VARCHAR(20) NOT NULL DEFAULT 'pending',
            total_amount DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            created_by   VARCHAR(255),
            updated_by   VARCHAR(255),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ,
            deleted_at   TIMESTAMPTZ,
            deleted_by   VARCHAR(255),
            version      INTEGER NOT NULL DEFAULT 1,
            CONSTRAINT fk_orders_customer_id
                FOREIGN KEY (customer_id) REFERENCES customers (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS order_items (
            id          BIGSERIAL PRIMARY KEY,
            business_id INTEGER,
            order_id    INTEGER NOT NULL,
            product_id  INTEGER NOT NULL,
            quantity    INTEGER NOT NULL,
            unit_price  DOUBLE PRECISION NOT NULL,
            total_price DOUBLE PRECISION NOT NULL,
            created_by  VARCHAR(255),
            updated_by  VARCHAR(255),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ,
            deleted_at  TIMESTAMPTZ,
            deleted_by  VARCHAR(255),
            version     INTEGER NOT NULL DEFAULT 1,
            CONSTRAINT fk_order_items_order_id
                FOREIGN KEY (order_id) REFERENCES orders (id),
            CONSTRAINT fk_order_items_product_id
                FOREIGN KEY (product_id) REFERENCES products (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_movements (
            id          BIGSERIAL PRIMARY KEY,
            business_id INTEGER NOT NULL,
            product_id  INTEGER NOT NULL,
            change      INTEGER NOT NULL,
            reason      VARCHAR(20) NOT NULL,
            note        VARCHAR(500),
            order_id    INTEGER,
            actor       VARCHAR(255),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT fk_stock_movements_product_id
                FOREIGN KEY (product_id) REFERENCES products (id)
        )
        """
    )
    # Supporting tables defined by the ORM (currently unused by the API but
    # part of the schema surface).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS profiles (
            id                 BIGSERIAL PRIMARY KEY,
            clerk_user_id      VARCHAR(255) NOT NULL UNIQUE,
            full_name          VARCHAR(255),
            email              VARCHAR(255) UNIQUE,
            avatar_url         VARCHAR(1024),
            phone_number       VARCHAR(40),
            preferred_language VARCHAR(16) DEFAULT 'en',
            timezone           VARCHAR(64),
            created_by         VARCHAR(255),
            updated_by         VARCHAR(255),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ,
            deleted_at         TIMESTAMPTZ,
            deleted_by         VARCHAR(255),
            version            INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_queue (
            id          BIGSERIAL PRIMARY KEY,
            business_id INTEGER,
            entity_type VARCHAR(50) NOT NULL,
            entity_id   INTEGER NOT NULL,
            operation   VARCHAR(20) NOT NULL,
            payload     TEXT,
            status      VARCHAR(20) DEFAULT 'pending',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            synced_at   TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id          BIGSERIAL PRIMARY KEY,
            table_name  VARCHAR(50) NOT NULL,
            record_id   INTEGER,
            action      VARCHAR(20) NOT NULL,
            actor       VARCHAR(255),
            change_json TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS analytics_snapshots (
            id              BIGSERIAL PRIMARY KEY,
            business_id     INTEGER,
            snapshot_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
            metric_key      VARCHAR(50) NOT NULL,
            metric_value    DOUBLE PRECISION,
            dimensions_json TEXT
        )
        """
    )

    # ------------------------------------------------------------------
    # 2. Add columns that earlier phases may not have created. Every
    #    column here is either nullable or has a DEFAULT, so the ALTER can
    #    never fail against a table that already contains rows.
    # ------------------------------------------------------------------
    _add_columns(
        "businesses",
        [
            "owner_id VARCHAR(255)",
            "owner_email VARCHAR(255)",
            "industry VARCHAR(100)",
            "currency VARCHAR(8) DEFAULT 'USD'",
            "address VARCHAR(500)",
            "phone VARCHAR(20)",
            "tax_id VARCHAR(100)",
            "website VARCHAR(255)",
            "timezone VARCHAR(64)",
            "created_by VARCHAR(255)",
            "updated_by VARCHAR(255)",
            "updated_at TIMESTAMPTZ",
            "deleted_at TIMESTAMPTZ",
            "deleted_by VARCHAR(255)",
            "version INTEGER NOT NULL DEFAULT 1",
        ],
    )
    _add_columns(
        "products",
        [
            "category VARCHAR(100)",
            "cost_price DOUBLE PRECISION",
            "reorder_level INTEGER NOT NULL DEFAULT 5",
            "created_by VARCHAR(255)",
            "updated_by VARCHAR(255)",
            "updated_at TIMESTAMPTZ",
            "deleted_at TIMESTAMPTZ",
            "deleted_by VARCHAR(255)",
            "version INTEGER NOT NULL DEFAULT 1",
        ],
    )
    _add_columns(
        "customers",
        [
            "password_hash VARCHAR(255)",
            "created_by VARCHAR(255)",
            "updated_by VARCHAR(255)",
            "updated_at TIMESTAMPTZ",
            "deleted_at TIMESTAMPTZ",
            "deleted_by VARCHAR(255)",
            "version INTEGER NOT NULL DEFAULT 1",
        ],
    )
    _add_columns(
        "orders",
        [
            "created_by VARCHAR(255)",
            "updated_by VARCHAR(255)",
            "updated_at TIMESTAMPTZ",
            "deleted_at TIMESTAMPTZ",
            "deleted_by VARCHAR(255)",
            "version INTEGER NOT NULL DEFAULT 1",
        ],
    )
    _add_columns(
        "order_items",
        [
            "created_by VARCHAR(255)",
            "updated_by VARCHAR(255)",
            "updated_at TIMESTAMPTZ",
            "deleted_at TIMESTAMPTZ",
            "deleted_by VARCHAR(255)",
            "version INTEGER NOT NULL DEFAULT 1",
        ],
    )

    # ------------------------------------------------------------------
    # 3. Missing foreign keys on pre-existing tables (guarded by name).
    # ------------------------------------------------------------------
    _add_fk("orders", "fk_orders_customer_id", "customer_id", "customers", "id")
    _add_fk("order_items", "fk_order_items_order_id", "order_id", "orders", "id")
    _add_fk("order_items", "fk_order_items_product_id", "product_id", "products", "id")
    _add_fk("stock_movements", "fk_stock_movements_product_id", "product_id", "products", "id")

    # ------------------------------------------------------------------
    # 4. Uniqueness rules (Task 11 / audit H2 + products SKU parity).
    #    Swap any legacy FULL unique constraint/index for the live-rows-only
    #    partial unique index. Duplicate resolution must happen BEFORE this
    #    runs (see tools/inspect_db_schema.py output).
    # ------------------------------------------------------------------
    # Customers: drop legacy full uniques on (business_id, email) and on
    # (email), under every name Postgres or an earlier ORM could have used.
    for name in (
        "uq_customers_business_email",
        "customers_business_id_email_key",
        "customers_email_key",
    ):
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'customers'::regclass
                      AND conname = '{name}' AND contype = 'u'
                ) THEN
                    ALTER TABLE customers DROP CONSTRAINT {name};
                END IF;
            END $$;
            """
        )
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_business_email
            ON customers (business_id, email) WHERE deleted_at IS NULL
        """
    )

    # Products: drop legacy global unique on sku, then install the
    # tenant-scoped, live-rows-only partial index.
    for name in ("uq_products_sku", "products_sku_key", "products_sku_unique"):
        op.execute(
            f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'products'::regclass
                      AND conname = '{name}' AND contype = 'u'
                ) THEN
                    ALTER TABLE products DROP CONSTRAINT {name};
                END IF;
            END $$;
            """
        )
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
            ON products (business_id, sku) WHERE deleted_at IS NULL
        """
    )

    # ------------------------------------------------------------------
    # 5. Frequently queried indexes.
    # ------------------------------------------------------------------
    op.execute("CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON businesses (owner_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_businesses_owner_email ON businesses (owner_email)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_products_business ON products (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_business ON customers (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_orders_business ON orders (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_order_items_business ON order_items (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_business ON stock_movements (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id)")


def _add_columns(table: str, columns: list[str]) -> None:
    for col in columns:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col}")


def _add_fk(table: str, name: str, column: str, ref_table: str, ref_column: str) -> None:
    op.execute(
        f"""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = '{table}'::regclass AND conname = '{name}'
            ) THEN
                ALTER TABLE {table} ADD CONSTRAINT {name}
                    FOREIGN KEY ({column}) REFERENCES {ref_table} ({ref_column});
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Baseline migration: no destructive downgrade is provided. Reverting to a
    # pre-Task-11 schema would require dropping the partial unique indexes and
    # restoring the legacy constraints — deliberately out of scope.
    pass
