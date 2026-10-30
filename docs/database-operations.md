# Database operations

Production data lives in the Railway PostgreSQL instance referenced by
`DATABASE_URL`. Everything the application shows — companies, shipments, RFQs,
quotes, bookings, users — is stored there. Treat that cluster as the only copy
of production data until a backup exists somewhere else.

## Why data can disappear

A database only keeps data when all three conditions hold:

1. **The server has a persistent volume.** Railway services built from a plain
   image keep their filesystem inside the container. If the Postgres service has
   no volume mounted at `/var/lib/postgresql/data`, every restart or redeploy
   starts from an empty data directory.
2. **Nothing resets the schema.** `prisma migrate reset`,
   `prisma db push --force-reset`, and `prisma migrate dev` (when it decides the
   database has drifted) all drop data. Never run them with a production
   `DATABASE_URL`.
3. **Tests never point at production.** `pnpm test` creates real rows when
   `DATABASE_URL` is set. The API now ignores a non-local `DATABASE_URL` during
   tests, but `NAQL_ALLOW_REMOTE_DB_TESTS=1` overrides that guard — use it only
   for a disposable test database.

### Railway checklist (do this once per database service)

- Open the Postgres service → **Volumes**. A volume must exist and be mounted at
  `/var/lib/postgresql/data`.
- Open the service → **Backups** (if the plan includes them). Enable scheduled
  backups and note the retention window.
- In the API service, confirm `DATABASE_URL` points at this Postgres service and
  that `NODE_ENV=production` is set.
- After the first successful seed, take a manual backup with `pnpm db:backup`.

## Backups

`db:backup` exports every table to a JSON file. The file contains personal data
(email addresses, password hashes, company records), so keep it off source
control and share it only over a private channel.

The table list is checked against the generated Prisma datamodel on every run.
Before writing anything, the script also queries `information_schema` and fails
if the connected database is missing any schema table. This prevents a successful
but incomplete backup after a deployment skipped a migration. `CompanyInvitation`
and `ShipmentParty` are included.

```powershell
# Writes to <repo>/backups/naql-backup-<timestamp>.json
pnpm db:backup

# Write somewhere else (for example an encrypted drive)
pnpm --filter @naql/api db:backup -- --out "D:\naql-backups\prod.json"
```

Schedule it with Windows Task Scheduler, for example daily at 02:00:

```powershell
schtasks /Create /SC DAILY /ST 02:00 /TN "NAQL AI database backup" /TR "powershell -NoProfile -Command \"cd 'E:\naql ai'; pnpm db:backup\""
```

Copy the resulting files to storage that is not the Railway volume itself. A
backup on the same disk as the database does not survive the disk being deleted.

## Restore

Always restore into an empty database, or pass `--replace` to delete the target
rows first. The delete and the insert run in one transaction, and row counts are
verified before commit.

The restore refuses a backup file that is missing any table required by the
current schema; do not bypass that check. `--replace` is allowed only for a
database whose name clearly marks it as disposable (`test`, `testing`, `restore`,
or `drill`). For any other target the operator must explicitly set
`NAQL_ALLOW_DESTRUCTIVE_RESTORE=1`, and should do so only after confirming the
target is disposable. The local development database `naql_ai` is rejected by
default.

```powershell
# Inspect first: prints incoming and existing row counts, writes nothing
pnpm --filter @naql/api db:restore -- --file backups/naql-backup-2026-10-20_01-00-00.json --dry-run

# Restore into an empty database
pnpm --filter @naql/api db:restore -- --file backups/naql-backup-2026-10-20_01-00-00.json

# Overwrite the current contents
pnpm --filter @naql/api db:restore -- --file backups/naql-backup-2026-10-20_01-00-00.json --replace
```

### Phase 1 restore drill (2026-10-21)

Run against disposable local databases only; production was not touched.

- Source: `naql_ai_phase1_source`; target: `naql_ai_phase1_restore`.
- Both were created separately and received all four migrations.
- Fixture rows: organization, user, membership, company, company service,
  company document, company invitation, two ports, shipment, milestone, document,
  and shipment party (13 rows total).
