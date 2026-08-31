// utils/openai.ts
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// Lazy initialisation: only build the client when it's first used.
// Eagerly constructing the OpenAI client on import would crash the entire
// process if OPENAI_API_KEY is missing, even when no caller ever hits this
// module (the Anthropic-driven flow is the default path today). Spec slice
// 2.4 deletes this file outright.
let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (openai) return openai;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set; the OpenAI helper was invoked but no key is configured.',
    );
  }

  if (process.env.OPENAI_ENDPOINT && process.env.OPENAI_ENDPOINT.includes('azure')) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: `${process.env.OPENAI_ENDPOINT}/openai/deployments/${process.env.OPENAI_DEPLOYMENT_NAME}`,
      defaultQuery: { 'api-version': process.env.OPENAI_API_VERSION || '2024-02-15-preview' },
      defaultHeaders: { 'api-key': process.env.OPENAI_API_KEY },
    });
  } else {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatOptions = Partial<
  Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'messages'>
>;

/** Chat completion with the app's defaults and slightly louder error logging. */
export const createChatCompletion = async (
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
  try {
    const model = process.env.OPENAI_DEPLOYMENT_NAME || 'gpt-4';

    console.log('Using OpenAI model:', model);

    const client = getClient();
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 1000,
      response_format: options.response_format ?? { type: 'json_object' },
      ...options,
    });

    return response;
  } catch (error) {
    const e = error as { message?: string; status?: number; headers?: unknown; code?: string };
    console.error('OpenAI API Error Details:', {
      message: e.message,
      status: e.status,
      headers: e.headers,
      code: e.code,
    });
    throw error;
  }
};

// Preserve the historical export shape (`{ openai, createChatCompletion }`).
// `openai` is a Proxy so callers can destructure it at module-load time
// without triggering client construction — the real client is only built
// when a property is actually accessed on it.
export const openaiProxy = new Proxy({} as OpenAI, {
  get(_target, prop: string | symbol) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

export { openaiProxy as openai };

// CommonJS interop for the JS/CJS call sites that still require() this module.
module.exports = { openai: openaiProxy, createChatCompletion };
module.exports.openai = openaiProxy;
module.exports.createChatCompletion = createChatCompletion;
