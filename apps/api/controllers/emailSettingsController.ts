import fs from 'fs';
import path from 'path';

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { EmailSettingsProviderType } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import { sendPrismaError } from '../middleware/prismaError';
import { encryptSecret } from '../lib/emailSecret';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

/**
 * Ports are stored as String? in the schema, but the client sends them as
 * numbers (e.g. 587). Coerce to string — treating empty/blank as null — so
 * Prisma doesn't reject the write with "Expected String or Null, provided Int".
 */
function toNullableString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

/**
 * Strip secret values from a settings row before returning it to the client.
 * Replaces smtpPassword/nodePassword/resendApiKey with '' and adds boolean
 * has* flags so the UI can show "saved" without ever receiving the secret.
 */
function maskSettings<T extends Record<string, unknown>>(settings: T | null) {
  if (!settings) return settings;
  const { smtpPassword, nodePassword, resendApiKey, ...rest } = settings as Record<string, unknown>;
  return {
    ...rest,
    smtpPassword: '',
    nodePassword: '',
    resendApiKey: '',
    hasSmtpPassword: !!smtpPassword,
    hasNodePassword: !!nodePassword,
    hasResendApiKey: !!resendApiKey,
  };
}

/**
 * The `*_status` columns are Boolean? but clients may send "true"/"false"/1/0.
 * Coerce to a real boolean so Prisma doesn't reject with
 * "Expected Boolean, provided String". Undefined is left as-is (column default).
 */
function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 1;
}

/**
 * Update .env file helper — preserved verbatim from the JS source.
 */
function updateEnvFile(newVars: Record<string, string | boolean | number | undefined>): void {
  try {
    const envPath = path.join(__dirname, '../.env');
    const envData = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

    const envObj: Record<string, string> = {};
    envData.split('\n').forEach((line) => {
      const [key, value] = line.split('=');
      if (key) envObj[key.trim()] = value ? value.trim() : '';
    });

    Object.keys(newVars).forEach((key) => {
      const v = newVars[key];
      envObj[key] = v === undefined || v === null ? '' : String(v);
    });

    const updatedData = Object.entries(envObj)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    fs.writeFileSync(envPath, updatedData, 'utf-8');
  } catch (err) {
    // Non-fatal: the DB row is the source of truth for the mailer. In a
    // read-only/container FS the .env write can fail — don't block saving.
    console.warn('[emailSettings] could not update .env (non-fatal):', err instanceof Error ? err.message : err);
  }
}

interface EmailSettingsBody {
  tenantId?: string;
  provider_type?: EmailSettingsProviderType;
  nodeFromName?: string;
  nodeFromEmail?: string;
  nodeReplyTo?: string;
  nodeHost?: string;
  nodePort?: string;
  nodeUsername?: string;
  nodePassword?: string;
  smtpFromName?: string;
  smtpFromEmail?: string;
  smtpReplyTo?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  resendFromName?: string;
  resendFromEmail?: string;
  resendReplyTo?: string;
  resendApiKey?: string;
  smtp_status?: boolean;
  node_status?: boolean;
  resend_status?: boolean;
}

/**
 * Create or update email settings (only one entry per user).
 */
