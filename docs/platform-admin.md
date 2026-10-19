# Platform Administration (NAQL AI)

This document describes the independent platform-administration area: its security model,
permission matrix, API, web routes, provisioning, recovery, and known limitations.

The guiding rule is simple: **organization authority and platform authority are separate.**
Owning a company, holding `ORG_ADMIN`, or registering with a suggestive email never grants
access to `/admin/*` or `/api/v1/admin/*`.

---

## 1. Security model

| Property | Implementation |
|---|---|
| Separate login | `POST /api/v1/admin/auth/login`; token has `scope: "admin"` and is stored under `naql_admin_token` (not the ordinary `token`) |
| Separate bearer token | `adminFetch` sends only the admin token; ordinary API calls send only the app token |
| DB-backed principal | `authenticate` reloads `platformRole`, `status`, and `sessionVersion` from the database on **every** request |
| Token lifetime | Admin tokens expire after `ADMIN_JWT_EXPIRES_IN` (default 8h); ordinary tokens after `JWT_EXPIRES_IN` (default 12h). Legacy admin tokens without `exp` are rejected with `401 session_expired` |
| Suspension | `status = "suspended"` → `403 account_suspended` |
| Immediate revocation | `sessionVersion` is stored in the token as `sv`; suspend, reactivate, role change, password reset, and admin logout increment it → `401 session_revoked` |
| Logout | `POST /admin/auth/logout` revokes **all** tokens for the account server-side, then the browser clears its copy. It is not merely a client-side discard |
| Authorization | Each route declares `requirePermission(...)`; the permission matrix is the single source of truth in `apps/api/src/auth/permissions.ts` |
| No client-trusted role | The API never reads a platform role from a header, body, query, or localStorage |
| No public elevation | No registration, profile, company, or organization endpoint can write `platformRole` |
| Business overrides | The ordinary customer/provider API only honours a platform role when the token has `scope: "admin"`; an ordinary app token never gains cross-tenant staff overrides |
| Audit | High-risk actions are appended to `AuditLog` with actor, role, action, entity, outcome, request ID, and redacted metadata |
| Atomic high-risk audit | Role change, suspension, reactivation, company verification, settings write, and port edit commit together with their audit row. If the audit insert fails, the business change rolls back |
| Response hardening | API sends `Cache-Control: no-store` for auth/admin responses, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy`; the web app sends the same browser headers |
| Safe errors | Unhandled server errors return a generic `500 internal_error` with a request ID; Prisma/SQL messages never reach the client |
| Admin requires PostgreSQL | Without `DATABASE_URL` the admin API returns `503 admin_requires_database`; there is no in-memory admin mode |

### 1.1 Production prerequisites

- `JWT_SECRET` must be random and at least 32 characters. The API refuses to start in
  production with the development default or a shorter value.
- `CORS_ORIGINS` must be an explicit comma-separated allow-list in production.
- `ADMIN_JWT_EXPIRES_IN` (default `8h`) and `JWT_EXPIRES_IN` (default `12h`) use the
  `<number><s|m|h|d>` form.
- Terminate TLS at the reverse proxy and enable HSTS there or via this API's production
  header. The API only emits `Strict-Transport-Security` when `NODE_ENV=production`.
- Back up PostgreSQL before applying migrations; no automated backup is included.

The web guard (`AdminGuard`) is **UX only**. The API is the security boundary: any admin
route can be called directly and is still authorized server-side.

---

## 2. Roles and permission matrix

Platform roles live in `User.platformRole` and are independent of `Membership.role`.

| Permission | SUPER_ADMIN | ADMIN | REVIEWER | SUPPORT |
|---|:---:|:---:|:---:|:---:|
| `admin.access` | ✅ | ✅ | ✅ | ✅ |
| `metrics.read` | ✅ | ✅ | ✅ | ✅ |
| `users.read` | ✅ | ✅ | ✅ | ✅ |
| `users.manage` (suspend / reactivate) | ✅ | ✅ | — | — |
| `users.roles` (assign platform roles) | ✅ | — | — | — |
| `companies.read` | ✅ | ✅ | ✅ | ✅ |
| `companies.verify` | ✅ | ✅ | ✅ | — |
| `shipments.read` | ✅ | ✅ | — | ✅ |
| `shipments.manage` (business override) | ✅ | ✅ | — | — |
| `bookings.read` | ✅ | ✅ | — | ✅ |
| `bookings.manage` (business override) | ✅ | ✅ | — | — |
| `rfqs.read` | ✅ | ✅ | — | ✅ |
| `quotations.read` | ✅ | ✅ | — | ✅ |
| `ports.read` | ✅ | ✅ | — | ✅ |
| `ports.manage` | ✅ | ✅ | — | — |
| `reports.read` | ✅ | ✅ | ✅ | — |
| `audit.read` | ✅ | ✅ | ✅ | — |
| `settings.read` | ✅ | ✅ | ✅ | ✅ |
| `settings.manage` | ✅ | — | — | — |

Least-privilege rationale:

- **REVIEWER** is focused on company verification and read-only oversight. It cannot change
  users, ports, or platform settings.
- **SUPPORT** sees operational records to answer customer questions but cannot mutate them,
  verify companies, read the audit log, or change settings.
- **ADMIN** operates the platform but cannot grant/revoke platform roles or change settings;
  those remain Super-Admin-only.
- **SUPER_ADMIN** holds every permission, plus the invariants below.

### Invariants enforced by the API

1. A user cannot change their own platform role (`409 cannot_change_own_role`) or suspend
   themselves (`409 cannot_suspend_self`).
2. A non-Super-Admin cannot modify a Super-Admin account (`403 super_admin_required`).
3. The last active Super Admin cannot be suspended or demoted (`409 last_super_admin`). The
   count and update run in one transaction under a PostgreSQL advisory lock, so two concurrent
   demotions cannot both observe the same count and leave zero Super Admins.
4. Every platform-role change, suspension, reactivation, settings write, and port edit is audited
   in the same transaction as the change.
5. `port.latitude` / `port.longitude` are immutable through the admin API.
6. Verification decisions never claim government accreditation.

---

## 3. Data model and migration

Additive migration: `apps/api/prisma/migrations/20261019050000_admin_platform_roles/migration.sql`.

| Change | Detail |
|---|---|
| `User.platformRole` | `TEXT NULL`; one of `SUPER_ADMIN`, `ADMIN`, `REVIEWER`, `SUPPORT` |
| `User.status` | `TEXT NOT NULL DEFAULT 'active'`; `active` or `suspended` |
| `User.sessionVersion` | `INTEGER NOT NULL DEFAULT 0` |
| `User.lastLoginAt` | `TIMESTAMP(3) NULL` |
| `PlatformSetting` | New table: `key` (PK), `value`, `updatedByUserId`, timestamps |

No existing table was dropped, no column was renamed, and no row was deleted. Existing users,
organizations, memberships, RFQs, quotations, bookings, shipments, ports, and migrations are
preserved. The migration was applied with `prisma migrate deploy`, not by resetting the database.

Only these platform settings are editable, and only by a Super Admin:

- `platformName` (2–80 chars; cannot be cleared)
- `supportEmail` (valid email; an empty string deletes the setting)
- `maintenanceMessage` (≤ 500 chars; an empty string deletes the setting)

There is intentionally **no** arbitrary environment-variable editor and no secret storage in
`PlatformSetting`.

---

## 4. API endpoints

All paths are prefixed with `/api/v1/admin`. Every route except login requires an
admin-scope token; the data routes additionally require the permission shown.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public (rate-limited) | Admin-only login; rejects non-staff and suspended accounts |
| GET | `/auth/me` | session | Fresh DB principal + effective permissions |
| POST | `/auth/logout` | session | Audited logout that revokes all account sessions server-side |
| GET | `/overview` | `metrics.read` | Real DB counts; `recentAuditVisible` reflects `audit.read` |
| GET | `/reports` | `reports.read` | Status distributions, top organizations, per-currency quote totals |
| GET | `/audit-logs` | `audit.read` | Paginated, filtered audit log with safe metadata |
| GET | `/settings` | `settings.read` | Public/operational settings + integration configuration presence |
| PUT | `/settings` | `settings.manage` | Update the three whitelisted settings |
| GET | `/ports` | `ports.read` | Paginated port reference data |
| PATCH | `/ports/:id` | `ports.manage` | Update `name`, `type`, `source` only |
| GET | `/users` | `users.read` | Search/filter/paginate users |
| GET | `/users/:id` | `users.read` | User, memberships, owned companies, recent activity |
| POST | `/users/:id/suspend` | `users.manage` | Suspend + revoke sessions; reason required |
| POST | `/users/:id/reactivate` | `users.manage` | Reactivate + revoke old sessions |
| PUT | `/users/:id/platform-role` | `users.roles` | Assign/clear role + revoke sessions; reason required |
| GET | `/platform-roles` | `users.read` | Role catalogue for the UI |
| GET | `/companies` | `companies.read` | Company directory with verification filter |
| GET | `/companies/:id` | `companies.read` | Company, services, documents (metadata), reviews, organization memberships |
| POST | `/companies/:id/verify` | `companies.verify` | `approved` / `rejected` / `needs_information` + notes |
| GET | `/shipments` | `shipments.read` | Paginated logistics view |
| GET | `/shipments/:id` | `shipments.read` | Shipment, milestones, documents, quotation requests |
| GET | `/bookings` | `bookings.read` | Paginated bookings with organization/provider labels |
| GET | `/bookings/:id` | `bookings.read` | Booking, RFQ, accepted quote, tracking events |
| GET | `/rfqs` | `rfqs.read` | Paginated RFQs |
| GET | `/rfqs/:id` | `rfqs.read` | RFQ, recipients, quotes, bookings |
| GET | `/quotations` | `quotations.read` | Paginated quotes |
| GET | `/quotations/:id` | `quotations.read` | Quote, items, RFQ, bookings |

Error semantics:

- `401 unauthorized` — missing or invalid token.
- `401 session_expired` — a legacy admin token without an `exp` claim.
- `401 session_revoked` — the token's `sv` no longer matches the account.
- `403 account_suspended` — the account is suspended.
- `403 admin_session_required` — a valid **ordinary** token was used against the admin namespace.
- `403 insufficient_permission` — authenticated staff without the required permission.
- `403 not_platform_staff` — a valid ordinary account attempting admin login.
- `409` — self-modification, last-Super-Admin guard, invalid state transitions.
- `429` — per-IP rate limit (20 failed/successful attempts per minute on each login route).
- `500 internal_error` — generic server error with a `requestId`; no internal message is returned.
- `503 admin_requires_database` — no PostgreSQL configured.

No response includes password hashes, `sessionVersion`, storage keys, or integration secrets.
Date filters accept `YYYY-MM-DD`; the `to` bound covers the whole UTC day, not just midnight.

---

## 5. Web routes

| Route | Purpose |
|---|---|
| `/admin/login` | Standalone dark login; ordinary customers are told they have no admin access |
| `/admin` | Redirects to `/admin/dashboard` |
| `/admin/dashboard` | Real metrics, shipment status distribution, service health, recent audit |
| `/admin/users`, `/admin/users/[id]` | Search, inspect, suspend/reactivate, assign roles |
| `/admin/companies`, `/admin/companies/[id]` | Directory and full company file + verification |
| `/admin/verifications` | Pending queue with approve / request-info / reject actions |
| `/admin/shipments`, `/admin/shipments/[id]` | Read-only logistics views |
| `/admin/bookings`, `/admin/bookings/[id]` | Read-only booking views |
| `/admin/rfqs`, `/admin/rfqs/[id]` | Read-only RFQ views |
| `/admin/quotations`, `/admin/quotations/[id]` | Read-only quote views |
| `/admin/ports` | Reference data; coordinate display is immutable |
| `/admin/reports` | Operational aggregates |
| `/admin/audit-logs` | Filterable append-only audit trail |
| `/admin/settings` | Whitelisted settings, environment status, integrations |

Navigation items are hidden when the role lacks the matching permission, and destructive
actions require a confirmation dialog with a documented reason.

---

## 6. Provisioning the first Super Admin

There is no public endpoint, seed credential, email-prefix rule, or default admin account.

### 6.1 Prerequisites

- PostgreSQL is running and `DATABASE_URL` points at the platform database.
- Migrations are applied.
- `ADMIN_BOOTSTRAP_SECRET` is set for the provisioning shell only: at least 16 characters,
  not a common word, and different from `JWT_SECRET`.
- The operator can type the password at a TTY, or set `NAQL_ADMIN_PASSWORD` in CI.

### 6.2 Create

From the repository root (PowerShell):

```powershell
$env:ADMIN_BOOTSTRAP_SECRET = "<long-random-value>"
pnpm --filter @naql/api admin -- create --email admin@example.com --name "Platform Admin"
Remove-Item Env:ADMIN_BOOTSTRAP_SECRET
```

The CLI prompts for a password twice with masked input (minimum 12 characters) and hashes it
with bcrypt cost 12. It never accepts the password as a command-line argument and never logs
it. The default role is `SUPER_ADMIN`; pass `--role ADMIN|REVIEWER|SUPPORT` for additional staff.

The command refuses to run when:

- the secret is missing, shorter than 16 characters, weak, or equal to `JWT_SECRET`;
- no database is configured;
- the email already exists;
- the password is too short or the confirmation does not match.

### 6.3 Verify

1. Open `http://localhost:3000/admin/login`.
2. Sign in with the provisioned email and password.
3. Confirm the dashboard loads real counts and the role badge shows **مدير منصة أعلى**.
4. Confirm the same credentials do **not** grant organization-owner powers, and that an
   ordinary login at `/login` does not open `/admin/dashboard`.