- Backup produced all 23 table keys. Dry-run restore reported 13 incoming rows.
- Restore inserted 13 rows and the post-insert count check passed.
- Verification confirmed invitation relations, owner role, Decimal
  `12345.678`, nullable `volumeCbm`, dates, shipment party permission flags, and
  private document ownership.
- A marker audit row was added and `--replace` restore removed it, returning the
  target to exactly 13 rows.
- Restoring a fixture with the `ShipmentParty` key removed failed before touching
  the target: `Backup is incomplete; it is missing: shipmentParty`.
- A disposable database with the `ShipmentParty` table dropped failed backup
  before writing a file: `Database is missing required tables: ShipmentParty`.
- `--replace --dry-run` against the normal local `naql_ai` database was refused
  with the destructive-restore guard.

### Phase 2 restore drill (2026-10-21)

Run against disposable local databases only; production was not touched.

- Source: local `naql_ai_phase1_api`.
- Target: disposable `naql_ai_phase2_restore_20261021`, created separately and
  migrated with all five migrations.
- Backup produced all **31 table keys** and **2,131 rows**.
- The backup included 11 `documentExtraction`, 8 `documentFinding`,
  11 `copilotConversation`, 22 `copilotMessage`, 6 `shipmentRiskAssessment`,
  and 6 `shipmentDelayEstimate` rows. `aiExecution` had no rows in this test
  database.
- Restore inserted every row and the per-table count check passed before commit.
- The target database and temporary JSON backup were removed after verification.
- Production/disaster-recovery restore remains unverified.

## Migrations and a fresh database

`prisma migrate deploy` applies pending migrations. It refuses to run when the
database has tables but no `_prisma_migrations` table (the "schema is not empty"
error). That happens when a schema was created with `prisma db push`.

To adopt an existing schema into the migration history, mark each known
migration as already applied, once:

```powershell
pnpm --filter @naql/api exec prisma migrate resolve --applied 20261019000728_init
pnpm --filter @naql/api exec prisma migrate resolve --applied 20261019010000_membership_multi_role_and_indexes
pnpm --filter @naql/api exec prisma migrate resolve --applied 20261019050000_admin_platform_roles
pnpm db:status
```

After that the normal deploy path is:

```powershell
pnpm db:deploy   # prisma migrate deploy
pnpm db:seed     # idempotent reference data (ports)
```

Run `pnpm db:deploy` as a Railway pre-deploy command so a release can never start
against a schema that is missing a migration.

## Demo data

`db:seed:demo` creates five provider organizations, five provider users, five
listed companies (with services and a verification review each), five shipments
(with milestones and documents), five RFQs, five quotes, five bookings with
tracking, five quotation requests with offers, and five audit entries. It targets
the oldest ordinary account so that user immediately sees the data after signing
in.

Every company description starts with `بيانات تجريبية للعرض — ليست شركة حقيقية`,
so the directory never presents demo records as real businesses. Ids are fixed
(`demo-company-1`, `demo-shipment-1`, ...), so re-running the command updates the
same rows instead of duplicating them.

Demo companies are seeded as `pending` and their document rows are marked
`metadata_only`. They must never be used to demonstrate a verified badge; the
secure company-document upload required for real verification is not implemented
yet.

```powershell
# Requires ports: run pnpm db:seed first
pnpm db:seed:demo -- --yes     # --yes is required for a non-local database
pnpm db:seed:demo:remove -- --yes
```

Do not use demo data to make commercial or verification claims. Remove it before
the platform goes live with real users.

## After a data-loss incident

1. Stop writing to the database (scale the API down) so the loss does not grow.
2. Check Railway: Postgres service → Backups, and the volume's history. A
   restored volume or backup is the only way to get deleted rows back; the
   application has no undo.
3. If no backup exists, recreate the reference data (`pnpm db:seed`) and have
   users re-register. Do not import a local development database into
   production: it contains automated test accounts and companies.
4. Record the cause in this file and add the missing safeguard (volume, backup,
   pre-deploy migration, test guard).
