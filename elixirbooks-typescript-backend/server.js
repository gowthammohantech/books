// ts-node/register MUST be first so subsequent require() of `.ts` modules
// (auth layer in slice 0.1c, more conversions in 0.1d-e) is resolved by the
// TypeScript loader. Once everything is TS and compiled to dist/ (slice 0.1f),
// this can be removed in favour of running pre-built JS.
require('ts-node/register');
require('module-alias/register');
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const externalRoutes = require('./routes/externalRoutes');
const publicRoutes = require('./routes/publicRoutes');
const dimensionRoutes = require('./routes/dimensionRoutes');
const { auditContextMiddleware } = require('./middleware/auditContext');
const { runAsSystem } = require('./lib/tenantContext');
const { blockSettingsWriteInDemo, isDemoMode } = require('./middleware/demoMode');
const app = express();
// Behind an HTTPS reverse proxy (TLS terminated upstream). Trust X-Forwarded-*
// so req.protocol reflects the original scheme (https) — otherwise generated
// upload/image URLs come out as http://.
app.set('trust proxy', true);
connectDB();


require('./invoiceReminderCron');
require('./quotationReminderCron');
require('./recurringInvoicesCron');
require('./recurringExpensesCron');

const configuredCorsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedCorsOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:3000',
  'https://stg-elixirbooks-kan-app-ui-g5ane6h7fgfmatam.southeastasia-01.azurewebsites.net',
  'https://lite.elixir-books.com',
  ...configuredCorsOrigins,
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(auditContextMiddleware); // audit: carry actor context into Prisma writes
app.use('/uploads', express.static('uploads'));

