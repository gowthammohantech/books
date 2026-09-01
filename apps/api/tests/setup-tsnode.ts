/**
 * Global test setup: register ts-node so that plain-JS CJS controllers
 * (e.g. controllers/externalController.js) can require TS modules
 * (lib/prisma.ts, utils/generateToken.ts) without a compile step.
 *
 * This file is listed in vitest.config.ts → test.setupFiles and runs
 * before any test file is evaluated.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('ts-node/register');
