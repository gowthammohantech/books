import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { config, missingRequired } from './index';

const TOUCHED = [
  'JWT_SECRET',
  'NODE_ENV',
  'PORT',
  'BASE_URL',
  'FRONTEND_URL',
  'CORS_ORIGINS',
  'SMTP_HOST',
  'SMTP_EMAIL',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_PASS',
  'SMTP_PORT',
  'SEED_ON_BOOT',
  'DEMO_MODE',
  'SIGNUPS_ENABLED',
  'TENANT_GUARD_MODE',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// The point of the getters: dotenv.config() runs at server.ts:25, AFTER the
// import block, so anything that snapshots the environment at module load reads
// it unset. appVersionController.ts:11 already does exactly that.
describe('laziness', () => {
  it('reads the environment when called, not when imported', () => {
    expect(config.jwtSecret).toBeUndefined();
    process.env.JWT_SECRET = 'set-after-import';
    expect(config.jwtSecret).toBe('set-after-import');
  });

  it('importing the module does not throw or exit on a missing required var', () => {
    // Proven by this suite running at all: the import is at the top of the file
    // and JWT_SECRET is deleted in beforeEach.
    expect(missingRequired()).toEqual(['JWT_SECRET']);
  });
});

describe('missingRequired', () => {
  it('names JWT_SECRET when it is absent', () => {
    expect(missingRequired()).toEqual(['JWT_SECRET']);
  });

  it('treats an empty string as absent, not as a value', () => {
    process.env.JWT_SECRET = '';
    expect(missingRequired()).toEqual(['JWT_SECRET']);
  });

  it('is empty once it is set', () => {
    process.env.JWT_SECRET = 'x';
    expect(missingRequired()).toEqual([]);
  });

  // DATABASE_URL is never read in application code — Prisma reads it from
  // schema.prisma and reports its own error — so it is deliberately not required.
  it('does not require DATABASE_URL', () => {
    process.env.JWT_SECRET = 'x';
    expect(missingRequired()).not.toContain('DATABASE_URL');
  });
});

describe('defaults match the reads they replace', () => {
  it('port falls back to 3001', () => {
    expect(config.port).toBe(3001);
    process.env.PORT = '8080';
    expect(config.port).toBe(8080);
  });

  it('baseUrl is empty rather than the string "undefined"', () => {
    expect(config.baseUrl).toBe('');
  });

  it('tenantGuardMode defaults to warn, not enforce', () => {
    expect(config.tenantGuardMode).toBe('warn');
  });

  it('boot steps are opt-out', () => {
    expect(config.boot.seed).toBe(true);
    process.env.SEED_ON_BOOT = 'false';
    expect(config.boot.seed).toBe(false);
    // Anything other than the literal 'false' leaves it on, matching server.ts.
    process.env.SEED_ON_BOOT = 'no';
    expect(config.boot.seed).toBe(true);
  });

  it('feature flags are opt-in', () => {
    expect(config.demoMode).toBe(false);
    process.env.DEMO_MODE = 'true';
    expect(config.demoMode).toBe(true);
    process.env.DEMO_MODE = '1';
    expect(config.demoMode).toBe(false); // matches `=== 'true'` at the call site
  });

  it('signups are opt-out, unlike the other flags', () => {
    expect(config.signupsEnabled).toBe(true);
    process.env.SIGNUPS_ENABLED = 'false';
    expect(config.signupsEnabled).toBe(false);
  });
});

// Both spellings are live: utils/mailer.ts has always read either, and
// docker/.env.example ships the SMTP_USER / SMTP_PASS pair.
describe('smtp accepts both spellings', () => {
  it('prefers SMTP_EMAIL / SMTP_PASSWORD when present', () => {
    process.env.SMTP_EMAIL = 'a@example.com';
    process.env.SMTP_USER = 'b@example.com';
    process.env.SMTP_PASSWORD = 'first';
    process.env.SMTP_PASS = 'second';
    expect(config.smtp.user).toBe('a@example.com');
    expect(config.smtp.password).toBe('first');
  });

  it('falls back to the aliases .env.example actually ships', () => {
    process.env.SMTP_USER = 'b@example.com';
    process.env.SMTP_PASS = 'second';
    expect(config.smtp.user).toBe('b@example.com');
    expect(config.smtp.password).toBe('second');
  });

  it('defaults the port to 465', () => {
    expect(config.smtp.port).toBe(465);
  });
});

describe('corsOrigins falls back to frontendUrl', () => {
  it('matches the server.ts read it replaces', () => {
    process.env.FRONTEND_URL = 'https://app.example';
    expect(config.corsOrigins).toBe('https://app.example');
    process.env.CORS_ORIGINS = 'https://one.example,https://two.example';
    expect(config.corsOrigins).toBe('https://one.example,https://two.example');
  });
});

describe('assertConfigValid', () => {
  it('exits with a message naming the variable when it is missing', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { assertConfigValid } = await import('./index');
    assertConfigValid();

    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls[0][0]).toContain('JWT_SECRET');
    expect(err.mock.calls[0][0]).toContain('[boot] FATAL');
    exit.mockRestore();
    err.mockRestore();
  });

  it('is silent and does not exit once the variable is set', async () => {
    process.env.JWT_SECRET = 'x';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { assertConfigValid } = await import('./index');
    assertConfigValid();

    expect(exit).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });
});
