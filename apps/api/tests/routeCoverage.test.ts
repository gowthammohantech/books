import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

// Both files are mounted at /api/admin (server.ts): adminRoutes.ts is the bulk,
// dimensionRoutes.ts adds cost-centers/projects/dimension P&L reports. Every
// admin route in either file must carry requirePermission(...) OR an explicit
// /* self */ exemption marker (self/identity routes intentionally gated by
// `protect` alone).
const files = ['routes/adminRoutes.ts', 'routes/dimensionRoutes.ts'];

// Each router.<verb>('path', ...) statement must contain requirePermission( OR a /* self */ marker.
const routeLine = /router\.(get|post|put|patch|delete)\(/i;

describe('admin route authorization coverage', () => {
  for (const rel of files) {
    it(`every admin route in ${rel} has requirePermission or an explicit self-exemption`, () => {
      const file = path.join(__dirname, '..', rel);
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const offenders: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        // Skip commented-out route declarations (e.g. `// router.get(...)`).
        if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
        if (!routeLine.test(lines[i])) continue;
        // Gather the full statement (until the line ending in `);`).
        let stmt = lines[i];
        let j = i;
        while (!/\);\s*$/.test(stmt) && j < lines.length - 1) { j++; stmt += '\n' + lines[j]; }
        if (!/requirePermission\(/.test(stmt) && !/\/\*\s*self\s*\*\//.test(stmt)) {
          offenders.push(lines[i].trim());
        }
      }
      expect(offenders, `Ungated admin routes in ${rel}:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});


// ---------------------------------------------------------------------------
// Tenant-scope coverage
// ---------------------------------------------------------------------------
//
// Authorization ("may this role do this?") and isolation ("whose data is it?")
// are different questions, and the block above only asks the first. A route can
// be perfectly permissioned and still read every workspace's rows — which is
// exactly what P4's sweep found in 56 places.
//
// lib/tenantGuard.ts is the structural answer, but it has documented holes
// (raw SQL, relation reads, `connect`) and ships in `warn` mode, so it is
// defence in depth rather than the only line. This check keeps the FIRST line
// honest: every routed controller either scopes itself, or says out loud that
// it does not need to.
//
// A controller qualifies by importing requireTenantId / tenantScope /
// requireActingUserId, or by carrying a `@cross-tenant` marker explaining why
// it legitimately spans workspaces (auth, public token links, webhooks,
// platform version info).

/** Controllers referenced by a route file, resolved to a path on disk. */
function routedControllerFiles(routeFile: string): string[] {
  const src = fs.readFileSync(path.join(__dirname, '..', routeFile), 'utf8');
  const found = new Set<string>();

  // `require('../controllers/x')`, `require('@controllers/x')`, and
  // `import ... from '../controllers/x'` all appear in these files.
  const re = /(?:require\(|from\s+)['"]((?:\.\.\/|@)controllers\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rel = m[1].replace(/^@controllers\//, '../controllers/');
    for (const ext of ['.ts', '.js']) {
      const abs = path.join(__dirname, '..', 'routes', rel + ext);
      if (fs.existsSync(abs)) { found.add(abs); break; }
    }
  }
  return [...found];
}

const SCOPING = /requireTenantId|tenantScope|requireActingUserId/;
const CROSS_TENANT = /@cross-tenant/;

describe('routed controllers are tenant-scoped', () => {
  for (const rel of [...files, 'routes/authRoutes.ts', 'routes/exportRoutes.ts',
                     'routes/timeTrackingRoutes.ts', 'routes/mtdRoutes.ts',
                     'routes/taxReturnRoutes.ts', 'routes/reminderRoutes.ts']) {
    it(`every controller behind ${rel} scopes by tenant or declares why not`, () => {
      const controllers = routedControllerFiles(rel);
      // A route file that resolves no controllers means the regex has drifted,
      // which would make this test pass by looking at nothing.
      expect(controllers.length, `no controllers resolved from ${rel}`).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const abs of controllers) {
        const src = fs.readFileSync(abs, 'utf8');
        if (SCOPING.test(src) || CROSS_TENANT.test(src)) continue;
        offenders.push(path.relative(path.join(__dirname, '..'), abs));
      }

      expect(
        offenders,
        `These controllers neither scope by tenant nor carry a /* @cross-tenant: reason */ marker:\n` +
          offenders.join('\n'),
      ).toEqual([]);
    });
  }
});
