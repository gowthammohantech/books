import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Both files are mounted at /api/admin (server.js): adminRoutes.js is the bulk,
// dimensionRoutes.ts adds cost-centers/projects/dimension P&L reports. Every
// admin route in either file must carry requirePermission(...) OR an explicit
// /* self */ exemption marker (self/identity routes intentionally gated by
// `protect` alone).
const files = ['routes/adminRoutes.js', 'routes/dimensionRoutes.ts'];

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
