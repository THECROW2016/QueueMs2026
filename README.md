# AfriQueue – Hospital Queue Management System (HQMS)

A database-driven queue and patient-flow system for a hospital with seven departments: **Reception, Triage, Consultation, Laboratory, Radiology, Pharmacy and Accounts**. Patients get a ticket at Reception, are called to a counter or room, and move through the departments their care needs. Staff see only what their role allows, a public screen announces ticket numbers (never patient details), and administrators get live and historical reports.

> This repository previously held a simpler queue app. It was replaced on `main` with the owner's approval; the old code is still in git history (commit `4689ebb`).

## What is in the box

| Area | Details |
|---|---|
| Stack | React 18 + TypeScript + Vite + Tailwind + React Router + React Hook Form + Zod · Node 22 + Express + TypeScript · Socket.IO · MySQL 8 via Prisma |
| Security | Argon2id passwords · server-side sessions (HttpOnly cookie, hashed token in the database) · CSRF protection · login rate limit + account lockout · RBAC enforced on the server with department scoping · audit log · Helmet/CSP |
| Queue engine | Concurrency-safe ticket numbers · call-next that never gives one ticket to two callers · state machine (waiting → called → in service → hold / absent / complete / skip / cancel / transfer) · priority and an emergency pathway for clinical staff · configurable routing rules |
| Real time | Transactional outbox → Socket.IO. Staff sockets must authenticate and are authorised per department. A separate public `/display` namespace carries no personal data. |
| Records | Patient / visit / ticket are separate. Duplicate warning at registration, idempotent visit creation, patient journey (full timeline for clinical roles, summary for others), invoices and confirmed payments |
| Reporting | Live dashboard, report filters by date and department, CSV export (audited), documented metric definitions (`server/src/services/reports.service.ts`) |
| Docs | OpenAPI at `/api/docs` (development; off by default in production), this README, [`docs/`](docs) |

## Roles

`SYSTEM_ADMIN` (configuration and oversight, cannot operate queues), `RECEPTION`, `TRIAGE`, `CONSULTATION`, `LABORATORY`, `RADIOLOGY`, `PHARMACY`, `ACCOUNTS`. Permissions are listed in `server/src/domain/constants.ts` and stored in the database; staff are assigned to departments and can only act inside them.

## Quick start (development)

Requirements: Node 20+ (22 recommended), MySQL 8 (or MariaDB 10.6+) and an empty database with a user that can create tables.

```bash
npm install
cp server/.env.example server/.env        # set DATABASE_URL (use a URL-safe password)
npm run db:migrate                        # applies server/prisma/migrations
npm run db:seed                           # roles, permissions, 7 departments, counters, routing rules, settings
npm run create-admin -- --username admin --name "Your Name"   # prompts for a password (hidden)

npm run dev:server                        # API + Socket.IO on :4000
npm run dev:client                        # web app on :5173 (proxies /api and /socket.io)
```

Optional synthetic demo staff (one per department, development only): set `SEED_DEMO_USERS=1` and `DEMO_PASSWORD=<10+ chars>` before `npm run db:seed`. Accounts are named `reception`, `triage`, `consultation`, `laboratory`, `radiology`, `pharmacy`, `accounts`. Demo users are refused when `NODE_ENV=production`.

No password is stored in the repository. `.env.example` files contain placeholders only.

## Tests

```bash
npm test                  # server (Vitest + Supertest, real database) and client (Vitest + Testing Library)
npm run test:e2e          # Playwright against the real server and a disposable database
```

* Server tests recreate a disposable database (default `hqms_test`, override with `TEST_DATABASE_URL`; the name must contain "test") from the committed migration SQL. They cover authentication, RBAC, patient/visit/ticket flows, state transitions, concurrency (25 simultaneous registrations, 8 simultaneous call-next, double submit), billing, notifications, sockets, the public display's lack of personal data, reports and CSV export.
* E2E uses `hqms_e2e` (override with `E2E_DATABASE_URL`; the name must contain "e2e" or "test") and synthetic users. If Playwright cannot find its browser, set `PW_CHROMIUM_PATH` to a Chromium binary.
* The database account needs permission to create/drop those databases.

## Build and run in production

```bash
npm run build           # client (Vite) and server (prisma generate + tsc)
NODE_ENV=production npm start
```

The server serves the built web app, the API and Socket.IO from one port. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Docker, HTTPS, backups and upgrades, and [docs/OPERATIONS.md](docs/OPERATIONS.md) for day-to-day use including the waiting-room TV.

### Docker

```bash
cp .env.example .env     # replace every CHANGE_ME
docker compose up -d --build
docker compose run --rm app node dist/cli/create-admin.js --username admin --name "Your Name"
```

MySQL is only on a private Docker network; port 3306 is **not** published.

## Security and privacy

See [docs/SECURITY.md](docs/SECURITY.md) for the controls, the threat assumptions, and notes for Kenyan data-protection obligations. This software has **not** been reviewed or certified against any law or standard; whether a deployment meets legal requirements is for your organisation's legal and compliance advisers to decide.

## Known limitations (read before relying on it)

* **Migrations were generated, not produced by Prisma Migrate.** The build environment could not download Prisma's engine binaries, so `server/prisma/migrations/*/migration.sql` was generated by a script from `schema.prisma` and applied to MariaDB. Before first production use run `npx prisma migrate diff --from-migrations server/prisma/migrations --to-schema-datamodel server/prisma/schema.prisma --shadow-database-url <empty db>` on a machine with normal network access; it should report no differences. Report/fix any drift.
* **Tests ran on MariaDB 10.11**, not MySQL 8.4. The SQL is standard (InnoDB row locks, `FOR UPDATE SKIP LOCKED`, JSON stored as text) and the Docker setup uses MySQL 8.4, but that combination has not been exercised here.
* **The Docker and Compose files were written but not run** (no Docker daemon was available). Run `docker compose config` and a trial deployment before relying on them.
* Prisma runs with the Rust-free client and the MariaDB driver adapter (`engineType = "client"`). Set `PRISMA_JS_ENGINE=1` only if your network cannot reach `binaries.prisma.sh` (see `server/prisma.config.ts`).
* SMS or e-mail delivery to patients is not implemented. Notifications are in-app and persistent; the outbox is ready for a delivery worker.
* Real-time delivery is at-most-once per event; clients refetch on reconnect and poll while disconnected, so screens self-heal. One application instance is assumed for the outbox dispatcher (multiple instances are safe but may split events).
* Voice announcements use the browser's speech engine. Available voices and languages depend on the TV or computer; test on the actual device.
