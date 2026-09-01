"""
Smoke test for the Co-op Intelligent Importer + Day 1 Briefing engine.

Run:  .venv/bin/python backend/tests/smoke_import.py
Exercises parse -> detect -> suggest -> execute -> briefing against a
temporary SQLite DB (no server, no auth).
"""
import asyncio
import os
import sys
import tempfile

# repo root (so the `backend` package is importable)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from backend import importer
from backend import briefing as briefing_mod
from backend.models import Base, Product, Customer, Order, ImportBatch


async def main():
    tmp = tempfile.mkdtemp()
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp}/t.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    print("== 1. PRODUCTS ==")
    prod_csv = (
        "Product Name,Code,Description,Category,Selling Price,Cost,On Hand,Reorder\n"
        "Ergo Chair,CH-001,Mesh ergonomic chair,Seating,499.00,210.00,4,10\n"
        "Standing Desk,DS-002,Electric sit-stand,Seating,599.00,280.00,0,12\n"
        "Monitor Arm,MA-003,Single monitor arm,Accessories,89.50,30.00,42,15\n"
        "Laptop Stand,LS-004,Aluminium stand,Accessories,49.00,18.00,0,8\n"
    )
    parsed = importer.parse_file("products.csv", prod_csv.encode())
    print("  fmt", parsed.fmt, "rows", len(parsed.rows), "headers", parsed.headers)
    ds, conf = importer.detect_dataset(parsed)
    print("  detected", ds, round(conf, 2))
    suggested = importer.suggest_mapping(parsed, ds or "products")
    for m in suggested:
        print(f"    {m.column:18} -> {str(m.target):14} {m.label:7} {m.confidence}")
    mapping = {m.column: m.target for m in suggested}
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed, ds or "products", mapping)
    print("  created", res.created, "skipped", res.skipped, "errors", res.errors)
    print("  warnings", res.warnings)

    print("== 2. CUSTOMERS ==")
    cust_csv = (
        "Client,Email,Phone,Company,Address\n"
        "Acme Corp,accounts@acme.com,555-1000,Acme,""1 High St, Springfield""\n"
        "Globex Inc,ap@globex.com,555-2000,Globex,2 Low Rd\n"
        "Initech,purchasing@initech.io,555-3000,Initech,3 Mid Ave\n"
        "Umbrella Co,orders@umbrella.com,555-4000,Umbrella,4 Elm Blvd\n"
    )
    parsed = importer.parse_file("customers.csv", cust_csv.encode())
    ds, _ = importer.detect_dataset(parsed)
    print("  detected", ds, "rows", len(parsed.rows))
    suggested = importer.suggest_mapping(parsed, ds or "customers")
    mapping = {m.column: m.target for m in suggested}
    for m in suggested:
        print(f"    {m.column:18} -> {str(m.target):14} {m.label:7} {m.confidence}")
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed, ds or "customers", mapping)
    print("  created", res.created, "skipped", res.skipped, "errors", res.errors)

    print("== 3. ORDERS (sales history) ==")
    ord_csv = (
        "Order Date,Order No,Client Name,Item,SKU,Qty,Price,Total\n"
        "2026-05-02,#1001,Acme Corp,Ergo Chair,CH-001,2,499.00,998.00\n"
        "2026-05-20,#1002,Globex Inc,Standing Desk,DS-002,1,599.00,599.00\n"
        "2026-06-01,#1003,Acme Corp,Monitor Arm,MA-003,4,89.50,358.00\n"
        "2026-06-15,#1004,Initech,Ergo Chair,CH-001,3,499.00,1497.00\n"
        "2026-06-28,#1005,Umbrella Co,Monitor Arm,MA-003,6,89.50,537.00\n"
        "2026-07-10,#1006,Acme Corp,Standing Desk,DS-002,2,599.00,1198.00\n"
        "2026-07-22,#1007,Globex Inc,Laptop Stand,LS-004,5,49.00,245.00\n"
        "2026-08-05,#1008,Initech,Ergo Chair,CH-001,4,499.00,1996.00\n"
        "2026-08-18,#1009,Acme Corp,Monitor Arm,MA-003,8,89.50,716.00\n"
    )
    parsed = importer.parse_file("sales.csv", ord_csv.encode())
    ds, conf = importer.detect_dataset(parsed)
    print("  detected", ds, round(conf, 2), "rows", len(parsed.rows))
    suggested = importer.suggest_mapping(parsed, ds or "orders")
    mapping = {m.column: m.target for m in suggested}
    for m in suggested:
        print(f"    {m.column:18} -> {str(m.target):14} {m.label:7} {m.confidence}")
    # Spec item 6: read-only validation BEFORE any writes.
    async with Session() as db:
        v = await importer.validate_import(db, 1, parsed, ds or "orders", mapping)
    print(f"  VALIDATE: {v.total_rows} received, {v.valid_rows} valid, "
          f"dups(existing/in_file)={v.duplicates['existing']}/{v.duplicates['in_file']}, "
          f"unknown_refs={v.unknown_refs}, would_create={v.would_create}, "
          f"error_fields={v.error_fields}")
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed, ds or "orders", mapping)
    print("  batch_id", res.batch_id)
    print("  created", res.created, "skipped", res.skipped)
    print("  errors", res.errors)
    print("  warnings", res.warnings)

    print("== 4. DAY 1 BRIEFING ==")
    async with Session() as db:
        out = await briefing_mod.build_briefing(db, 1)
    print("  ready", out["ready"])
    print("  history", out["history"])
    for i in out["insights"]:
        action = (
            f"  [ACTION {i['action']['type']} -> "
            f"customer {i['action']['customer']['full_name']} x product "
            f"{i['action']['product']['name'] if i['action']['product'] else None}]"
            if i["action"]
            else ""
        )
        print(f"  [{i['severity']:8}] {i['title']}")
        print(f"             {i['body']}{action}")

    print("== 5. DUPLICATE POLICY (re-import same customers) ==")
    parsed_c2 = importer.parse_file("customers.csv", cust_csv.encode())
    suggested_c2 = importer.suggest_mapping(parsed_c2, "customers")
    mapping_c2 = {m.column: m.target for m in suggested_c2}
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed_c2, "customers", mapping_c2)
    print("  created", res.created, "skipped", res.skipped, "errors", res.errors)
    async with Session() as db:
        p = (await db.execute(select(func.count(Product.id)))).scalar()
        c = (await db.execute(select(func.count(Customer.id)))).scalar()
        o = (await db.execute(select(func.count(Order.id)))).scalar()
        b = (await db.execute(select(func.count(ImportBatch.id)))).scalar()
        # provenance check: every imported order is stamped with a batch
        stamped = (await db.execute(
            select(func.count(Order.id)).where(Order.import_batch_id.is_not(None)))).scalar()
    print(f"DB totals: products= {p} customers= {c} orders= {o} import_batches= {b} (orders"
        f"stamped {stamped} / {o} )")

    print("== 6. REF IDEMPOTENCY (re-import the same sales file) ==")
    parsed_r = importer.parse_file("sales.csv", ord_csv.encode())
    suggested_r = importer.suggest_mapping(parsed_r, "orders")
    mapping_r = {m.column: m.target for m in suggested_r}
    assert mapping_r.get("Order No") == "order_id", f"Order No not mapped: {mapping_r}"
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed_r, "orders", mapping_r)
    print("  created", res.created, "skipped", res.skipped)
    assert res.created["orders"] == 0, "re-import must not create orders"
    assert res.skipped["existing"] == 9, "all 9 refs should be skipped as existing"
    print("  OK: re-import is a no-op via source_order_ref")

    print("== 7. NAME AMBIGUITY + PHONE MATCH ==")
    async with Session() as db:
        db.add(Customer(business_id=1, full_name="John Smith", email="js1@example.com"))
        db.add(Customer(business_id=1, full_name="John Smith", email="js2@example.com"))
        db.add(Customer(business_id=1, full_name="Phone Person", email="phone@example.com",
                        phone="+234 803 555 1234"))
        await db.commit()
    amb_csv = (
        "Customer Name,Phone,Product,Qty,Price,Date\n"
        "John Smith,,Ergo Chair,1,100.00,2026-08-01\n"
        "Phone Person,+234 803 555 1234,Laptop Stand,1,49.00,2026-08-02\n"
    )
    parsed_a = importer.parse_file("amb.csv", amb_csv.encode())
    suggested_a = importer.suggest_mapping(parsed_a, "orders")
    mapping_a = {m.column: m.target for m in suggested_a}
    async with Session() as db:
        v = await importer.validate_import(db, 1, parsed_a, "orders", mapping_a)
    print(f"  VALIDATE: ambiguous={v.ambiguous} would_create={v.would_create}")
    assert v.ambiguous["customers"] == 1, "the duplicate-name row must be flagged, not guessed"
    async with Session() as db:
        res = await importer.execute_import(db, 1, parsed_a, "orders", mapping_a)
    print("  created", res.created, "skipped", res.skipped, "errors", res.errors)
    assert res.created["orders"] == 1 and res.skipped["errors"] == 1
    assert "multiple customers are named" in res.errors[0]["detail"]
    async with Session() as db:
        phone_cust = (await db.execute(select(Customer).where(
            Customer.business_id == 1, Customer.email == "phone@example.com"))).scalars().first()
        o = (await db.execute(select(Order).where(
            Order.business_id == 1, Order.customer_id == phone_cust.id,
            Order.source_order_ref.is_(None)))).scalars().first()
        assert o is not None, "phone-matched row must create an order for the right customer"
        assert o.total_amount == 49.0
        print("  OK: ambiguous name rejected; phone number matched the right customer")

    await engine.dispose()
    print("\nSMOKE TEST COMPLETE")


if __name__ == "__main__":
    asyncio.run(main())