app.get('/api/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'elixirbooks-api',
    demo: isDemoMode(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
// Demo mode: freeze settings writes before they reach the admin routes.
app.use('/api/admin', blockSettingsWriteInDemo);
app.use('/api/admin', adminRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/conversation', conversationRoutes);
app.use('/api/external', externalRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', dimensionRoutes); // P3.3 cost-centers + projects + pnl reports

// Swagger UI at /api/docs (slice G.4)
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./lib/swaggerConfig');
// Auto-list every live route in the spec (hand-written @swagger docs win).
const { mergeGeneratedPaths } = require('./lib/swaggerRoutes');
try {
  const { added, total } = mergeGeneratedPaths(swaggerSpec, [
    { base: '/auth', router: authRoutes, secured: false, tag: 'Auth' },
    { base: '/admin', router: adminRoutes, secured: true },
    { base: '/admin', router: dimensionRoutes, secured: true, tag: 'Reports' },
    { base: '/reminders', router: reminderRoutes, secured: true, tag: 'Reminders' },
    { base: '/conversation', router: conversationRoutes, secured: true, tag: 'AI' },
    { base: '/external', router: externalRoutes, secured: false, tag: 'Integrations' },
    { base: '/public', router: publicRoutes, secured: false, tag: 'Public' },
  ]);
  console.log(`[swagger] auto-documented ${added} routes (spec now lists ${total} operations)`);
} catch (e) {
  console.error('[swagger] route auto-documentation failed:', e);
}
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Elixir Books API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
app.get('/api/docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Global upload error handler (before the Prisma handler): maps multer file-type
// rejections and limit breaches from ANY upload route to a 400 instead of 500.
const { handleUploadError } = require('./middleware/uploadError');
app.use(handleUploadError);

// Global error handler (must be last, after all routes): translates uncaught
// Prisma/validation errors into actionable HTTP responses instead of opaque 500s.
const { prismaErrorHandler } = require('./middleware/prismaError');
app.use(prismaErrorHandler);

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Boot bootstrap — migrate + seed before accepting traffic.
//
// Runs regardless of deployment method (Docker, PM2, bare node server.js).
// Both steps are idempotent and non-fatal: a failure logs a warning but
// never prevents the server from starting.
//
// Disable individual steps via environment variables:
//   MIGRATE_ON_BOOT=false    — skip `prisma migrate deploy` (e.g. in CI where
//                              migrations are applied externally)
//   SEED_ON_BOOT=false       — skip baseline seed (e.g. when using the Docker
//                              entrypoint to control sequencing manually)
//   BACKFILL_ON_BOOT=false   — skip the legacy Customer/Supplier -> Contact
//                              data migration (e.g. if you run it manually)
//   GEO_ON_BOOT=false        — skip the Country/State geo dataset import
//                              (e.g. if you run `npm run prisma:import:geo`
//                              manually, or manage that data yourself)
//
// The SCHEMA-VERSION GUARD below is deliberately NOT switchable off: booting
// against a database without the tenancy tables cannot produce a working
// server, so there is no configuration under which skipping the check helps.
// ---------------------------------------------------------------------------
(async function bootstrap() {
  if (process.env.MIGRATE_ON_BOOT !== 'false') {
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      console.log('[boot] migrations applied.');
    } catch (err) {
      console.error('[boot] migrate deploy failed (non-fatal — schema may already be current):', err.message || err);
    }
  }

  // -------------------------------------------------------------------------
  // Schema-version guard. The migrate step above is deliberately non-fatal,
  // which is right when the schema is merely already current and wrong when it
  // is genuinely behind: every route resolves its workspace through Tenant /
  // TenantMembership now, so a server booted against a pre-tenancy database
  // does not degrade gracefully — it 500s everything while still answering
  // /api/healthz with "ok".
  //
  // Exiting is the kinder failure. A container that will not start is
  // immediately visible in any orchestrator and rolls back; a container that
  // starts and serves errors looks healthy and takes the traffic.
  // -------------------------------------------------------------------------
  try {
    const { prismaUnscoped } = require('./lib/prisma');
    await prismaUnscoped.$queryRaw`SELECT 1 FROM "Tenant" LIMIT 1`;
  } catch (err) {
    console.error(
      '\n[boot] FATAL: the database is missing the multi-tenancy schema.\n' +
      '       The Tenant table does not exist, so authentication and every\n' +
      '       tenant-scoped route would fail on the first request.\n' +
      '       Run `npx prisma migrate deploy` against this database, or unset\n' +
      '       MIGRATE_ON_BOOT=false so boot applies migrations itself.\n' +
      `       Underlying error: ${err.message || err}\n`,
    );
    process.exit(1);
  }

  if (process.env.SEED_ON_BOOT !== 'false') {
    try {
      await require('./prisma/seed').runBaselineSeed();
      console.log('[boot] baseline seed complete.');
    } catch (err) {
      console.error('[boot] seed failed (non-fatal):', err.message || err);
    }
  }

  // Idempotent data migration: on self-hosted upgrades from the legacy
  // Customer/Supplier model, this populates the unified Contact table and
  // repoints legacy FKs. Both scripts skip rows that are already migrated,
  // so this is a cheap no-op on every boot once an install is caught up.
  if (process.env.BACKFILL_ON_BOOT !== 'false') {
    try {
      console.log('[boot] contact data backfill...');
      // runAsSystem: these walk every workspace, so they declare that rather
      // than inheriting a tenant they do not have. Without it the tenant guard
      // refuses the first tenant-scoped query they make — which is the point:
      // an unscoped backfill should have to say so.
      await runAsSystem(async () => {
        await require('./prisma/migrateContacts').migrateContacts();
        await require('./prisma/backfillContactFks').backfillContactFks();
      });
      console.log('[boot] contact backfill complete.');
    } catch (err) {
      console.error('[boot] contact backfill failed (non-fatal):', err.message || err);
    }

    // Idempotent role backfill: adds the ACCOUNT_CREDIT / CUSTOMER_CREDIT_EXPENSE
    // ledger roles for any tenant that already went live before these roles
    // existed (applyPack refuses to re-run once ledgerInitialized=true). A cheap
    // no-op once every tenant is caught up.
    try {
      console.log('[boot] account-credit role backfill...');
      await runAsSystem(() =>
        require('./prisma/backfillAccountCreditRoles').backfillAccountCreditRoles());
      console.log('[boot] account-credit role backfill complete.');
    } catch (err) {
      console.error('[boot] account-credit role backfill failed (non-fatal):', err.message || err);
    }
  }

  // Idempotent geo dataset import: populates the Country/State lookup tables
  // from the bundled dataset (prisma/data/geo-countries-states.json). Without
  // this, a fresh self-hosted install has empty/sparse Country/State tables,
  // and ANY country/state selection in Company Settings would violate the
  // CompanySettings.countryId/stateId foreign key on save. Match-then-update
  // by iso2/code preserves fixed seeded ids, so re-running is a cheap no-op.
  if (process.env.GEO_ON_BOOT !== 'false') {
    try {
      console.log('[boot] geo dataset import...');
      await runAsSystem(() => require('./prisma/importGeoDataset').importGeoDataset());
      console.log('[boot] geo dataset import complete.');
    } catch (err) {
      console.error('[boot] geo dataset import failed (non-fatal):', err.message || err);
    }
  }

  // -------------------------------------------------------------------------
  // Start listening — runs after migrate + seed + contact backfill + geo
  // import complete (or are skipped).
  // -------------------------------------------------------------------------
  if (process.env.ENABLE_HTTPS === 'true') {
    const options = {
      key: fs.readFileSync(__dirname + '/ssl.key'),
      cert: fs.readFileSync(__dirname + '/ssl.crt'),
    };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`HTTPS server running on port ${PORT}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`HTTP server running on port ${PORT}`);
    });
  }
})();
