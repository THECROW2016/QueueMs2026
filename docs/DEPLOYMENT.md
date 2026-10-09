# Deployment

## 1. Prepare

* A Linux server (2 vCPU / 4 GB is plenty for one hospital) with Docker Engine and the Compose plugin, **or** Node 22 and MySQL 8 installed directly.
* A DNS name for the system (for example `queue.yourhospital.example`) if staff will use it over the internet or Wi-Fi.
* `cp .env.example .env` and replace every `CHANGE_ME` with a unique value from `openssl rand -hex 24`. Never commit `.env`.

## 2. Docker Compose

```bash
docker compose config                     # validate the file and your .env
docker compose up -d --build              # db → migrate (one-shot) → app
docker compose run --rm app node dist/cli/create-admin.js --username admin --name "Your Name"
docker compose logs -f app
```

* `migrate` applies `server/prisma/migrations` with `prisma migrate deploy` and re-runs the idempotent reference-data seed (roles, departments, counters, routing rules). It never creates demo users.
* The database service has **no `ports:` mapping** and sits on an internal network. Do not add one. If you must reach it for maintenance, use `docker compose exec db mysql -uroot -p` or an SSH tunnel.
* Health: `GET /api/health` returns `{"status":"ok","database":"up"}` (HTTP 503 when the database is down). Docker uses it as the container health check.

## 3. HTTPS

Passwords and session cookies must only travel over HTTPS. Two supported options:

**A. Bundled Caddy proxy (automatic certificates)** – needs a public DNS name pointing at the server and ports 80/443 open.

```bash
# .env
HQMS_DOMAIN=queue.yourhospital.example
TRUST_PROXY=1
COOKIE_SECURE=true
# docker-compose.yml: remove the "ports:" mapping of the app service so only Caddy is reachable
docker compose --profile https up -d
```

**B. Your own proxy or load balancer** (nginx, Apache, a hospital gateway): forward to port 4000, pass `X-Forwarded-For` and `X-Forwarded-Proto`, allow WebSocket upgrades on `/socket.io/`, and set `TRUST_PROXY` to the number of proxies. Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

In an isolated hospital LAN with no certificate authority, use an internal CA and install its root certificate on the clinical PCs and the TV. Browsers will not keep `Secure` cookies over plain HTTP (except on `localhost`), so staff sign-in needs HTTPS in production.

## 4. Without Docker

```bash
npm ci && npm run build
export NODE_ENV=production DATABASE_URL=... COOKIE_SECURE=true TRUST_PROXY=1
npm run db:migrate && npm run db:seed
npm run create-admin -- --username admin --name "Your Name"
npm start        # run under systemd or pm2 so it restarts on failure
```

## 5. Upgrades

1. Back up the database (below).
2. `git pull`, then `docker compose up -d --build` (or `npm ci && npm run build && npm run db:migrate`, then restart).
3. Check `/api/health` and sign in. Rolling back means restoring the backup and the previous image.

## 6. Backup and restore

Daily logical backup (keep copies off the server, encrypted, with a documented retention period):

```bash
docker compose exec -T db sh -c 'mysqldump --single-transaction --routines -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' | gzip > hqms-$(date +%F).sql.gz
```

Restore into an empty database (stop the app first):

```bash
docker compose stop app
gunzip -c hqms-2026-10-09.sql.gz | docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
docker compose start app
```

**Test a restore on a spare machine regularly.** A backup that has never been restored is an assumption, not a backup. Backups contain patient data: encrypt them and restrict who can read them.

## 7. Monitoring

* `GET /api/health` for uptime checks.
* `docker compose logs app` – structured JSON logs with a request id that is also returned to users in error messages.
* Administration → Audit log for sign-ins, failed attempts, exports and record access.
