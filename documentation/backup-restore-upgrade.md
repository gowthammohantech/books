# Backup, Restore, and Upgrade

---

## What Needs to Be Backed Up

Two Docker volumes hold all persistent state:

| Volume | Contents |
|---|---|
| `kanakku_kanakku-pg-data` | The entire PostgreSQL database (all invoices, customers, settings, transactions) |
| `kanakku_kanakku-uploads` | Uploaded files: invoice and company logos, expense receipt attachments |

Back up both volumes. Losing either without a restore path means data loss.

---

## Backing Up PostgreSQL

Use `pg_dump` for a logical (SQL) dump. This runs inside the running
`postgres` container — no need to stop the stack.

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec -T postgres pg_dump -U kanakku kanakku \
  | gzip > kanakku-$(date +%F).sql.gz
```

The `-T` flag disables pseudo-TTY allocation so the output pipes cleanly.
The dump is compressed with gzip. Check the file size is non-zero before
assuming success:

```bash
ls -lh kanakku-$(date +%F).sql.gz
```

---

## Backing Up Uploaded Files

The uploads volume is backed up using a temporary Alpine container that
has access to the volume:

```bash
docker run --rm \
  -v kanakku_kanakku-uploads:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Note: the volume name is prefixed with the compose project name (`kanakku_`).
If you changed the compose project name, adjust accordingly.

---

## Automating Backups (cron)

Add a daily cron job on the host. Example crontab entry (runs at 02:00):

```cron
0 2 * * * cd /path/to/kanakku && \
  docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres pg_dump -U kanakku kanakku \
    | gzip > /backups/kanakku-$(date +\%F).sql.gz && \
  docker run --rm \
    -v kanakku_kanakku-uploads:/data \
    -v /backups:/backup \
    alpine tar czf /backup/uploads-$(date +\%F).tar.gz -C /data .
```

Replace `/path/to/kanakku` with your actual repo root and `/backups` with
your backup destination.

**Strongly recommended:** Copy backup files off-box (S3, rsync to another
server, etc.). On-box backups do not protect against host failure.

---

## Restoring PostgreSQL

To restore from a `.sql.gz` dump into the running database:

```bash
gunzip -c kanakku-2026-01-15.sql.gz \
  | docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres psql -U kanakku kanakku
```

If the database has existing data you want to replace, drop and recreate it
first:

```bash
# Stop the api container so there are no active connections
docker compose --env-file docker/.env -f docker/docker-compose.yml stop api

# Drop and recreate the database
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U kanakku -c "DROP DATABASE kanakku;"
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U kanakku -c "CREATE DATABASE kanakku;"

# Restore
gunzip -c kanakku-2026-01-15.sql.gz \
  | docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres psql -U kanakku kanakku

# Restart the api (entrypoint will re-run migrations safely on clean DB)
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d api
```

---

## Restoring Uploaded Files

```bash
docker run --rm \
  -v kanakku_kanakku-uploads:/data \
  -v /path/to/backup:/backup \
  alpine \
  sh -c "cd /data && tar xzf /backup/uploads-2026-01-15.tar.gz"
```

---

## Upgrading to a New Version

A Kanakku upgrade is:

```bash
cd kanakku
git pull          # pull latest in the root repo
cd kanakku-typescript-backend && git pull && cd ..
cd kanakku-typescript-frontend && git pull && cd ..
make up
```

`make up` rebuilds images that have changed and restarts their containers.
The API container's entrypoint automatically runs `prisma migrate deploy`
on boot, so any new database migrations are applied without manual
intervention.

**Back up before upgrading.** Run the PostgreSQL and uploads backup commands
above before pulling new code, especially for significant version bumps.

### Frontend-only config change

If you only changed a build-time frontend variable (e.g. `VITE_DEMO_MODE`)
without changing any code:

```bash
make rebuild-web
```

### Backend-only change

If you only changed backend code or a runtime environment variable:

```bash
make rebuild-api
```

This also re-runs `prisma migrate deploy`, so it is safe to use after any
schema change.

---

## Rollback

There is no automated rollback mechanism. To revert to a previous version:

1. `git checkout <previous-tag-or-commit>` in the relevant repo(s).
2. `make up` to rebuild and restart.
3. If the new version ran database migrations that are not present in the
   older schema, you will need to restore a pre-upgrade database backup.

For this reason: **always back up before upgrading.**

---

## Health Check

After any upgrade or restore, verify the stack is healthy:

```bash
make ps
curl -fsS http://localhost:8080/api/healthz
# Expected: {"status":"ok","service":"kanakku-api",...}
```

The `/healthz` endpoint on the web container (served by nginx, no API involved):

```bash
curl -fsS http://localhost:8080/healthz
# Expected: ok
```