Remove `ADMIN_BOOTSTRAP_SECRET` from the environment after provisioning.

### 6.4 Additional staff

```powershell
pnpm --filter @naql/api admin -- set-role --email reviewer@example.com --role REVIEWER
```

Alternatively, a Super Admin can assign roles from `/admin/users/[id]`. Both paths are audited
and both increment `sessionVersion`, immediately invalidating existing sessions.

---

## 7. Recovery and lifecycle

| Scenario | Procedure |
|---|---|
| Admin forgot password | `pnpm --filter @naql/api admin -- reset-password --email <email>` (masked prompt; increments session version) |
| Compromised admin | `admin -- disable --email <email>`, then `reset-password` if the account is to be reused |
| Re-enable | `admin -- enable --email <email>` |
| Role change | `admin -- set-role --email <email> --role <ROLE>` or the Super-Admin UI |
| Lost the only Super Admin password | Run `reset-password` from the server host; this requires DB access and the bootstrap secret, not a public endpoint |
| Last Super Admin guard triggered | Promote or create another active Super Admin first, then retry the demotion/suspension |
| Legacy membership-based admins | `pnpm --filter @naql/api admin:import-legacy` is a **dry run** by default; add `--apply` to write. It never runs automatically and never derives authority at request time |
| Audit review | `/admin/audit-logs` (requires `audit.read`) |
| Inventory | `pnpm --filter @naql/api admin -- list` |

