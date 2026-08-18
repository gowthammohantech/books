import { prisma } from '../prisma';
import { decrypt } from '../aiCrypto';

import { ClaudeProvider } from './claudeProvider';
import { OpenAIProvider } from './openaiProvider';
import { MockProvider } from './mockProvider';
import type { AiProvider } from './types';
import { AiDisabledError } from './types';

/**
 * Resolves the configured AI provider for a user. Falls back to
 * MockProvider when the user has no config, has not enabled AI, has
 * picked the explicit MOCK provider, or has no key on file.
 *
 * Throws `AiDisabledError` when `requireEnabled` is true and the user
 * has not turned the feature on. The middleware uses this to short
 * circuit feature endpoints with HTTP 412; the config controller's
 * `test` endpoint calls without `requireEnabled` so the user can dry-run
 * a key before flipping the toggle.
 */
export async function getProviderForUser(
  userId: string,
  opts: { requireEnabled?: boolean } = {},
): Promise<AiProvider> {
  const config = await prisma.aiConfig.findUnique({ where: { userId } });

  if (opts.requireEnabled && (!config || !config.enabled)) {
    throw new AiDisabledError();
  }

  if (!config) return new MockProvider();
  if (config.provider === 'MOCK') return new MockProvider();
  if (!config.encryptedApiKey) return new MockProvider();

  const apiKey = decrypt(config.encryptedApiKey);

  if (config.provider === 'CLAUDE') {
    return new ClaudeProvider({
      apiKey,
      extractionModel: config.extractionModel ?? undefined,
      chatModel: config.chatModel ?? undefined,
    });
  }
  if (config.provider === 'OPENAI') {
    return new OpenAIProvider({
      apiKey,
      extractionModel: config.extractionModel ?? undefined,
      chatModel: config.chatModel ?? undefined,
    });
  }

  // Defensive default: any unknown provider value (e.g. a future enum
  // added to the schema but not handled here yet) falls back to mock so
  // the app doesn't crash on a stale config row.
  return new MockProvider();
}

/**
 * Convenience used by H.2/H.3 callers that need both the provider and
 * the loaded config (for budget checks, model overrides, etc.).
 */
export async function getProviderAndConfig(
  userId: string,
  opts: { requireEnabled?: boolean } = {},
): Promise<{ provider: AiProvider; config: Awaited<ReturnType<typeof prisma.aiConfig.findUnique>> }> {
  const config = await prisma.aiConfig.findUnique({ where: { userId } });
  if (opts.requireEnabled && (!config || !config.enabled)) {
    throw new AiDisabledError();
  }
  const provider = await getProviderForUser(userId, opts);
  return { provider, config };
}
