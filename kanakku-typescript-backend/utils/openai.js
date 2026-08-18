// utils/openai.js
const OpenAI = require("openai");
const dotenv = require("dotenv");

dotenv.config();

// Lazy initialisation: only build the client when it's first used.
// Eagerly constructing the OpenAI client on require would crash the entire
// process if OPENAI_API_KEY is missing, even when no caller ever hits this
// module (the Anthropic-driven flow is the default path today). Spec slice
// 2.4 deletes this file outright.
let openai = null;

function getClient() {
    if (openai) return openai;

    if (!process.env.OPENAI_API_KEY) {
        throw new Error(
            'OPENAI_API_KEY is not set; the OpenAI helper was invoked but no key is configured.'
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

// Helper function for chat completions with better error handling
const createChatCompletion = async (messages, options = {}) => {
    try {
        const model = process.env.OPENAI_DEPLOYMENT_NAME || "gpt-4";

        console.log('Using OpenAI model:', model);

        const client = getClient();
        const response = await client.chat.completions.create({
            model: model,
            messages: messages,
            temperature: options.temperature || 0.3,
            max_tokens: options.max_tokens || 1000,
            response_format: options.response_format || { type: "json_object" },
            ...options
        });

        return response;
    } catch (error) {
        console.error('OpenAI API Error Details:', {
            message: error.message,
            status: error.status,
            headers: error.headers,
            code: error.code
        });
        throw error;
    }
};

// Preserve the historical export shape (`{ openai, createChatCompletion }`).
// `openai` is a Proxy so callers can destructure it at module-load time
// without triggering client construction — the real client is only built
// when a property is actually accessed on it.
const openaiProxy = new Proxy({}, {
    get(_target, prop) {
        const client = getClient();
        const value = client[prop];
        return typeof value === 'function' ? value.bind(client) : value;
    },
});

module.exports = {
    openai: openaiProxy,
    createChatCompletion,
};