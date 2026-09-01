#!/usr/bin/env node
/**
 * Removes build output and installed dependencies across every workspace.
 *
 * Node rather than `rm -rf` because this repo is developed on Windows and
 * deployed from Linux images, and `rm` is not a command on the former. The
 * shell built-ins differ, `fs.rm` does not.
 *
 *   npm run clean          dist + .turbo + node_modules  (full reset)
 *   npm run clean:build    dist + .turbo                 (keeps dependencies)
 *
 * Every incremental-build marker in the tree already lives inside one of these
 * directories — apps/api writes its .tsbuildinfo into dist/, apps/web writes
 * its into node_modules/.tmp — so there is nothing else to sweep. That matters
 * more than it looks: `tsc -b` reads .tsbuildinfo to decide what to skip, so a
 * clean that removed dist and left the marker behind would leave the next
 * build convinced it had nothing to do, and hand you an empty dist.
 */
import { rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Workspace roots: the repo itself, plus every directory under apps/ and packages/. */
const workspaces = () => {
  const found = [ROOT];
  for (const group of ['apps', 'packages']) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(join(dir, entry.name));
    }
  }
  return found;
};

const keepDeps = process.argv.includes('--build-only');
const targets = keepDeps ? ['dist', '.turbo'] : ['dist', '.turbo', 'node_modules'];

let removed = 0;
let bytes = 0;

/** Size of a directory, for the summary line. Best-effort: unreadable entries count as 0. */
const sizeOf = (path) => {
  let total = 0;
  const walk = (p) => {
    let stat;
    try {
      stat = statSync(p);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      let entries = [];
      try {
        entries = readdirSync(p);
      } catch {
        return;
      }
      for (const e of entries) walk(join(p, e));
    } else {
      total += stat.size;
    }
  };
  walk(path);
  return total;
};

for (const workspace of workspaces()) {
  for (const target of targets) {
    const path = join(workspace, target);
    if (!existsSync(path)) continue;
    const label = relative(ROOT, path) || target;
    bytes += sizeOf(path);
    // maxRetries: Windows holds brief locks on files a watcher or antivirus has
    // open, and the first unlink then fails on a directory that is perfectly
    // deletable a moment later.
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removed += 1;
    console.log(`  removed  ${label}`);
  }
}

const gb = bytes / 1024 ** 3;
const size = gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

if (removed === 0) {
  console.log('\n  nothing to clean\n');
} else {
  console.log(`\n  ${removed} director${removed === 1 ? 'y' : 'ies'}, ${size} freed`);
  console.log(keepDeps ? '  run `npm run build` to rebuild\n' : '  run `npm ci` to reinstall\n');
}
