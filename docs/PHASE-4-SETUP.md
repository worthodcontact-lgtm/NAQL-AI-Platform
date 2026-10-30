# Phase 4 local and staging setup

## Local development

1. Use Node.js 20+, pnpm 9, Python 3.12, and PostgreSQL compatible with the repository migrations.
2. Copy `.env.example` to `.env`; use a disposable local database URL. Never point tests at staging or production.
3. Install workspace dependencies with `pnpm install`.
4. Generate the Prisma client with `pnpm db:generate`.
5. For a **new disposable database only**, inspect migrations and use `pnpm --filter @naql/api run prisma:deploy`. `pnpm db:status` reports migration state. Do not use reset commands on any database with user data.
6. Seed reference ports only through the documented seed flow after reviewing its target. Start API/web with `pnpm dev`.
7. Keep `AI_PROVIDER=none` and `EMAIL_PROVIDER=none` for ordinary development. Set optional credentials only in an untracked server-side `.env`; never use `NEXT_PUBLIC_` for secrets. Email delivery additionally requires a verified `EMAIL_FROM`; configuration still reports `UNVERIFIED` until a controlled send succeeds.
8. Keep `RATE_LIMIT_MAX=100` in normal environments. Raise it only for a private test server with no public exposure.

The current `apps/api/.env` in this workspace points at a local development database. Both Phase 4 migrations (`20261022010000_phase4_rfq_lifecycle` and `20261024090000_phase4_notification_delivery`) have been applied to local disposable test/development databases only. Future migrations must be tested against a separate disposable database first. No production migrations/deploys are authorized by this work.

## Tests and checks

- `pnpm --filter @naql/api test`: without a disposable local `DATABASE_URL`, database-backed tests are skipped. With a dedicated DB, run migrations first; tests create data and some fixtures may persist.
- `pnpm --filter @naql/api run typecheck`
- `pnpm --filter @naql/web run typecheck`
- `pnpm build`
- `pnpm typecheck` (the empty `packages/config` project was removed from the task graph; shared compiler configuration is not a standalone TypeScript project)
- `pnpm test:isolated` for the throwaway PostgreSQL + API + web + Playwright run. It raises `RATE_LIMIT_MAX` only inside its private API process so browser navigation is not throttled.
- Python checks: `python -m py_compile apps/ai-service/main.py`; use the service's development requirements only in an isolated venv.

No Docker is required by the application. Tesseract is an optional native OCR dependency; test Windows executable discovery before enabling OCR.

## Staging and operations still required

- Use a private staging network, TLS, explicit CORS allow-list, strong JWT/admin secrets, managed secret storage, and separate least-privilege database roles.
- Configure durable private object storage, malware scanning, retention, and encrypted backups. Verify document isolation and restore permissions.
- Take a pre-migration backup; run additive migrations on a staging clone; compare migration status and perform business regression tests. Production migration requires a separate approval and maintenance/rollback plan.
- Schedule encrypted backups, retention, and a timed restore drill in staging. The repo has backup/restore scripts; production RPO/RTO are not established.
- Monitor structured logs/request IDs and readiness checks. `GET /ready` is the fast database readiness check; `GET /ready?detailed=1` adds sanitized AI/OCR/storage/email states. Never log tokens, document contents, provider keys, or raw provider errors.
- Execute the browser E2E workflow and cross-tenant security tests on isolated staging fixtures before deployment.

## Database backup/restore

Use `pnpm db:backup` and `pnpm db:restore` only after verifying the exact database target and backup location. Restore tooling is intended to validate table counts and use a transaction where supported. First practice on a newly-created disposable database; do not restore over a user or production database. Record backup encryption, retention, access control, restore duration, and row-count verification in the deployment runbook.