`disable` and `enable` are administrative state changes, not deletions. Users are never
hard-deleted by the console; suspension preserves history and referential integrity.

---

## 8. Audit log

`AuditLog` is append-only through the application: no admin endpoint updates or deletes rows.
Each entry stores:

- `actorUserId` and `actorRole` at the time of the action;
- `action` (for example `user.suspended`, `user.platform_role.changed`,
  `company.verify.approved`, `settings.updated`, `port.updated`);
- `entityType` / `entityId`;
- `outcome` (`success`, `denied`, `failure`);
- `requestId` (Fastify request correlation ID);
- redacted `metadata` (passwords, tokens, secrets, and storage keys are removed).

Ordinary users and non-privileged staff cannot read the log. `REVIEWER`, `ADMIN`, and
`SUPER_ADMIN` can; `SUPPORT` cannot.

For the high-risk mutations listed above, `recordAudit(..., { client: tx, throwOnError: true })`
writes the audit row inside the same transaction. Login/logout audit writes remain best-effort:
a failing audit store must not prevent a user from signing in or revoking a session. There is no
update or delete endpoint for `AuditLog`; a database operator with direct access could still
alter rows, so database-level append-only grants/triggers remain deployment hardening.

---

## 9. What this phase deliberately does not include

- No government/customs integration. A company marked **موثّق** passed an internal review; it
  is not government-accredited.
