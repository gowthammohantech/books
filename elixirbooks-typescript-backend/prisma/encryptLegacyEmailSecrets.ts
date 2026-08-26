/**
 * One-time, idempotent migration of EmailSettings secrets to at-rest encryption.
 *
 * The smtpPassword/nodePassword/resendApiKey columns historically held plaintext.
 * This re-stores any plaintext value behind the `enc::` marker (see
 * lib/emailSecret). Already-encrypted values are skipped, so it is safe to run on
 * every boot. Run from prisma/seed.ts after the baseline seed.
 */
import { prisma } from '../lib/prisma';
import { encryptSecret, isEncrypted } from '../lib/emailSecret';

const SECRET_FIELDS = ['smtpPassword', 'nodePassword', 'resendApiKey'] as const;

export async function encryptLegacyEmailSecrets(): Promise<{ encrypted: number }> {
  const rows = await prisma.emailSettings.findMany();
  let encrypted = 0;

  for (const row of rows) {
    const updates: Record<string, string> = {};
    for (const field of SECRET_FIELDS) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
        updates[field] = encryptSecret(value);
      }
    }
    if (Object.keys(updates).length > 0) {
      await prisma.emailSettings.update({ where: { id: row.id }, data: updates });
      encrypted += Object.keys(updates).length;
    }
  }

  return { encrypted };
}

if (require.main === module) {
  encryptLegacyEmailSecrets()
    .then((r) => { console.log(`Encrypted ${r.encrypted} legacy email secret(s).`); return prisma.$disconnect(); })
    .then(() => process.exit(0))
    .catch(async (e) => { console.error('encryptLegacyEmailSecrets error:', e); await prisma.$disconnect(); process.exit(1); });
}
