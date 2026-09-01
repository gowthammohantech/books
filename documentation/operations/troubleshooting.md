# Troubleshooting

---

## Reading the Logs

The first thing to do for any problem:

```bash
make logs
# Tails api + web logs, last 200 lines, then follows
```

To look at only one service:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml logs --tail=200 api
docker compose --env-file docker/.env -f docker/docker-compose.yml logs --tail=200 web
```

---

## `make up` Fails to Start

**Symptom:** `make up` exits with an error immediately.

**Check 1 — `docker/.env` exists:**
```bash
ls docker/.env
```
If missing: `cp docker/.env.example docker/.env` then edit it.

**Check 2 — Docker is running:**
```bash
docker info
```
If Docker is not running, start it (`sudo systemctl start docker` on Linux).

**Check 3 — Port conflict:**
```bash
ss -tlnp | grep 8080
# or
lsof -i :8080
```
If port 8080 is already in use, change `WEB_PORT` in `docker/.env` to a free
port (e.g. `WEB_PORT=8181`) and run `make up` again. `WEB_PORT` is a
runtime-only variable — no rebuild needed, just restart.

**Check 4 — Build failure:**
If the build itself fails (image build logs show an error), check that you are
running Docker Engine 24+ and the Compose plugin v2:
```bash
docker compose version
```
Legacy `docker-compose` (v1, the Python binary) is not supported.

---

## 502 Bad Gateway on `/api/*`

**Symptom:** The browser shows a 502 error when loading the dashboard or
calling any API route.

The nginx web container is proxying `/api` to `http://api:3001` — this
error means the `api` container is not running or not healthy.

```bash
make ps
# Is the api container running? What is its status?

make logs
# Look for startup errors in the api logs
```

Common causes:
- The `api` container is still starting (migrations and seed run on boot;
  allow 20–40 seconds on first run or after an upgrade).
- `DATABASE_URL` is incorrect or `POSTGRES_PASSWORD` does not match — the
  migration step fails and the container exits.
- The `postgres` container is not healthy yet (look for `"waiting for
  postgres to be healthy"` in the compose output).

---

## `/api/healthz` Returns 500

**Symptom:** `curl http://localhost:8080/api/healthz` returns HTTP 500.

The API server started but cannot connect to the database. Check:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml logs api | grep -i "error\|database\|prisma"
```

Most likely causes:
- `DATABASE_URL` password does not match `POSTGRES_PASSWORD`.
- The `postgres` container had a data corruption issue — check postgres logs:
  ```bash
  docker compose --env-file docker/.env -f docker/docker-compose.yml logs postgres
  ```

---

## Web App Can't Reach the API (Blank Page / Network Errors)

**Symptom:** The React app loads but all data fetches fail in the browser
console with `net::ERR_CONNECTION_REFUSED` or CORS errors pointing to an
absolute URL like `http://localhost:3001`.

**Cause:** `VITE_API_BASE_URL` was set to a non-empty value in `docker/.env`
when the web image was built. The frontend is calling an absolute URL that
is not reachable from the user's browser.

**Fix:** Set `VITE_API_BASE_URL` to empty in `docker/.env`:

```env
VITE_API_BASE_URL=
```

Then rebuild the web image (this is a build-time variable):

```bash
make rebuild-web
```

The correct behaviour is for the frontend to call a relative `/api/...` path,
which nginx inside the web container proxies to the API. This works on any
domain without any CORS configuration.

---

## Emails Not Sending

**Check 1 — Is SMTP configured?**
Go to **Settings → Email Settings** in the UI. If no provider is enabled,
email is silently skipped.

**Check 2 — Send a test email:**
The Email Settings page has a "Send test email" button that surfaces the
exact error from the mail transport.

**Check 3 — Check the API logs:**
```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml logs api | grep -i "mail\|smtp\|nodemailer"
```

**Check 4 — Gmail App Password:**
If using Gmail, ensure you are using an App Password (not your account
password), and that 2-Step Verification is enabled on the Google account.
See [integrations.md](integrations.md) for the Gmail SMTP settings.

**Check 5 — Port 587 blocked:**
Some VPS providers block outbound SMTP on port 587. Try port 465 (`SMTP_PORT=465`)
or use a transactional email service (Resend, Mailgun, Postmark) instead of
direct SMTP.

---

## Database Migrations Not Applied After Upgrade

**Symptom:** After `make up` (following a `git pull`), the app shows errors
about missing columns or tables.

The migration step runs inside the API container entrypoint. Check if it
completed:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml logs api | grep "entrypoint\|migrate"
```

If migrations failed (e.g. because the database was unreachable), the
container exits. Fix the underlying issue (usually `DATABASE_URL` or a
stopped postgres container), then restart:

```bash
make up
```

To apply migrations manually without restarting:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec api npx prisma migrate deploy
```

---

## Port Conflict — `WEB_PORT` Already in Use

```bash
# Find what is using port 8080
ss -tlnp | grep 8080

# Change WEB_PORT in docker/.env to a free port, then restart
# (WEB_PORT is runtime-only — no image rebuild needed)
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d web
```

---

## Demo Credentials Don't Work

**Symptom:** Logging in with `admin@demo.elixirbooks.local` / `Demo123$` fails
with "Invalid credentials".

**Cause A — Demo seed was never run:**
The demo admin account is not created by `make up`. You must run the demo
seed after the stack is started:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec api node dist/prisma/seed-demo.js
```

**Cause B — Running an older database with the old demo email:**
A previous release used `admin@example.com` as the demo email. If you have
an existing database from before commit `88196c0`, update the email directly:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U elixirbooks elixirbooks \
  -c "UPDATE \"User\" SET email = 'admin@demo.elixirbooks.local' WHERE email = 'admin@example.com';"
```

Then re-run the demo seed to reset the password:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec api node dist/prisma/seed-demo.js
```

**Cause C — `VITE_DEMO_MODE` is not set to `true`:**
The login page pre-fills demo credentials only when the web image was built
with `VITE_DEMO_MODE=true`. Credentials still work for manual entry
regardless of this setting, but the banner and auto-fill only appear when it
is enabled.

---

## Where Are the Uploaded Files?

Uploaded files (logos, receipt attachments) are stored in the
`elixirbooks_elixirbooks-uploads` Docker volume, mounted into the API container
at `/repo/apps/api/uploads`. The API serves them at `/uploads/<filename>` (proxied
through nginx at the same path).

To list the contents of the volume:

```bash
docker run --rm \
  -v elixirbooks_elixirbooks-uploads:/data \
  alpine ls -lRh /data
```

To copy a file out of the volume:

```bash
docker run --rm \
  -v elixirbooks_elixirbooks-uploads:/data \
  -v "$PWD":/out \
  alpine cp /data/company/logo.png /out/logo.png
```

---

## Reset Admin Password

The `PUT /api/admin/security/reset-password/:userId` endpoint requires the
current (old) password. If you have lost access to the admin account, reset
the password directly in the database:

```bash
# Generate a bcrypt hash for your new password (cost factor 10)
# Replace "NewPassword123!" with your desired password
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec api node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('NewPassword123!', 10).then(h => console.log(h));
"

# Copy the hash from the output, then update it in the database:
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U elixirbooks elixirbooks \
  -c "UPDATE \"User\" SET password = '\$HASH_HERE' WHERE user_type = 1;"
```

Replace `\$HASH_HERE` with the bcrypt hash from the first command.

---

## Open a Database Shell

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U elixirbooks elixirbooks
```

---

## Re-run the Baseline Seed

If you suspect lookup data (currencies, roles, modules) is missing:

```bash
make seed
```

The baseline seed is idempotent — running it on an existing database is safe.

---

## Check Container Status and Health

```bash
make ps
# Shows all containers with their health status

# Detailed inspect of a specific container:
docker inspect elixirbooks-api-1 | grep -A5 '"Health"'
```

---

## Stack Comes Up But App Shows a White Screen

**Cause:** Almost always a JavaScript bundle error caused by a mismatched
`VITE_API_BASE_URL` (see "Web App Can't Reach the API" above) or a Vite
build failure during the web image build.

Check the browser developer console (F12 → Console) for the exact error.

Check that the web image built successfully:

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml logs web
# Look for nginx startup: "nginx: [info]" — if nginx started, the image is healthy
# Look for the build stage output if you are seeing "failed to build" messages
```

If the build failed, `make rebuild-web` with `VITE_API_BASE_URL=` (empty)
and `VITE_DEMO_MODE=false` and review the build output for errors.
