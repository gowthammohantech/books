#!/usr/bin/env node
// The workspace packages are CommonJS by default (no "type" field), so Node and
// bundlers would read the ESM build's .js files as CommonJS. Dropping a tiny
// {"type":"module"} into the ESM output directory marks just that subtree,
// without making the whole package ESM — which would break the CJS build that
// apps/api requires.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist/esm');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log(`[esm-marker] wrote ${join(dir, 'package.json')}`);