- No email delivery, OCR, object storage, carrier tracking, or AI extraction.
- No notifications, analytics, or file-upload features in the admin area.
- No admin MFA, hardware-key support, or IP allow-listing.
- No cross-currency aggregation: quote totals are reported per currency.

---

## 10. Residual risks

1. **Client guard is not a security boundary.** The admin pages are client-rendered and guarded
   for UX. Anyone can request the HTML; the data still requires a valid admin token and the API
   enforces every permission.
2. **Tokens live in `localStorage`.** This matches the existing application pattern. XSS would be
   able to read the token; the short admin lifetime and server-side logout reduce, but do not
   eliminate, that exposure. See §10.1 for the proposed cookie migration.
3. **No MFA.** A stolen admin password is sufficient to sign in. The bootstrap secret and
   bcrypt cost 12 reduce provisioning risk, not credential theft.
4. **Logout is all-session.** Because one `sessionVersion` covers both ordinary and admin tokens,
   signing out of the console also revokes the same account's ordinary app session. This is
   deliberate for immediate containment; a separate `adminSessionVersion` would preserve the
   other session at the cost of another schema field and token claim.
5. **Audit atomicity is limited to high-risk mutations.** Login/logout audit writes are
   best-effort; a database operator can still alter `AuditLog` directly. Database grants/triggers
   or an append-only external sink are deployment hardening, not application code.
