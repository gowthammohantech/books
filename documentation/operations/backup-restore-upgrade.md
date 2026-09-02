# Backup, Restore, and Upgrade

---

## What Needs to Be Backed Up

Persistent state lives in two places:

| Where | Contents |
|---|---|
| `elixirbooks_elixirbooks-pg-data` (volume) | The entire PostgreSQL database (all invoices, customers, settings, transactions) |
| The blob container named by `AZURE_STORAGE_CONTAINER` | Uploaded files: company logos, signatures, product images, expense receipt attachments, AI source bills |

Back up both. Losing either without a restore path means data loss — and note
that the two are coupled: database rows store blob **keys**, so a database
restored to a different point than the container will reference files that are
missing (broken images) or orphaned (files nothing points at).

In local development the blob container is Azurite, whose data sits in the
`elixirbooks_elixirbooks-azurite-data` volume. Dev uploads are not usually worth
backing up; if you want to, use the volume recipe below with that volume name.

---

## Backing Up PostgreSQL

Use `pg_dump` for a logical (SQL) dump. This runs inside the running
`postgres` container — no need to stop the stack.

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec -T postgres pg_dump -U elixirbooks elixirbooks \
  | gzip > elixirbooks-$(date +%F).sql.gz
```

The `-T` flag disables pseudo-TTY allocation so the output pipes cleanly.
The dump is compressed with gzip. Check the file size is non-zero before
assuming success:

```bash
ls -lh elixirbooks-$(date +%F).sql.gz
```

---

## Backing Up Uploaded Files

Uploaded files are no longer on disk, so there is no volume to tar. Back up the
storage account instead - its own durability options are stronger than a nightly
tarball:

- **Soft delete** (blobs and containers) retains deleted files for a retention
  window, which covers the common accident of a wrong bulk delete.
- **Versioning** keeps the previous content of an overwritten blob.
- **Point-in-time restore** rolls the container back to an earlier moment, which
  is the option that pairs with a PostgreSQL restore.
- **Geo-redundancy** (GRS/RA-GRS) covers loss of the region.

Turn these on for the storage account once, in the portal or with
`az storage account blob-service-properties update`. Nothing in this repo
configures them for you.

To take an explicit copy anyway - before a risky migration, say:

```bash
az storage blob download-batch \
  --source uploads \
  --destination ./uploads-backup-$(date +%F) \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING"
```

---

## Automating Backups (cron)

Add a daily cron job on the host. Example crontab entry (runs at 02:00):

```cron
0 2 * * * cd /path/to/elixirbooks && \
  docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres pg_dump -U elixirbooks elixirbooks \
    | gzip > /backups/elixirbooks-$(date +\%F).sql.gz
```

Only the database needs a cron job. Uploaded files are covered by the storage
account's soft-delete / versioning / point-in-time settings described above.

Replace `/path/to/elixirbooks` with your actual repo root and `/backups` with
your backup destination.

**Strongly recommended:** Copy backup files off-box (S3, rsync to another
server, etc.). On-box backups do not protect against host failure.

---

## Restoring PostgreSQL

To restore from a `.sql.gz` dump into the running database:

```bash
gunzip -c elixirbooks-2026-01-15.sql.gz \
  | docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres psql -U elixirbooks elixirbooks
```

If the database has existing data you want to replace, drop and recreate it
first:

```bash
# Stop the api container so there are no active connections
docker compose --env-file docker/.env -f docker/docker-compose.yml stop api

# Drop and recreate the database
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U elixirbooks -c "DROP DATABASE elixirbooks;"
docker compose --env-file docker/.env -f docker/docker-compose.yml \
  exec postgres psql -U elixirbooks -c "CREATE DATABASE elixirbooks;"

# Restore
gunzip -c elixirbooks-2026-01-15.sql.gz \
  | docker compose --env-file docker/.env -f docker/docker-compose.yml \
    exec -T postgres psql -U elixirbooks elixirbooks

# Restart the api (entrypoint will re-run migrations safely on clean DB)
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d api
```

---

## Restoring Uploaded Files

Use the storage account's point-in-time restore, choosing a moment as close as
possible to the database dump you restored - the rows hold blob keys, so the two
have to agree about which files exist.

If you took an explicit copy, upload it back:

```bash
az storage blob upload-batch \
  --destination uploads \
  --source ./uploads-backup-2026-01-15 \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING"
```

---

## Upgrading to a New Version

An Elixir Books upgrade is:

```bash
cd elixirbooks
git pull          # single repository — one pull covers both apps
make up
```

`make up` rebuilds images that have changed and restarts their containers.
The API container's entrypoint automatically runs `prisma migrate deploy`
on boot, so any new database migrations are applied without manual
intervention.

**Back up before upgrading.** Take the PostgreSQL dump above before pulling new
code, especially for significant version bumps. Uploaded files are covered by the
storage account's retention settings and need no separate step.

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
# Expected: {"status":"ok","service":"elixirbooks-api",...}
```

The `/healthz` endpoint on the web container (served by nginx, no API involved):

```bash
curl -fsS http://localhost:8080/healthz
# Expected: ok
```
