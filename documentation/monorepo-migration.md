# Monorepo restructure + JS→TS migration — working notes

Base: `pc-cc` @ `c6f7946` (after PR #1 removed MongoDB).

## Baseline recorded at Phase 0

Established before any structural change. **No later phase may add to the red columns.**

| Gate | Backend | Frontend |
|---|---|---|
| `typecheck` | ✅ green (see note 1) | ✅ green (`tsc -b`) |
| `lint` | ❌ 17 errors, 710 warnings | ❌ 589 errors, 174 warnings |
| `test` | ⚠️ 205/208 files, 1832/1839 tests (see note 2) | ✅ 9 files, 118 tests |

**Note 1 — backend typecheck was red on arrival.** `tsc --noEmit` reported 8 × TS1378
("top-level `await` only allowed when module is es2022/esnext/…"). The cause: tests use the
standard vitest `vi.mock()` + top-level `await import()` pattern, which needs an ESM `module`
setting, while the app must stay `module: commonjs` because `server.js` `require()`s it.

Fixed by splitting the projects rather than dropping type-checking on 122 test files:
- `tsconfig.json` — the app. Now excludes `tests/`, `**/*.test.ts`, `**/*.spec.ts`.
- `tsconfig.test.json` — the suite. Extends the base, overrides only `module: es2022`.
  It deliberately does **not** set `types` (that would suppress the `@types/express` and
  `@types/multer` global augmentations) and deliberately does **not** override
  `moduleResolution` (bundler resolution picks Stripe's ESM typings, which lack the
  `Stripe.Stripe` namespace). It includes `types/**/*.d.ts` so the global `Request`
  augmentation is in the program.
- `typecheck` now runs both projects.

**Note 2 — 3 backend test files need a live Postgres.** `moneyGuards.applyInvoiceReceipt`,
`applyBillPayment.fx` and `applyBillPayment.tenantScope` reach `lib/actor.ts`
`tenantOwnerUserId()` unmocked, which issues a real `prisma.tenantMembership.findFirst()`.
They fail with `PrismaClientInitializationError` when `DATABASE_URL` is unset *and* when it
points at nothing. Pre-existing; a test-design gap, not a code defect.
**CI must either provide a Postgres service container or these three must mock `lib/actor.ts`.**

## Known-red detail

Backend lint errors (17) break down as:
- `@typescript-eslint/no-require-imports` — the TS→JS interop seams. These disappear on their
  own in Phase 3 when the last `.js` files are converted.
- `import/no-duplicates` — mechanical, `--fix`able.
- `prefer-const` — one occurrence.

Frontend lint (589 errors) is dominated by `@typescript-eslint/no-explicit-any` and
`prefer-const`; 113 are `--fix`able. Lint is addressed when CI lands in Phase 2, as its own
commit, so it does not obscure the migration diff.

## Phase 0 changes

- Branch restarted from `origin/pc-cc` (it was 2 commits behind and carried no unique work).
- Root `.gitignore` added — there was none. `node_modules/` (14 files) untracked;
  `docker/.env` is now genuinely ignored, having been documented as ignored in four places
  while nothing ignored it.
- `.nvmrc` (20), `.editorconfig`, and root `package.json` `name`/`private`/`engines`.
- Deleted `p3_clean.txt`, `p3_risky.txt`, `p3_targets.json` — committed orphans from a
  *completed* multi-tenancy refactor, referenced by nothing.
- Deleted `validators/signatureValidator.js`. A `.ts` twin already existed exporting the same
  two names; `adminRoutes.js:49` `require()`s the path and Node resolves `.js` first, so the
  `.ts` was dead code that would have silently become live the moment `adminRoutes` converted.
  The `.ts` is a faithful port (identical chains, messages, status codes and error shape; its
  `tryUnlink` additionally guards against unlinking an already-removed file).
- Added `nodemon.json` with `ext: ts,js,json` — `nodemon server.js` watched only
  `js,mjs,cjs,json`, so editing a `.ts` file did not restart the dev server.
- Fixed a stale comment in `lib/reminderMailer.ts` referring to `utils/placeholderHelper.js`,
  which PR #1 deleted.
