/**
 * Typed access to the environment, and one place that says what is required.
 *
 * NOT `lib/configSecret.ts`, despite the name. That module is at-rest encryption
 * for secrets stored inside tenant config blobs; this is the process's own
 * environment.
 *
 * WHY: 46 variables are read across 48 files, and `lib/agentsGatewayClient.ts:9`
 * states the gap outright — "Config is read from process.env at call time
 * (matching the rest of the backend — dotenv is loaded once in server.ts, no
 * central config loader)". Nothing validates any of it, so the only variable
 * that genuinely cannot be missing produces four different failures:
 *
 *   - `middleware/authMiddleware.ts:54` returns a 500 naming the missing var;
 *   - `middleware/auditContext.ts:20` DEGRADES SILENTLY, so every request runs
 *     with no user or tenant and the audit trail attributes all of it to
 *     'system';
 *   - `utils/generateToken.ts:36` throws, surfacing as a 500;
 *   - `lib/aiCrypto.ts:25` uses it as a key-derivation fallback.
 *
 * So an install missing JWT_SECRET boots, passes /api/healthz, and fails every
 * authenticated route while looking healthy. `assertConfigValid` turns that into
 * a refusal to start, which is the argument `server.ts:164-192` already makes
 * for the schema guard: a container that will not start rolls back; one that
 * starts and serves errors takes the traffic.
 *
 * NOTHING IS EAGER. `dotenv.config()` runs at `server.ts:25`, AFTER the import
 * block, so any module that reads the environment at load time reads it unset —
 * which already bites `controllers/appVersionController.ts:11`. Every getter
 * here reads `process.env` when called, and importing this module has no side
 * effects, so a test can import it freely.
 *
 * SCOPE: this defines and validates. It does not migrate the 152 existing
 * `process.env` reads; those move with their modules.
 */

/** The one variable with no safe default. */
const REQUIRED = ['JWT_SECRET'] as const;

// DATABASE_URL is deliberately NOT here: it is never read in application code.
// Prisma reads it itself from schema.prisma, and reports its own error.

function str(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v === undefined) return fallback;
  return v === 'true';
}

function int(name: string, fallback: number): number {
  const n = Number(str(name));
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  get nodeEnv(): string {
    return str('NODE_ENV') ?? 'development';
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
  get port(): number {
    return int('PORT', 3001);
  },
  get jwtSecret(): string | undefined {
    return str('JWT_SECRET');
  },

  /**
   * The API's own origin, used to build absolute `/uploads/...` URLs. Distinct
   * from `frontendUrl`, which is the SPA origin used in email links — two
   * different bases that read alike and are documented in neither .env.example.
   */
  get baseUrl(): string {
    return str('BASE_URL') ?? '';
  },
  get frontendUrl(): string | undefined {
    return str('FRONTEND_URL');
  },
  get corsOrigins(): string | undefined {
    return str('CORS_ORIGINS') ?? str('FRONTEND_URL');
  },

  /**
   * SMTP env fallback. Both spellings are accepted because both are in the
   * wild: `utils/mailer.ts` has always read either, and `docker/.env.example`
   * ships SMTP_USER / SMTP_PASS. Renaming one would break installs.
   */
  smtp: {
    get host(): string | undefined {
      return str('SMTP_HOST');
    },
    get user(): string | undefined {
      return str('SMTP_EMAIL') ?? str('SMTP_USER');
    },
    get password(): string | undefined {
      return str('SMTP_PASSWORD') ?? str('SMTP_PASS');
    },
    get port(): number {
      return int('SMTP_PORT', 465);
    },
  },

  /** Boot steps, all opt-out (`!== 'false'`), matching the existing reads. */
  boot: {
    get migrate(): boolean {
      return str('MIGRATE_ON_BOOT') !== 'false';
    },
    get seed(): boolean {
      return str('SEED_ON_BOOT') !== 'false';
    },
    get backfill(): boolean {
      return str('BACKFILL_ON_BOOT') !== 'false';
    },
    get geo(): boolean {
      return str('GEO_ON_BOOT') !== 'false';
    },
  },

  /** Opt-in flags, matching the existing `=== 'true'` reads. */
  get demoMode(): boolean {
    return bool('DEMO_MODE', false);
  },
  get prismaLog(): boolean {
    return bool('PRISMA_LOG', false);
  },
  get enableHttps(): boolean {
    return bool('ENABLE_HTTPS', false);
  },
  get signupsEnabled(): boolean {
    return str('SIGNUPS_ENABLED') !== 'false';
  },
  get tenantGuardMode(): string {
    return str('TENANT_GUARD_MODE') ?? 'warn';
  },
} as const;

/** Which required variables are missing. Empty means the process can serve. */
export function missingRequired(): string[] {
  return REQUIRED.filter((name) => str(name) === undefined);
}

/**
 * Refuse to start when a required variable is absent.
 *
 * Called from `bootstrap()` — after `dotenv.config()`, never at import time.
 * Follows the schema guard's format: what is wrong, what it breaks, how to fix.
 */
export function assertConfigValid(): void {
  const missing = missingRequired();
  if (missing.length === 0) return;

  console.error(
    `\n[boot] FATAL: required environment ${missing.length === 1 ? 'variable is' : 'variables are'} not set: ${missing.join(', ')}.\n` +
      '       JWT_SECRET signs and verifies every session token. Without it the\n' +
      '       server still starts and /api/healthz still answers ok, but every\n' +
      '       authenticated route returns 500 and the audit trail records every\n' +
      '       action as "system" rather than as the user who took it.\n' +
      '       Set it in docker/.env (or the environment) and restart.\n',
  );
  process.exit(1);
}