6. **Admin UI has no automated browser E2E suite.** API authorization and persistence are
   covered by 55 automated tests; the console itself is verified by typecheck, production build,
   and manual browser smoke checks.
7. **Legacy quote domain.** The deprecated `quotations` domain and the newer `rfq` domain coexist.
   The admin console reads the newer domain. Unifying them is separate work.
8. **No automated backup/restore.** There is no verified scheduled `pg_dump`/restore procedure in
   the repository. Database backups must be configured at the infrastructure layer before
   production use.
9. **Rate limiting is per process and per IP.** The in-process store is adequate for a single
   instance. Multi-instance deployments need Redis (`REDIS_URL` is present in configuration but
   not wired into `@fastify/rate-limit`) and a correct `trustProxy` setting behind a reverse
   proxy.

### 10.1 Cookie/CSRF migration (proposed, not implemented)

This is an architectural change and was intentionally not made without approval. Options:

- **A. Admin-only HttpOnly cookie (recommended).** Add `@fastify/cookie`; issue an
  `HttpOnly; Secure (production); SameSite=Strict; Path=/api/v1/admin` cookie at
  `/admin/auth/login`; keep the Bearer path for tests/CLI; add a double-submit CSRF token header
  for cookie-authenticated mutations; enable `credentials` on CORS; remove the admin token from
  `localStorage` and make `adminFetch` use `credentials: "include"`. Logout clears the cookie and
  still bumps `sessionVersion`. Cost: API/web/test changes and a staging validation pass.
- **B. Next.js BFF proxy.** Route admin calls through same-origin Next route handlers that hold
  the token server-side; the browser never sees it. Larger change, but avoids cross-origin cookie
  rules and centralizes CSRF protection.
- **C. Keep Bearer + add strict CSP.** Lowest change, but `localStorage` remains readable by any
  XSS. The current mitigations are short TTL, server-side revocation, and no third-party scripts.

Until a decision is made, the current Bearer design remains the documented, tested mechanism.
