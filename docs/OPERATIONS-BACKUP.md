# Backup & recovery readiness

BrewSync stores all business data in the Supabase PostgreSQL project (schema `brewsync`). The
application itself does **not** run or schedule backups, and this document does not claim that any
backup exists — check the facts below in the Supabase dashboard.

## What to verify (owner / operator)

1. **Supabase → Project Settings → Database → Backups.** Daily backups and their retention depend on
   the Supabase plan. Point-in-time recovery (PITR) is a paid add-on. Confirm what your plan provides.
2. **Off-site copy.** For an independent copy, run a scheduled logical dump from a trusted machine:
   `pg_dump --schema=brewsync --format=custom --file=brewsync-YYYYMMDD.dump "$DATABASE_URL"`
   (keep the connection string out of shell history and source control; store dumps encrypted).
3. **Restore drill.** At least quarterly, restore a dump into a scratch database/schema and check
   that orders, payments, refunds, stock levels and movements are present.
4. **Product images** live in Supabase Storage; include the bucket in your backup plan if needed.

## Data-safety properties the application guarantees

- Orders, payments, refunds, documents, stock movements and audit logs are append-only or
  status-only; history is never rewritten by catalog, price, recipe or cost changes.
- Products, choice options and ingredients with history are deactivated, never deleted.
- Migrations are additive and reversible; apply them in a transaction and record the head version.