export async function createOrUpdateEmailSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as EmailSettingsBody;
    // Prefer the authenticated tenantId; fall back to body.tenantId to match the
    // JS source which read from req.body.tenantId.
    let tenantId: string;
    try {
      tenantId = requireTenantId(req);
    } catch (err) {
      if (body.tenantId) {
        tenantId = body.tenantId;
      } else {
        throw err;
      }
    }

    const data: Prisma.EmailSettingsUncheckedCreateInput = {
      provider_type: body.provider_type as EmailSettingsProviderType,
      nodeFromName: body.nodeFromName,
      nodeFromEmail: body.nodeFromEmail,
      nodeReplyTo: body.nodeReplyTo,
      nodeHost: body.nodeHost,
      nodePort: toNullableString(body.nodePort),
      nodeUsername: body.nodeUsername,
      smtpFromName: body.smtpFromName,
      smtpFromEmail: body.smtpFromEmail,
      smtpReplyTo: body.smtpReplyTo,
      smtpHost: body.smtpHost,
      smtpPort: toNullableString(body.smtpPort),
      smtpUsername: body.smtpUsername,
      resendFromName: body.resendFromName,
      resendFromEmail: body.resendFromEmail,
      resendReplyTo: body.resendReplyTo,
      smtp_status: toOptionalBoolean(body.smtp_status),
      node_status: toOptionalBoolean(body.node_status),
      resend_status: toOptionalBoolean(body.resend_status),
      tenantId,
    };

    // Secrets: encrypt when a new value is supplied; when blank/omitted, leave
    // the key out so an update preserves the stored secret (blank-keeps-current)
    // and a create simply stores null. Never persist plaintext.
    const secretInputs: Record<'nodePassword' | 'smtpPassword' | 'resendApiKey', unknown> = {
      nodePassword: body.nodePassword,
      smtpPassword: body.smtpPassword,
      resendApiKey: body.resendApiKey,
    };
    for (const [field, value] of Object.entries(secretInputs)) {
      if (typeof value === 'string' && value.trim() !== '') {
        (data as Record<string, unknown>)[field] = encryptSecret(value);
      }
    }

    // Mongoose findOneAndUpdate({ tenantId }, ..., { upsert: true }) — there is no
    // unique constraint on tenantId in the Prisma schema, so we replicate that
    // semantics with findFirst + update/create rather than upsert.
    const existing = await prisma.emailSettings.findFirst({ where: { tenantId } });
    const settings = existing
      ? await prisma.emailSettings.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.emailSettings.create({ data });

    // Invalidate the mailer's provider cache so the next email uses the new config.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- utils/mailer is still JS; becomes a real import in Phase 3.
      const mailer = require('../utils/mailer') as { clearMailerCache?: () => void };
      mailer.clearMailerCache?.();
    } catch {
      /* non-fatal */
    }

    // Mirror non-secret config to .env for parity (the mailer reads the DB row as
    // source of truth). Secrets are NOT written to .env — they live encrypted in
    // the DB only, so they never sit in plaintext on disk.
    if (body.provider_type === 'SMTP') {
      updateEnvFile({
        SMTP_HOST: body.smtpHost,
        SMTP_PORT: body.smtpPort,
        SMTP_SECURE: body.smtp_status || false,
        SMTP_EMAIL: body.smtpFromEmail,
      });
    } else if (body.provider_type === 'NODE') {
      updateEnvFile({
        NODE_HOST: body.nodeHost,
        NODE_PORT: body.nodePort,
        NODE_EMAIL: body.nodeFromEmail,
      });
    } else if (body.provider_type === 'RESEND') {
      updateEnvFile({
        RESEND_FROM_EMAIL: body.resendFromEmail,
        RESEND_FROM_NAME: body.resendFromName,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Email settings saved successfully',
      data: maskSettings(settings),
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    sendPrismaError(res, err);
  }
}

/**
 * List email settings for a user.
 */
export async function getEmailSettings(req: Request, res: Response): Promise<void> {
  try {
    let tenantId: string | undefined = (req.query.tenantId as string | undefined) ?? undefined;
    if (!tenantId) {
      try {
        tenantId = requireTenantId(req);
      } catch {
        tenantId = undefined;
      }
    }

    const settings = tenantId
      ? await prisma.emailSettings.findFirst({ where: { tenantId } })
      : null;

    res.status(200).json({
      success: true,
      data: maskSettings(settings) ?? {},
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    res.status(500).json({
      success: false,
      message: 'Error fetching email settings',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send a test email through the currently active provider so the user can
 * validate their configuration (API key / verified domain / SMTP creds) from
 * the UI. Surfaces the underlying transport error message on failure.
 */
export async function sendTestEmail(req: Request, res: Response): Promise<void> {
  try {
    let tenantId: string | undefined;
    try {
      tenantId = requireTenantId(req);
    } catch {
      tenantId = (req.body as { tenantId?: string }).tenantId;
    }

    let recipient = (req.body as { to?: string }).to?.trim();
    if (!recipient && tenantId) {
      const u = await prisma.user.findUnique({ where: { id: tenantId }, select: { email: true } });
      recipient = u?.email ?? undefined;
    }
    if (!recipient) {
      res.status(400).json({ success: false, message: 'A recipient email is required.' });
      return;
    }

    // mailer reads the active EmailSettings row (cache was cleared on save).
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- utils/mailer is still JS; becomes a real import in Phase 3.
    const mailer = require('../utils/mailer') as {
      sendMail: (opts: Record<string, unknown>) => Promise<unknown>;
    };
    await mailer.sendMail({
      to: recipient,
      subject: 'Elixir Books test email',
      html:
        '<p>This is a test email from your Elixir Books email configuration.</p>' +
        '<p>If you received this, your active email provider is working correctly.</p>',
    });

    res.status(200).json({ success: true, message: `Test email sent to ${recipient}.` });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EMAIL_NOT_CONFIGURED') {
      res.status(422).json({ success: false, message: (err as Error).message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send test email. Check your provider configuration.',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createOrUpdateEmailSettings,
  getEmailSettings,
  sendTestEmail,
};
module.exports.createOrUpdateEmailSettings = createOrUpdateEmailSettings;
module.exports.getEmailSettings = getEmailSettings;
module.exports.sendTestEmail = sendTestEmail;
