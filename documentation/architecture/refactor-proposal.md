# Production-grade refactor proposal

> **Point-in-time audit — measured against `bc0cebd` on branch `feat/mid`.** Every count below was
> taken from the tree, not estimated, and nothing regenerates them. Re-verify before acting, the way
> `documentation/product/modules-to-modify.md` asks you to — that document went stale for exactly
> this reason.
>
> **Scope:** this is an assessment and a plan. No application code was changed to produce it.

## Contents

1. [Architecture assessment](#1-architecture-assessment)
2. [Backend refactor proposal](#2-backend-refactor-proposal)
3. [Frontend refactor proposal](#3-frontend-refactor-proposal)
4. [Proposed folder structure](#4-proposed-folder-structure)
5. [Class-based API design](#5-class-based-api-design)
6. [Duplication extraction list](#6-duplication-extraction-list)
7. [Step-by-step migration plan](#7-step-by-step-migration-plan)
8. [Risks and compatibility notes](#8-risks-and-compatibility-notes)
9. [Suggested tests](#9-suggested-tests)
10. [Defects found while auditing](#10-defects-found-while-auditing)

---

## 1. Architecture assessment

### 1.1 What this is

An npm-workspace monorepo on Turborepo. Two deployables and three shared packages:

| Workspace | Stack | Size |
|---|---|---|
| `apps/api` | Express 5.1, Prisma 5.22, PostgreSQL 16, TypeScript 5.6 `strict` | 297 source files; 101 controllers totalling 58,555 LOC |
| `apps/web` | React 19, Vite, Redux Toolkit, MUI + Tailwind | 199 pages totalling 76,909 LOC; 137 components, 16,841 LOC |
| `packages/{enums,money,validation}` | dual CJS/ESM builds | 1,808 LOC |

`prisma/schema.prisma` is 3,570 lines across 104 models. The backend has 210 test files
(~1,849 tests); the frontend has 19 unit suites plus a Playwright layout harness.

### 1.2 Start here: most of the obvious work is already done

This codebase has been through a deliberate five-phase modernisation, recorded in
`documentation/development/monorepo-migration.md`. A refactor proposal that ignores it would
re-litigate settled decisions and churn good code. Already complete:

- **JS → TS.** Zero JavaScript source outside three tooling configs.
- **Workspaces + Turborepo + CI**, production running compiled `dist/` (cold start 8.1s → 2.0s).
- **Shared packages**, each extracted because a real drift bug had already happened:
  `@elixirbooks/enums` is code-generated from `schema.prisma` with a CI freshness check;
  `@elixirbooks/money` unified rounding that disagreed with the server on ~1 line in 825.
- **An HTTP client.** `apps/web/src/lib/apiClient.ts` — one axios instance, base URL, a
  token-attaching request interceptor, and the 401 handler moved off the global axios default.
  It replaced 303 hand-written `Authorization` headers. Adoption is near-total: 566 `api.*` calls
  across 207 files, and no `axios.get`/`axios.post`-style call anywhere else. **Correction to an
  earlier draft of this document, which claimed only `axios.create()` remained:
  `pages/admin/settings/ProfileSettings.tsx` still makes 4 requests using the bare *call form*
  `axios(url, {…})` at `:102`, `:142`, `:159`, `:177`. A `grep` for `axios.get(` does not find
  them.** They ride the global axios default, so they have **no interceptor** — which makes their
  hand-written `Bearer` headers load-bearing, not redundant. See §10.8.

**Phase 5 stopped at a line it documented.** `apiClient.ts:15-19`:

> Scope is deliberately narrow: a base URL, auth, and the 401 handler. […] Response unwrapping is
> NOT done here: 366 call sites read `.data.data` and 44 read `.data.success`, and changing that is
> a different, much larger refactor.

That deferred migration is the substance of this proposal. It has grown since it was written:
**574 sites** now unwrap the envelope by hand.

### 1.3 What is structurally in the way

**Backend — the layering is missing, not wrong.**

| Symptom | Measured |
|---|---|
| Controllers hold everything | 101 controllers, 58,555 LOC. `invoiceController.ts` 3,557; `purchaseController.ts` 3,055. Individual handlers run 200–800 lines (`updateExpense` 773, `createInvoice` 506) |
| No data-access layer | **1,095** `prisma.<model>.<op>` call sites inside `controllers/`; 149 source files import `lib/prisma`, including **18 validators that query the database** |
| Error handling by hand, per handler | 625 `try` / 630 `catch`; **473** hand-rolled `res.status(500)`; 434 `console.error`. `sendPrismaError` exists and is used in 6 files. `instanceof UnauthorizedError → 401` is re-implemented **165 times** |
| Error shapes inconsistent, and leaky | Seven distinct 500-payload shapes. ~257 return raw `err.message` to the client. Eight controllers never emit `success` at all |
| Response envelope drift | `lib/responses.ts` is a five-line stub with its only export deleted. Two competing pagination key sets: `{total,page,limit,totalPages}` and `{page,pageSize,total,totalPages}` |
| Validation partial | `express-validator` covers **53 of 233** mutating routes (23%). The result-handler is duplicated four times across two response shapes. Nine controllers call `validationResult` inline |
| No config layer | **132** `process.env` reads across 48 files, 46 distinct variables, `dotenv.config()` called twice, no boot-time validation — a missing `JWT_SECRET` surfaces as a per-request 500, not a startup failure |
| No logger | **681** `console.*` calls (502 `error`, 151 `log`), no request correlation, no levels, no access log |
| Layout inconsistent | 92 controllers sit flat in one folder; four domain subfolders exist. `services/` contains only AI code — the name promises a layer it does not provide |

**Frontend — the structure is fine; the layers are underfilled.**

| Symptom | Measured |
|---|---|
| Envelope unwrapped at every call site | **574** `.data.data` reads, each with its own defensive fallback |
| Endpoint constants exploded | `constants/api.ts` has **417 keys for 252 distinct URLs**. `/admin/invoices` appears under 13 keys, one per verb |
| Dead auth headers | **284** hand-written `` `Bearer ${token}` `` across 90 files, all redundant since the interceptor landed — and they force every component to `useSelector` the token |
| No error normalisation | The interceptor re-rejects the raw `AxiosError`. 65 `axios.isAxiosError` guards + 62 `.data.message` digs, and **728 toast calls** (492 error, 236 success) against 566 requests |
| Server state hand-rolled | 163 files pair `useEffect` with an `api.*` call; ~170 loading/error/data triads. None have abort or cleanup |
| Document forms forked | 13 form pages, 18,161 LOC. `CreatePurchase`/`EditPurchase` share **1,387 of 1,490 lines** |
| List pages forked | 53 list pages, 19,101 LOC. `PaginationData` is redeclared in 29 files |
| Whole app in one bundle | `AdminRoute.tsx`: **209 routes, 0 `lazy()`**, 158 eager page imports. Every 1,200-line document editor ships on first paint |

### 1.4 What must be preserved

This is not legacy sludge. A large amount of careful, well-reasoned work sits under `lib/` and
`middleware/`, and churning it would be a net loss. **Do not touch:**

- **`lib/prisma.ts`** — the `prisma` / `prismaUnscoped` split, documented as "the deliberate
  cross-tenant escape hatch, and it is deliberately grep-able". Only 12 non-test files use the
  unscoped client; that number is an auditable security property. Repositories must take the
  *extended* client, never construct their own.
- **`lib/tenantGuard.ts` + `lib/tenantContext.ts` + `lib/auditExtension.ts`** — three-layer tenant
  isolation. Note `tenantContext.ts:76-86`'s load-bearing `Promise.resolve`, which forces lazy Prisma
  thenables to start *inside* the AsyncLocalStorage scope. **A repository method that returns an
  un-awaited query builder breaks tenant scoping.**
- **`middleware/authMiddleware.ts`** — membership-is-the-authorisation (the JWT's `tenantId` is a
  selector, never a grant), one-query permission load, and a deliberate 401-vs-503 distinction so a
  database blip does not sign out the whole install. The best file in the repository.
- **`middleware/requirePermission.ts` and route-level gating.** Only 7 of 101 controllers touch
  `req.actor` beyond ids, and those do row-level narrowing a route gate cannot express. Controllers
  being ignorant of RBAC *is* the target architecture; it is already achieved.
- **`tests/routeCoverage.test.ts` and `tests/eslintTenancyGuards.test.ts`** — build-failing
  meta-tests that enforce "every admin route carries `requirePermission`" and "every routed
  controller scopes itself or declares `@cross-tenant`". These are the refactor's safety net.
- **The ESLint ban on `$queryRaw` outside `prisma/**`.** Repositories are precisely where someone
  will reach for raw SQL, which is invisible to the tenant guard.
- **`lib/` as the domain layer** — `ledger/` (51 files), `tax/`, `moneyFlow/`, `reports/`,
  `financialQueries.ts`. Already Express-free and unit-tested. Two signatures to adopt verbatim
  rather than reinvent: `financialQueries.ts`'s `(tenantId, …) → typed result`, and
  `ledger/ledgerPosting.ts`'s `(tx: PostingTx, …)` unit-of-work threading.
- **`lib/timeTracking/scope.ts`** — a structural `ScopePrisma` port with an injected client, written
  so tests can stub it. The best in-repo template for an injectable repository.
- **The existing class idioms** — provider/strategy classes (`AiProvider`, `PaymentGateway`,
  `EInvoiceProvider`, `IntegrationProvider`) with registries, and the 12 typed error classes.
- **`apps/web/src/components/ui/`** — a real design system (`Button` in 135 files), backed by
  `designTokens.ts` and enforced by `npm run lint:tokens`.
- **The `@elixirbooks/money` re-export pattern** (`utils/round2.ts`, `utils/invoiceStatus.ts`): share
  the pure maths, keep the presentational half local, and record in a comment which bug the sharing
  fixed.
- **The comment culture.** These files explain *why*, with numbers and named failure modes, and they
  document known limitations (`tenantGuard.ts:18-48`). Preserve comments when moving code — they are
  the design record.

### 1.5 The one-line summary

> The backend needs layers it does not have. The frontend has the layers and has not filled them.

---

## 2. Backend refactor proposal

Four layers, each with one job. The rule that makes it work: **a layer may only talk downwards.**

```
routes/       wiring only — path, middleware chain, controller method. No logic.
controller    HTTP in, HTTP out. Parse → delegate → respond. Never touches Prisma.
service       business logic, transactions, orchestration. Calls lib/ for domain maths.
repository    the only place Prisma is touched. Tenant scoping is structural here.
lib/          UNCHANGED. Pure domain maths (ledger, tax, totals). No Express, no HTTP.
```

### 2.1 Centralise error handling — the highest-value change

**The single biggest lever is already installed and unused.** The app is on **Express 5**, which
forwards a rejected promise from an `async` handler to `next(err)` automatically, and
`prismaErrorHandler` is already mounted last at `server.ts:121`. So the 625 `try` blocks and 473
hand-rolled 500s are, mechanically, deletable — the machinery to replace them is in place.

Introduce one hierarchy in `core/errors/`, absorbing the 12 classes currently scattered across
`lib/` (`UnauthorizedError` in `tenantScope.ts`, `ForbiddenError` in `timeTracking/scope.ts`,
`LedgerError`/`PeriodLockedError`, `AiDisabledError`, and the two independent `BadRequestError`
definitions in `staffActivityController.ts:21` and `mtdController.ts:57`):

```ts
export abstract class AppError extends Error {
  abstract readonly status: number;
  readonly expose = true;                 // safe to show the client
  constructor(message: string, readonly details?: Record<string, string>) { super(message); }
}

export class BadRequestError  extends AppError { readonly status = 400; }
export class UnauthorizedError extends AppError { readonly status = 401; }
export class ForbiddenError    extends AppError { readonly status = 403; }
export class NotFoundError     extends AppError { readonly status = 404; }
export class ConflictError     extends AppError { readonly status = 409; }
export class PeriodLockedError extends AppError { readonly status = 423; }
```

Then extend the existing `toHttpError` (do not replace it — its Prisma mapping is good) with an
`AppError` branch, and make one rule absolute: **an error that is not an `AppError` is a 500 and its
message is never sent to the client.** That closes the ~257 sites currently leaking exception text.

The 165 repeated `instanceof UnauthorizedError → 401` checks disappear: `requireTenantId` already
throws the typed error, and the central handler now maps it.

### 2.2 One response envelope

`lib/responses.ts` is a five-line stub — it is a slot waiting for this. The dominant shape today is
`{ success, message, data }` with `pagination` nested inside `data`, so standardise on that; it is
also what the frontend's `types/apiResponses.ts` already expects.

```ts
export class ApiResponse {
  static ok<T>(res: Response, data: T, message = 'OK'): void;
  static created<T>(res: Response, data: T, message: string): void;
  static paginated<T>(res: Response, page: Page<T>, key: string, message: string): void;
  static noContent(res: Response): void;
}
```

This resolves the seven payload shapes, the two pagination key sets, and the eight controllers that
never emit `success`. **It is a breaking change for any client reading the minority shapes** — see
§8.

### 2.3 Repositories: make tenant scoping structural

Today `tenantScope(req)` — documented as "the canonical `where` partial that EVERY controller should
spread" — is used 28 times, while `where: { tenantId … }` is hand-written 257 times and
`isDeleted: false` appears 454 times. Two soft-deletes (`contactController.ts:206`,
`accountController.ts:155`) omit `tenantId` entirely and lean on a guard that ships in `warn` mode.

A base repository makes the scoping impossible to forget rather than merely conventional:

```ts
export abstract class BaseRepository<TDelegate, TWhere> {
  protected constructor(protected readonly db: PrismaClient) {}
  protected abstract get delegate(): TDelegate;

  protected scope(tenantId: string, where?: TWhere): TWhere {
    return { ...where, tenantId, isDeleted: false } as TWhere;
  }

  // Always awaits internally — never returns a bare Prisma thenable, which would
  // escape the AsyncLocalStorage tenant scope (see lib/tenantContext.ts:76-86).
  async paginate(tenantId: string, opts: ListOptions<TWhere>): Promise<Page<T>> { … }
  async findOwned(tenantId: string, id: string): Promise<T>  // throws NotFoundError
  async softDelete(tenantId: string, id: string): Promise<void>
}
```

`paginate` alone absorbs the byte-identical skeletons in `UnitsController`, `BrandsController` and
`expenseCategoryController`, plus the ten competing spellings of "parse the page number"
(`Number(req.query.page ?? 1)`, `Math.max(1, parseInt(…))`, `toPositiveInt(…)`, …) found across
`contactController.ts:49`, `refundController.ts:11`, `invoicePaymentController.ts:120`,
`inventoryController.ts:61`, `activityLogController.ts:17`, `aiExtractionController.ts:148`.

Repeated `select` blocks get a home too. The customer projection is currently re-declared in
`invoiceController.ts:1939`, `creditNoteController.ts:489,690`, `deliveryChallanController.ts:597,736`,
`quotationController.ts:382,833` and `publicRoutes.ts:95,184` — five spellings of the same idea.
`services/ai/paymentFollowup.ts:34` already shows the fix (`const legacySelect = {…} as const`).

### 2.4 Class-based controllers and services

Controllers become classes with **class-property arrow methods**, so `this` binds without `.bind()`
at the route:

```ts
export class InvoiceController extends BaseController {
  constructor(private readonly invoices: InvoiceService) { super(); }

  list = this.handler(async (req, res) => {
    const query = listInvoicesDto.parse(req.query);
    const page = await this.invoices.list(requireTenantId(req), query);
    ApiResponse.paginated(res, page, 'invoices', 'Invoices fetched successfully');
  });

  create = this.handler(async (req, res) => {
    const dto = createInvoiceDto.parse(req.body);
    const invoice = await this.invoices.create(requireTenantId(req), requireActingUserId(req), dto);
    ApiResponse.created(res, invoice, 'Invoice created successfully');
  });
}
```

`this.handler` is `asyncHandler` — it catches, and lets Express 5 forward to the central handler.
There is no `try`/`catch` in a controller, ever.

Services take their collaborators through the constructor. **No DI framework** — manual composition
in a `core/container.ts` root, which is how the existing provider registries
(`lib/aiProviders/registry.ts`, `lib/paymentGateway.ts`) already work:

```ts
// core/container.ts — the composition root
const invoiceRepo    = new InvoiceRepository(prisma);
const invoiceService = new InvoiceService(invoiceRepo, ledgerService, numbering);
export const invoiceController = new InvoiceController(invoiceService);
```

```ts
// modules/invoice/invoice.routes.ts — wiring only, unchanged in shape from today
router.get('/invoices', protect, requirePermission('invoices', 'view'), invoiceController.list);
```

The route chain keeps its exact current shape, so `tests/routeCoverage.test.ts` — which parses
`adminRoutes.ts` and fails the build on a route missing `requirePermission` — keeps passing without
modification. That is deliberate.

### 2.5 Config and logging

**`config/`** — one typed module, validated once at boot, replacing 132 scattered `process.env`
reads. Fail fast: a missing `JWT_SECRET` should stop the process, not surface as a per-request 500
from `authMiddleware.ts:57`. This is also where the `SMTP_PASSWORD`/`SMTP_PASS` and
`SMTP_EMAIL`/`SMTP_USER` drift gets resolved to one name each.

**`core/logging/`** — a structured logger over the 681 `console.*` calls. The correlation work is
already done: `lib/auditContext.ts` puts `userId`, `tenantId`, `ipAddress` and `userAgent` in
AsyncLocalStorage on every request, so the logger can pull those fields with **zero call-site
changes**.

### 2.6 Validation

Move to one middleware, one shape. Today the result-handler exists four times
(`middleware/handleValidationResult.ts` plus local copies in `validators/unitsValidator.ts:7`,
`updateProfileValidator.ts`, `Admin/AI/aiValidator.ts`) emitting two different envelopes, and nine
controllers additionally call `validationResult(req)` inline.

Two structural notes:

- **Coverage is 23%** (53 of 233 mutating routes). Closing that gap is worth more than restyling the
  53 that exist.
- **18 validators query the database** (42 Prisma call sites) to do uniqueness and FK checks. That
  is a hidden data-access layer. Those checks belong in the service, where they can share a
  transaction with the write they guard — today a uniqueness check in a validator and the insert in
  the controller are two round-trips with a race between them.

Whether to keep `express-validator` or move to a schema library is a real decision, deliberately
left open here: `joi` is already a dependency and **never imported** (see §10), so the choice is
between express-validator and something new, not between the two installed libraries.

### 2.7 Extract the nine inline route handlers

557 route registrations, and **548 are clean wiring**. The exceptions are all in two files:
`routes/publicRoutes.ts` (4 handlers, one ~85 lines doing cross-tenant lookup, `runAsTenant`, and
hand-mapping ~25 fields) and `routes/conversationRoutes.ts` (5 handlers, with their own local
`workspaceIdOf`/`noWorkspace`/`message(err)` helpers). Small, contained, and worth doing early as a
low-risk warm-up.

---

## 3. Frontend refactor proposal

### 3.1 The structure is already right

`@api @lib @models @components @constants @hooks @pages @store @utils @context` are aliased
consistently in `vite.config.ts` and `tsconfig.app.json`, and inherited by `vitest.config.ts`. The
`components/ui/` design system is real and adopted. **The folder layout needs no reorganisation.**

The problem is that `src/api/` holds **two files serving 566 call sites**. Those two files —
`customFieldTypeApi.ts` and `expenseCategoryApi.ts` — are already the correct shape (`import api
from '@lib/apiClient'`, a typed generic, return `res.data`) and are already consumed through React
Query. The work is to **populate the pattern that exists**, not to invent one.

### 3.2 Three things the client layer must absorb

**Envelope unwrapping (574 sites).** Every call site does its own digging, with its own fallbacks.
`hooks/useCurrencies.ts:46` shows where that ends up:

```ts
const raw = res.data?.data;
const arr: CurrencyOption[] = Array.isArray(raw) ? raw : (raw?.currencies ?? raw?.data ?? []);
```

**Error normalisation (65 `isAxiosError` guards + 62 `.data.message` digs).** The correct helper
already exists, in one place — `store/auth/authSlice.ts:80-86`'s `readError`. Promote it into the
client as a typed `ApiError`, and `axios` disappears as an import from 43 more files.

**Toasting (728 calls against 566 requests).** More than one toast per request on average. Success
toasts belong in mutation callbacks; error toasts belong in one place, driven by the normalised
`ApiError`.

### 3.3 Standardise on React Query

It is **already a dependency, already wired** (`QueryClientProvider` in `main.tsx:54`), and already
used in 9 files. Meanwhile 163 files hand-roll the loading/error/data triad, none with abort or
cleanup, and two places have hand-built caches that are literally React Query's job:
`hooks/useCurrencies.ts:19-20` (`_cached` + `_inflight` module globals) and
`context/SetupStatusContext.tsx`'s `lastFetchedFor` ref.

**The cheap migration path:** all 14 legacy data hooks return the same `{ data, loading, refetch }`
contract. Swap their internals to React Query and **no consumer changes at all**. That is a
near-zero-risk first move that converts most of the triads before a single page is touched.

Configure `QueryClient` defaults explicitly (`staleTime`, `retry`, `gcTime`); it is currently
`new QueryClient()` with none.

### 3.4 Consolidate the forked pages

This is where the LOC is. Both clusters are covered with measurements in §6.

- **13 document form pages, 18,161 LOC.** Create/Edit pairs are 80–90% identical
  (`CreatePurchase`/`EditPurchase`: 1,387 of 1,490 lines). Cross-document overlap is ~950–990 lines.
  Fourteen files each redefine `handleInLineItemChange`, `handleRemoveItem`, `handleNewRow` and
  `handleCustomFieldChange`; thirteen redefine `roundedGrandTotal`.
- **53 list pages, 19,101 LOC.** `PaginationData` redeclared 29 times; the `from`/`to` display maths
  duplicated in 47 files; `handlePageLengthChange` 80 times.

The fix is **hooks, not components**. Shared presentational components are already well adopted
(`Table` 57 files, `Modal` 45, `PaginationWrapper` 47, `Button` 135). What is duplicated is the
*logic* around them.

### 3.5 Route manifest and code splitting

`AdminRoute.tsx` has 209 `<Route>` tags, **zero `lazy()`**, and 158 eager page imports — so every
1,200-line document editor is in the initial bundle. Separately, 51 of 52 nav paths in
`lib/navigation.tsx` duplicate route literals in `AdminRoute.tsx` with no compile-time link;
`lib/navPaths.ts` already exists as a hand-maintained patch for the drift that causes.

One `routeManifest.ts` of `{ path, slug, action, title, Component: lazy(…) }` feeds both, and gives
the code-splitting seam for free. This is the only frontend item that is a performance change rather
than a maintainability one, and it is likely the largest single user-visible win in the document.

---

## 4. Proposed folder structure

### 4.1 Backend — current problems

| Problem | Detail |
|---|---|
| Flat controller dump | 92 of 101 controllers in one folder; only `Admin/Invoice`, `Admin/Purchases`, `Admin/AI` and `timeTracking` are grouped |
| Naming is inconsistent | `ProductController.ts` and `UnitsController.ts` beside `expenseController.ts` and `bankDetailController.ts` |
| `services/` is a false promise | It contains only the seven AI files. A newcomer reasonably expects the business layer there and finds it in `lib/` |
| No home for cross-cutting code | Errors, config, logging, pagination and response shaping have nowhere to live, so they live everywhere |
| Related code is scattered by kind | An invoice change touches `routes/adminRoutes.ts`, `controllers/Admin/Invoice/`, `validators/`, `lib/ledger/`, `tests/` — five directories |

### 4.2 Backend — target

```
apps/api/
  config/                  # typed env schema, validated once at boot
  core/                    # cross-cutting, domain-agnostic. Imports nothing from modules/.
    errors/                #   AppError hierarchy + toHttpError mapping
    http/                  #   BaseController, asyncHandler, ApiResponse, pagination/search parsing
    repository/            #   BaseRepository: tenant scoping, paginate, findOwned, softDelete
    logging/               #   structured logger, correlation from the existing AuditContext ALS
    container.ts           #   composition root — manual constructor injection
  modules/<domain>/        # one folder per domain: invoice, purchase, product, expense, banking, ai…
    <domain>.routes.ts     #   wiring only
    <domain>.controller.ts #   class; HTTP only, no Prisma
    <domain>.service.ts    #   class; business logic and transactions
    <domain>.repository.ts #   class; the only Prisma access
    <domain>.dto.ts        #   request/response shapes
    <domain>.validator.ts
    <domain>.spec.ts
  lib/                     # UNCHANGED — pure domain maths: ledger/, tax/, moneyFlow/, reports/
  middleware/              # UNCHANGED — auth, permissions, upload, audit context
  prisma/                  # UNCHANGED
  tests/                   # UNCHANGED — cross-cutting and meta-tests stay here
```

**Why each folder exists.** `config/` so environment access is typed and fails fast, once.
`core/` so cross-cutting concerns have one home and can be unit-tested without Express — it depends
on nothing in `modules/`, which keeps the dependency graph acyclic. `modules/` so everything about
one domain is in one folder and a feature change is one directory, not five. `lib/` stays exactly as
it is because it is already the right thing: Express-free, tested, pure. `middleware/` stays because
route-level auth and RBAC are already the target design.

`services/` folds into `modules/ai/`. It is a rename of seven files that removes a misleading signpost.

### 4.3 Frontend — current problems

| Problem | Detail |
|---|---|
| `src/api/` nearly empty | 2 files for 566 call sites; the other ~560 are inline in components |
| One endpoint god-object | `constants/api.ts`: 417 keys, 252 distinct URLs, one key per verb |
| `lib/` vs `utils/` boundary is unprincipled | `utils/invoiceStatus.ts` and `lib/lineTax.ts` are both "domain money logic wrapping `@elixirbooks/money`" in different folders |
| Three modules make HTTP calls from outside `src/api/` | `utils/downloadExport.ts`, `utils/publicDocumentLink.ts`, `lib/lineTax.ts` (`resolveLineTaxByRateId`) |
| `types/` has drifted | 48 files, mixed kebab/camel naming; `bank-transaction.ts` *and* `bankTransaction.ts` both exist; `register.tsx` is a `.tsx` holding only types; only 3 response envelopes are typed at all against 574 unwraps |

### 4.4 Frontend — target

Deliberately a **small delta**. Everything below already exists except `api/core/`, `api/resources/`
and `features/`:

```
apps/web/src/
  api/
    core/                  # ApiClient, ResourceApi, ApiError, queryKeys, types
    resources/             # InvoiceApi, PurchaseApi, ProductApi, AuthApi … (~40 classes)
    index.ts               # barrel: the singletons pages import
  hooks/                   # React Query hooks per domain + generic useListQuery/useDocumentForm
  components/ui/           # UNCHANGED — the design system
  components/admin/        # shared admin widgets
  features/<domain>/       # OPTIONAL, later: co-locate a domain's page + components + hooks
  pages/  lib/  utils/  constants/  store/  context/  types/    # unchanged
```

`features/` is marked optional on purpose. Moving 199 pages into feature folders is a large diff with
no behavioural payoff, and it should follow the extraction work rather than precede it — the right
feature boundaries are much easier to see once the duplication is gone. **Do not start here.**

---

## 5. Class-based API design

### 5.1 Layering

```
page / hook   →  React Query        (caching, loading, retry, invalidation)
                      ↓
              InvoiceApi            (domain methods, typed DTOs)   ← extends ResourceApi
                      ↓
              ResourceApi<T>        (generic CRUD over one path)   ← extends ApiClient
                      ↓
              ApiClient             (envelope unwrap, error normalisation, params)
                      ↓
              lib/apiClient.ts      (EXISTING axios instance — base URL, auth, 401)
```

**The bottom layer is not replaced.** `lib/apiClient.ts` keeps its interceptors, its
dependency-injected `installUnauthorizedHandler` (which avoids a store ↔ client circular import),
and its deliberate call-site `Authorization` override for SSO and public-link flows. `ApiClient`
wraps it.

### 5.2 `ApiClient` — request handling, unwrapping, error normalisation

```ts
export interface ApiEnvelope<T> { success: boolean; message: string; data: T; }

export class ApiError extends Error {
  constructor(
    readonly status: number | null,     // null = network/offline
    message: string,
    readonly details?: Record<string, string>,   // backend field errors
    readonly cause?: unknown,
  ) { super(message); }

  get isNetwork()  { return this.status === null; }
  get isNotFound() { return this.status === 404; }
}

export class ApiClient {
  constructor(protected readonly http: AxiosInstance = api) {}

  protected async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.http.request<ApiEnvelope<T> | T>(config);
      return unwrap<T>(res.data);          // tolerates bare payloads — see the note below
    } catch (e) {
      throw toApiError(e);                 // promotes authSlice.ts:80's readError
    }
  }

  protected get<T>(url: string, params?: QueryParams)  { return this.request<T>({ method: 'get', url, params }); }
  protected post<T>(url: string, data?: unknown)       { return this.request<T>({ method: 'post', url, data }); }
  // put / patch / delete likewise
}
```

Two details that matter:

- **`unwrap` must tolerate an un-enveloped response.** Not every endpoint returns
  `{success, message, data}` — eight controllers never emit `success` at all, and some return bare
  arrays. Until §2.2 lands on the backend, `unwrap` returns the payload as-is when the envelope keys
  are absent. This is what lets the two sides migrate independently.
- **`params` serialisation belongs here**, so `undefined`, empty strings and arrays are handled once
  instead of at 566 call sites.

### 5.3 `ResourceApi` — the generic that collapses 417 constants

```ts
export abstract class ResourceApi<T, TCreate = Partial<T>, TUpdate = Partial<T>> extends ApiClient {
  protected abstract readonly path: string;

  list(params?: ListParams): Promise<Paginated<T>> { return this.get(this.path, params); }
  byId(id: string): Promise<T>                     { return this.get(`${this.path}/${id}`); }
  create(dto: TCreate): Promise<T>                 { return this.post(this.path, dto); }
  update(id: string, dto: TUpdate): Promise<T>     { return this.put(`${this.path}/${id}`, dto); }
  remove(id: string): Promise<void>                { return this.delete(`${this.path}/${id}`); }
}
```

The 13 `/admin/invoices` constants become one `path`. Domain-specific calls are methods:

```ts
export class InvoiceApi extends ResourceApi<Invoice, CreateInvoiceDto, UpdateInvoiceDto> {
  protected readonly path = '/api/admin/invoices';

  payments(id: string)                                 { return this.get<InvoicePayment[]>(`${this.path}/${id}/payments`); }
  recordPayment(id: string, dto: RecordPaymentDto)     { return this.post<InvoicePayment>(`${this.path}/${id}/payments`, dto); }
  voidInvoice(id: string, reason: string)              { return this.post<Invoice>(`${this.path}/${id}/void`, { reason }); }
  publicLink(id: string)                               { return this.post<{ url: string }>(`${this.path}/${id}/public-link`); }
}

export const invoiceApi = new InvoiceApi();
```

### 5.4 Mapping to backend boundaries

One frontend class per backend module, same name, same path. `InvoiceApi.path` is
`/api/admin/invoices`; `modules/invoice/invoice.routes.ts` mounts that path. When the two drift, it
shows up as a missing method rather than a 404 at runtime — and the parity test in §9 makes it a
build failure.

Planned classes (~40, one per resource): `AuthApi`, `InvoiceApi`, `QuotationApi`, `CreditNoteApi`,
`DebitNoteApi`, `DeliveryChallanApi`, `PurchaseApi`, `PurchaseOrderApi`, `SupplierPaymentApi`,
`ProductApi`, `BrandApi`, `CategoryApi`, `UnitApi`, `ContactApi`, `ExpenseApi`, `BankingApi`,
`LedgerApi`, `ReportApi`, `PayrollApi`, `TimeTrackingApi`, `SettingsApi`, `CustomFieldApi`,
`TaxApi`, `AiApi`, …

### 5.5 React Query on top

```ts
// api/core/queryKeys.ts — one factory, so invalidation is never a guess
export const qk = {
  invoices: {
    all:   ['invoices'] as const,
    list:  (p: ListParams) => ['invoices', 'list', p] as const,
    byId:  (id: string)    => ['invoices', 'detail', id] as const,
  },
};

// hooks/invoices/useInvoices.ts
export const useInvoices = (params: ListParams) =>
  useQuery({ queryKey: qk.invoices.list(params), queryFn: () => invoiceApi.list(params) });

export const useCreateInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateInvoiceDto) => invoiceApi.create(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invoices.all }),
  });
};
```

There are **no `useMutation` calls anywhere in the app today** — every write is a hand-rolled
`try`/`catch`/`toast`/`refetch`. That is where the 728 toast calls and the manual refetches go.

---

## 6. Duplication extraction list

Ordered by impact — lines removed × files affected × confidence. Every entry was verified by reading
the files, not inferred from names.

### 6.1 Frontend — ~13,000–15,000 LOC removable (~17% of `pages/` + `components/`)

| # | Extract | Where it goes | Files | LOC saved |
|---|---|---|---|---|
| F1 | `useDocumentForm({ docType, id })` + `<LineItemsTable>` + `<DocumentTotalsPanel>` | `hooks/documents/`, `components/admin/documents/` | 13 | **7,000–9,000** |
| F2 | `useListQuery<T>` + `<ListPageShell>` | `hooks/useListQuery.ts`, `components/admin/ListPageShell.tsx` | ~46 | **~4,000** |
| F3 | `useDeleteConfirm<T>` | `hooks/useDeleteConfirm.ts` | 36 | ~900 |
| F4 | **Import `computeDocumentTotals` from `@elixirbooks/money`; delete 13 local copies** | — | 13 | ~250, **fixes 2 real bugs** |
| F5 | `routeManifest.ts` + `React.lazy` | `routes/routeManifest.ts` | 2 | ~200 + bundle split |
| F6 | `useAdminUsers()` | `hooks/useAdminUsers.ts` | 13 | ~250 |
| F7 | `<SignatureField>` | `components/admin/SignatureField.tsx` | 13 | ~150 |
| F8 | `useModuleCustomFields()` + `extractCustomFieldValue()` | `hooks/`, `utils/customFields.ts` | 4 | ~200, fixes drift |
| F9 | `<PaymentHistoryPanel>` unified | `components/admin/PaymentHistoryPanel.tsx` | 2 | ~190 |
| F10 | `<ListSearchInput>` | `components/admin/ListSearchInput.tsx` | 14 | ~100 |
| F11 | `<ActivityTimeline>` | `components/admin/ActivityTimeline.tsx` | 2 | ~90 |
| F12 | `urlToFile()` | `utils/urlToFile.ts` | 13 | ~180 |
| F13 | Payroll/misc pages → shared `Table` | — | ~11 | ~330 |
| F14 | Delete `NoRecords`, consolidate on `ui/EmptyStateRow` | — | 17 | ~50 |

**F1 — the document forms.** 13 pages, 18,161 LOC. Measured overlap:

| Pair | LOC | Identical lines |
|---|---|---|
| `CreatePurchase` / `EditPurchase` | 1,614 / 1,490 | **1,387** |
| `CreateInvoice` / `EditInvoice` | 1,691 / 2,235 | 1,183 |
| `AddCreditNote` / `EditCreditNote` | 1,201 / 1,264 | 1,034 |
| `NewDeliveryChallan` / `EditDeliveryChallan` | 1,170 / 1,329 | 1,033 |
| `CreateNewQuotation` / `EditQuotation` | 1,234 / 1,247 | 1,027 |
| `CreatePurchaseOrder` / `EditPurchaseOrder` | 1,188 / 1,226 | 977 |
| `CreateNewQuotation` ~ `AddCreditNote` *(different documents)* | — | 988 |

Fourteen files each redefine `handleInLineItemChange`, `handleRemoveItem`, `handleNewRow` and
`handleCustomFieldChange`; thirteen redefine `roundedGrandTotal`, `fetchAdminUsers`, `saveSignature`
and `docCurrencySymbol`. The line-item `<table>` markup between `CreateNewQuotation.tsx:923-965` and
`AddCreditNote.tsx:898-940` differs by **4 lines out of 43**.

The totals `useMemo` is character-identical across seven files apart from the state-setter name — and
it calls `setState` inside a `useMemo`, a correctness smell replicated 13 times.

**F2 — the list pages.** 53 pages, 19,101 LOC. `CreditNoteList` is 56% identical to `QuotationList`
on substantive lines. The repeated pieces: `interface PaginationData` (29 files, character-identical),
the `useSearchParams` derivation (46 files), `handleSearch`/`handlePageChange`/`handlePageLengthChange`
(80 occurrences of the last), the fetch effect, the `from`/`to` display maths (47 files), and the
`PaginationWrapper` JSX block.

**F4 is the one to do first.** It is the smallest diff on the list and the only one that fixes
shipped defects — see §10.

### 6.2 Backend

| # | Extract | Replaces | Scale |
|---|---|---|---|
| B1 | `core/errors` + `asyncHandler` + Express 5 async forwarding | 625 `try` / 630 `catch`, 473 hand-rolled 500s, 165 `instanceof UnauthorizedError`, ~257 message leaks | 101 controllers |
| B2 | `BaseRepository` (scope, paginate, findOwned, softDelete) | 1,095 direct Prisma calls, 257 hand-written `where: { tenantId }`, ~10 page-parse spellings, 35 hand-rolled soft-deletes | 101 controllers |
| B3 | `ApiResponse` envelope | 7 payload shapes, 2 pagination key sets, 8 controllers emitting no `success` | ~490 `res.json` sites |
| B4 | `config/` | 132 `process.env` reads, 2 `dotenv.config()` calls, no boot validation | 48 files |
| B5 | `core/logging` | 681 `console.*` | 48+ files |
| B6 | Shared `select` fragments | The customer projection, declared 5 ways in 6 files | 6 files |
| B7 | One `handleValidationResult` | 4 copies, 2 envelopes | 4 files |
| B8 | `requireOwner` middleware | Defined identically twice (`exportRoutes.ts:35`, `mtdRoutes.ts:36`) | 2 files |
| B9 | Extract 9 inline route handlers | `publicRoutes.ts` (4), `conversationRoutes.ts` (5) | 2 files |

### 6.3 Explicitly NOT worth refactoring

Listed so nobody spends time here. Each was checked and found already clean, or genuinely different:

- **Date and currency formatting.** Already centralised — `useDateFormatter` is imported by 87 files,
  `useCurrencies`/`formatMoney` by 64, and `toLocaleDateString` appears **zero** times in `pages/`
  or `components/`. Only 5 `Intl.NumberFormat` uses exist, all in legitimate central utils.
- **Status → colour mapping.** Centralised in `StatusBadge.tsx` and `InvoiceStatusBadge.tsx`, the
  latter backed by `DISPLAY_STATUS_META` from `@elixirbooks/money`.
- **`InvoiceActionToolbar` vs `PurchaseActionToolbar`.** Parallel names, 526 vs 133 LOC, genuinely
  different responsibilities (print templates, proforma conversion, void/reverse, credit notes vs. a
  two-button strip). **Do not merge.** Only the 6-line `STATUS_BADGE_COLOR` map is shared.
- **`components/ui/`.** A real, adopted design system. The only cleanup is at the bottom:
  `Radio.tsx` has 0 consumers, `Skeleton` has 1, `Checkbox` has 4.
- **Most hand-rolled `<table>` elements.** 56 pages have one without importing the shared `Table`,
  but most are legitimate: 13 accounting report grids with multi-level headers, 13 document line-item
  tables, 6 print/PDF templates, 2 public viewers. Only ~11 are genuinely fixable (F13).
- **`@elixirbooks/money` re-exports** (`utils/round2.ts`, `utils/agingBuckets.ts`,
  `utils/invoiceStatus.ts`, `lib/lineTax.ts`). These are the model, not the debt.

---

## 7. Step-by-step migration plan

Strangler fig. Each stage is independently shippable, independently revertible, and leaves the app
working. **No stage requires the previous one to be complete across the whole codebase** — old and
new coexist.

Two rules hold throughout:

1. `npm run typecheck && npm run lint && npm run test` green before every commit, with
   `tests/routeCoverage.test.ts` and `tests/eslintTenancyGuards.test.ts` among them.
2. One concern per commit. Never mix a move with a behaviour change — if a file both moves and
   changes, split it into two commits so the diff is reviewable.

### Stage 0 — safety net (2 commits)

The seams being rewritten have no tests. Add them **first**.

- `apiClient` interceptor tests: token attachment, call-site override wins, 401 redirect,
  `isNoRedirectPath`. `vitest.config.ts` already runs `environment: 'node'` and axios mocks fine
  with `vi.mock`, so **no jsdom is needed**.
- `toHttpError` table tests: P2002 → 409, P2003 → 400, P2025 → 404, validation → 400, unknown → 500.

*Check: `npm run test`.*

### Stage 1 — free wins and defect repair (~21 commits)

Deletion and defect repair; no new abstraction beyond one testable maths module. Nothing here
depends on a later stage. It is larger than the "3–4 commits" an earlier draft estimated, because
§10.3 turned out to include a data-corruption path that needs a backend fix and a backfill.

Ordered. Two constraints are hard: the `ProfileSettings`/`AccountSettings` move must precede the
`Bearer` sweep (§10.8 — those headers are load-bearing), and the per-line handlers must be fixed
before `computeDocumentTotals` is adopted (§10.1 — adopting first leaves the footer disagreeing with
the rows).

1. Dead weight: `joi` (api), `nodemailer` (web), `components/admin/RowRadioButtonsGroup.tsx`, and
   `types/js-cookie.d.ts` **together with** adding `@types/js-cookie`. Not `ui/Radio.tsx` — see §10.5.
2. Move `ProfileSettings.tsx` (4 bare `axios()`) and `AccountSettings.tsx` (4 raw `fetch`) onto `api`.
3. Delete the 282 redundant `Bearer` headers and the 33 `useSelector(token)` lines they orphan —
   never the 54 files where `token` is also a guard, an argument or a dependency.
4. `<ActivityTimeline>` (the two copies differ by 2 imports and 4 renames).
5. Make `deliveryChallanController` and `recurringScheduleController` server-authoritative, with the
   two missing `serverTotals` suites, then backfill historic rows (dry-run by default).
6. Fix `numberToWords` to round internally — one line that fixes five PDF templates (§10.2).
7. Extract the per-line maths into a testable `lib/` module, fix the 18 group-(b) handlers, then
   adopt `computeDocumentTotals` across all 14 pages.

*Check: `npm run test`; create an invoice, a quotation, a purchase order and a delivery challan,
each with a percentage line discount **that exceeds the line subtotal**, and confirm rows agree with
the footer, the screen agrees with what is persisted, and amount-in-words matches on create, after
edit, and on the printed PDF.*

### Stage 2 — backend primitives (3 commits)

`core/errors`, `core/http`, `core/repository`, `config/`, `core/logging`. **Purely additive** —
nothing adopts them yet, so the risk is a review burden, not a regression.

*Check: `npm run typecheck && npm run test`. New code is unit-tested; existing behaviour is untouched.*

### Stage 3 — backend pilot: Products (2 commits)

One domain end-to-end: `modules/product/{routes,controller,service,repository,dto}`. `ProductController`
is 877 LOC with 10 handlers — big enough to prove the pattern, small enough to review.

This is also where the **test-mocking change** is proven: 97 test files `vi.mock('../lib/prisma')`,
and constructor injection replaces that with a stub object. Do it once here, agree the shape, then
repeat.

*Check: full suite; `GET/POST/PUT/DELETE /api/admin/products` exercised against a real database;
diff the JSON responses against the pre-refactor output byte-for-byte.*

### Stage 4 — backend rollout (one commit per domain, ~12 commits)

Order: smallest and least financial first — units, brands, categories, contacts, expenses, banking,
payroll, time-tracking, reports — then **quotations, purchases and invoices last**. Those three carry
the money maths, the 84 `$transaction` uses and the ledger postings.

*Check per domain: the domain's own tests, the tenant-scope suite, and `routeCoverage.test.ts`.*

### Stage 5 — frontend API layer (one commit per resource, ~10–15 commits)

`api/core/` first, then resource classes. **Keep every `Constants` key as a deprecated alias** until
its last caller is gone; that is what lets this land incrementally instead of as a 566-site
big bang.

*Check: `npm run typecheck`; the parity test from §9; click through each migrated screen.*

### Stage 6 — React Query rollout (~8 commits)

1. **The 14 legacy data hooks first**, behind their existing `{ data, loading, refetch }` contract.
   Consumers do not change — this is the near-zero-risk half and it converts most of the ~170 triads.
2. Then list pages via `useListQuery` (F2).
3. Then form pages via `useDocumentForm` (F1) — **last**, and one document type per commit.

*Check: per screen, verify loading, empty, error, pagination, search and delete still behave. The
Playwright layout harness (`npm run test:layout`) catches layout regressions across every route.*

### Stage 7 — route manifest and code splitting (2 commits)

`routeManifest.ts`, then `React.lazy` + `Suspense`. Measure `dist/` before and after and record the
numbers in the commit message, the way the Phase 5 notes record the +13.3 KB for `decimal.js`.

*Check: `npm run build`; navigate every top-level route; confirm chunks load on demand.*

### What NOT to do

- **Do not move 199 pages into `features/`.** Large diff, no behavioural payoff, and the right
  boundaries only become visible after the duplication is gone.
- **Do not reformat.** Prettier is deliberately not a CI gate — the repo has never been formatted, so
  a blanket `--write` would bury every refactor diff.
- **Do not "fix" `lib/`.** It is the part that is already right.
- **Do not do Stages 4 and 6 concurrently.** Both touch the invoice and purchase paths; a regression
  would be ambiguous between them.

---

## 8. Risks and compatibility notes

### 8.1 The response envelope is a cross-app contract

`apps/web/src/types/apiResponses.ts` hard-codes today's shapes. Normalising the backend envelope
(§2.2) and the frontend unwrapping (§5.2) are the same change seen from two sides.

**Mitigation:** `unwrap` tolerates un-enveloped payloads from day one, so the frontend can migrate
first and the backend can follow per-domain without a flag day. There is also a **mobile client and
a public API** in the picture (`routes/publicRoutes.ts`, `routes/externalRoutes.ts`, and
`middleware/apiKeyAuth.ts` for server-to-server callers) — the eight controllers that emit no
`success` key may have consumers outside this repository. Treat `/api/public/*` and `/api/external/*`
envelopes as **frozen** unless a consumer audit says otherwise.

### 8.2 97 test files mock the Prisma module

`vi.mock('../lib/prisma')` with `vi.hoisted()` per-model `vi.fn()` maps. Constructor-injected
repositories break that pattern.

**This is the largest hidden cost in the plan — budget for it explicitly rather than discovering it
in Stage 4.** The upside is real: injecting a stub object is simpler than the `vi.hoisted`/`vi.mock`
dance, and `tests/timeTracking/scope.test.ts` already demonstrates the target shape.

### 8.3 AsyncLocalStorage scoping is fragile by design

`lib/tenantContext.ts:76-86` uses a load-bearing `Promise.resolve` to force lazily-started Prisma
thenables to begin inside the tenant scope. **A `BaseRepository` method that returns an un-awaited
query builder silently escapes tenant isolation.** The contract must be: always `await` internally,
never return a bare thenable. Add a lint rule or a review checklist item; this is a data-leak class
of bug, not a style one.

### 8.4 The tenant guard ships in `warn`, not `enforce`

`TENANT_GUARD_MODE` defaults to `warn`. No refactor step may assume the structural guard is
*catching* anything — it is currently only *reporting*. Moving to `enforce` is worthwhile and is a
separate piece of work with its own risk profile.

### 8.5 `taxReturnController.ts` is invisible to grep

Line 408 contains a literal NUL byte used as a composite-key separator:
`` const key = `${vat}\x00${country}`; ``. `grep` and `ripgrep` classify the whole 690-line file as
binary and **silently skip it** — no error, no warning. **Every codebase-wide sweep in this plan must
pass `-a`/`--text`,** or that controller will be quietly excluded from the migration and from any
"did we get them all?" verification.

### 8.6 Ordering hazards

- Landing `ApiResponse` (§2.2) before the frontend `unwrap` (§5.2) breaks any screen reading a
  minority shape. Frontend first.
- Deleting a `Constants` key before its last caller migrates is a build break. Deprecate, then delete.
- Stage 7's `React.lazy` changes render timing; components with layout effects assuming a synchronous
  mount can flicker. The Playwright layout harness is the check.

### 8.7 Build and tooling

- Backend `typecheck` runs **two** tsconfig projects (`tsconfig.json` for the app,
  `tsconfig.test.json` for the suite, which needs `module: es2022` for top-level `await` in tests).
  New folders must be included in both.
- Shared packages must be **built** before an app is type-checked on its own; `npm run typecheck` at
  the root handles the ordering, `npx tsc` inside an app does not.
- `tsconfig.build.json` excludes `tests/`, `**/*.test.ts` and `**/*.spec.ts`. Colocated
  `modules/**/*.spec.ts` files must stay excluded or they ship to production.
- Turbo caches test results. Use `npx turbo run test --force` when you actually want a re-run.
- `lib/swaggerConfig.ts` globs controller and route paths anchored to `__dirname` to auto-document
  ~481 operations. **Moving controllers into `modules/` will silently drop routes from the API docs
  unless those globs are updated** — the boot log's "auto-documented N routes" count is the canary,
  exactly as it was in Phase 4.

### 8.8 Non-risks worth stating

- **Behaviour preservation is testable here.** 210 backend test files (~1,849 tests) heavily cover
  tenant isolation and money correctness — the two things a refactor could most damage.
- **The route chain shape does not change**, so RBAC coverage is preserved by construction and the
  meta-tests keep enforcing it.

---

## 9. Suggested tests

### Before the refactor (Stage 0 — these do not exist today)

| Test | Why |
|---|---|
| `apiClient` interceptors: token attach, call-site override, 401 redirect, `isNoRedirectPath` | The seam being wrapped has **zero** coverage |
| `toHttpError` status-mapping table | The mapping is about to become load-bearing for every handler |
| Golden-master JSON for the top ~20 endpoints | Captured pre-refactor, replayed post-refactor. The cheapest possible proof of behaviour preservation |

### Added with the new primitives

| Test | Asserts |
|---|---|
| `AppError → HTTP status` table | Every subclass maps correctly; a non-`AppError` is 500 **and leaks no message** |
| `BaseRepository` tenant scoping | A query built without `tenantId` **fails**. Scoping is enforced, not conventional |
| `BaseRepository.paginate` | Boundaries: page 0, page beyond the end, limit 0, limit above the cap |
| `ApiClient.unwrap` | Enveloped payloads, **un-enveloped** payloads, `data: null`, arrays |
| `toApiError` | Axios error with a body, without a body, a network failure (`status === null`), a non-axios throw |
| Resource-path parity | Every `ResourceApi.path` resolves to a route the backend actually registers — turns the drift in §5.4 into a build failure |

### Kept green at every commit

`tests/routeCoverage.test.ts` and `tests/eslintTenancyGuards.test.ts`, the tenant-scope family
(`*.tenantScope.test.ts`), and the money suites (`documentTotals`, `serverAuthoritativeTax`,
`ledger/golden.test.ts`, `ledger/tallyCheck.test.ts`).

### Manual checks per stage

Listed inline in §7. The two that matter most: **create an invoice with a line discount and confirm
the on-screen total matches the persisted one** (the invariant `@elixirbooks/money` exists to
protect), and **switch tenants and confirm no data bleeds** (`authSlice`'s hard reload currently
guarantees this; if §3.3 ever makes tenant switching a soft transition, that guarantee needs
replacing with an explicit query-cache reset).

### Frontend coverage gap

There is **no jsdom, no `@testing-library`, and no HTTP mocking** in `apps/web` — `vitest.config.ts`
says so and explains why (`environment: 'node'`; the 19 existing suites are pure logic). Everything
above is reachable without jsdom, because `ApiClient` is a plain class. **Component tests need jsdom
+ MSW, which is its own prerequisite piece of work and must not be smuggled into a refactor commit.**

---

## 10. Defects found while auditing

These are shipped bugs, independent of whether the refactor proceeds. §6 F4 fixes the first three at
once by adopting `@elixirbooks/money`.

### 10.1 `computeDocumentTotals` was never wired up on the frontend

`packages/money/src/documentTotals.ts` states in its own header that it is *"shared by invoice /
quotation / purchase / purchase order / debit note (create AND update)"*. **No file under `apps/web`
imports `computeDocumentTotals`, `lineGross`, `lineDiscount` or `lineTaxableBase`.** Thirteen pages
re-implement the maths. 10.2 and 10.3 are consequences.

**Adoption alone does not fix 10.3, and that matters for sequencing.** All 14 form pages store a
line's `tax` as a computed *amount* and none carries a `taxRate`, so `lineTax`
(`documentTotals.ts:152-166`) falls into its *legacy bare-amount branch* and **preserves whatever
the page computed**. (`tax_group_id` and `tax_rate_id` are declared on `TotalsItem` but never read —
the backend attaches `taxRate` via `resolveItemTaxRates`; nothing on the frontend does.) Dropping
`computeDocumentTotals` into a page with the 10.3 bug would clamp its **discount** while leaving its
**tax** inflated, so the footer would disagree with the rows. The per-line handlers have to be fixed
first; adoption is only mechanical afterwards.

This is the same failure mode Phase 5 documented for rounding: an honour-system invariant, held by a
comment, that had already broken. `CreateInvoice.tsx:582-587` even carries the comment claiming
consistency with the backend's `lineDiscount` — while four sibling pages do something else.

### 10.2 Amount-in-words prints "undefined" on every PDF with a fractional total

`utils/converters.ts:43-67` `numberToWords` has **no decimal handling at all** — no paise/cents
branch, Indian crore/lakh numbering only. Given a fractional amount, `num %= 100` leaves a float and
`numToWordsBelow100` indexes its `ones` array with it. Run it and see:

```
numberToWords(145.67)  ->  "One Hundred Forty undefined"
                                            ^ ones[5.6699999999999875]
```

Five print/PDF templates pass the raw persisted `Decimal(18,4)` straight in —
`InvoiceTemplateA.tsx:213`, `InvoiceTemplateB.tsx:216`, `InvoiceTemplateA5Landscape.tsx:159`,
`QuotationTemplate.tsx:154`, `ChallanTemplateA.tsx:143` — so **every printed document whose total is
not a whole number renders "undefined" in its amount-in-words line.** The fix is one `Math.round`
inside `numberToWords`; the 13 call sites that already round are only accidentally shielded.

The rounding rule also disagrees between screens. `Math.floor` on **2** pages
(`CreateInvoice.tsx:666`, `RecurringScheduleForm.tsx:472`), `Math.round` on **12**:

| File | Line | Code |
|---|---|---|
| `pages/admin/invoices/CreateInvoice.tsx` | 666 | `const grandTotalInteger = Math.floor(grandTotal);` |
| `pages/admin/invoices/EditInvoice.tsx` | 928 | `return numberToWords(Math.round(grandTotal));` |
| `quotations/CreateNewQuotation.tsx` | 516 | `Math.round(grandTotal)` |
| `credit-notes/AddCreditNote.tsx` | 498 | `Math.round(grandTotal)` |
| `purchases/CreatePurchaseOrder.tsx` | 450 | `Math.round(grandTotal)` |
| `purchases/CreateDebitNote.tsx` | 540 | `Math.round(grandTotal)` *(and the variable is spelled `grandTotalInterger`)* |
| `delivery-challan/NewDeliveryChallan.tsx` | 481 | `Math.round(grandTotal)` |
| …and 6 more | | `EditQuotation:517`, `CreatePurchase:908`, `EditPurchase:810`, `EditPurchaseOrder:585`, `EditCreditNote:517`, `EditDeliveryChallan:583` |

An invoice for **100.60** prints "One Hundred" in words on the create screen and "One Hundred One"
after an edit — the same document, two different printed amounts. Separately,
`CreateDebitNote.tsx:539` guards with `if (grandTotal && grandTotal <= 0)`, which short-circuits at
zero and falls through to `numberToWords(0)` → lowercase `"zero"`, where every other page renders
`"Zero"`.

### 10.3 Six form pages compute line tax on the wrong base — and for two document types that corrupts data

`CreateInvoice.tsx:578-596` clamps the discount to the line subtotal and computes tax on the
**discounted** base. `NewDeliveryChallan.tsx:412-430` and `CreatePurchaseOrder.tsx:378-391` do
neither:

```ts
// NewDeliveryChallan.tsx:412-430 — no clamp, and tax ignores the discount
const discountAmount     = discount_type === 'Percentage' ? (subtotal * (discount_value || 0)) / 100 : (discount_value || 0);
const discountedSubtotal = subtotal - discountAmount;          // may go negative
const taxPerUnit         = (rate * taxRate) / 100;             // uses rate, not the discounted base
const totalTax           = taxPerUnit * qty;
```

Two consequences: a discount larger than the line total produces a **negative line**, and any
discounted line is **taxed on the undiscounted amount**. `packages/money`'s `lineDiscount` clamps to
`[0, gross]` and taxes the discounted base.

**Six pages share this shape**, not two: `EditQuotation`, `CreatePurchaseOrder`,
`EditPurchaseOrder`, `EditCreditNote`, `NewDeliveryChallan`, `EditDeliveryChallan` — three handlers
each (`handleEditingItemChange`, `handleInLineItemChange`, `handleNewProductCreated`), 18 in total.
`RecurringScheduleForm` is a hybrid: correct when a tax rate resolves, this shape when none does
(`:381-385`, `:405`).

**And for two of those document types it is not a display bug.** Six controllers recompute totals
server-side, so a wrong client figure is discarded. Two do not:

| Controller | Behaviour |
|---|---|
| `deliveryChallanController.ts:104-107` (create), `:474-483` (update) | Persists `body.subTotal` / `body.totalDiscount` / `body.totalTax` / `body.grandTotal` **verbatim**. Its validator checks only item name/rate/qty, and the **update route carries no validator at all** |
| `recurringScheduleController.ts:162-163`, `:319-320` | Same. And `lib/recurring/runner.ts:139-140` copies a schedule's stored `TotalAmount`/`totalTax` onto **every invoice it generates**, bypassing the authoritative invoice path |

This is the exact failure mode `documentTotals.ts`'s own header says it exists to prevent — *"the
legacy document controllers persisted client-supplied subTotal/totalTax/grandTotal verbatim"*. There
are `*.serverTotals.test.ts` suites for invoice, purchase and credit note and **none** for these
two: the server-authoritative work covered six document types and missed these. So a delivery
challan or recurring schedule created with a discounted line stores an inflated tax **permanently**,
and a bad schedule keeps minting bad invoices.

### 10.4 `extractCustomFieldValue` has drifted

Defined locally in four list pages. `InvoiceList`'s copy lacks the `Array.isArray` join branch the
other three have, so an array-valued custom field renders `"a,b"` on invoices and `"a, b"` everywhere
else.

### 10.5 Dead weight

| Item | Evidence |
|---|---|
| `joi` ^17.13.3 | A production dependency of `apps/api`, **never imported**. All validation is `express-validator` |
| `nodemailer` 9.1.0 | A production dependency of **`apps/web`**, 0 references. It is a Node library; it cannot run in a browser |
| `components/admin/RowRadioButtonsGroup.tsx` | 0 consumers. **Correction to an earlier draft, which named `ui/Radio.tsx` here: that one is live.** `RadioGroup` is imported from the `@components/ui` barrel by `pages/dev/TokenGallery.tsx:14` and rendered at `:365`; TokenGallery is routed (`main.tsx:66-73`, lazy, dev-only at `/_tokens`) and `tsc -b` covers all of `src`, so deleting it breaks the build |
| `types/js-cookie.d.ts` | A one-line `declare module 'js-cookie';` that makes `Cookies` fully `any`. **Correction to an earlier draft, which said js-cookie ships its own types: it does not.** `js-cookie@3.0.8` declares no `types`/`typings`, and `@types/js-cookie` is absent from the lockfile — so deleting the shim alone yields 8 × TS7016. The fix is to delete it **and** add `@types/js-cookie` |
| `types/bank-transaction.ts` + `types/bankTransaction.ts` | Two files, two naming conventions, one domain |

### 10.6 Cosmetic drift

Fourteen list pages hand-roll the same search `<input>` with an identical 90-character `className`,
**including a double-space typo**, while the rest use `<FormField>` from the design system.

### 10.7 Stale comment

`store/auth/authSlice.ts:148-157` justifies its hard page reload on tenant switch by stating there
are *"~585 bare `axios` call sites across ~204 files and no shared instance, so there is no
interceptor seam"*. **That premise stopped being true when `lib/apiClient.ts` landed.** The reload
may still be the right call, but the reason recorded for it is now wrong. §9's manual checks note
what would have to replace that guarantee if the reload were ever dropped: an explicit query-cache
reset on tenant switch.

### 10.8 Four requests bypass the shared client — and their auth headers are load-bearing

`pages/admin/settings/ProfileSettings.tsx:102,142,159,177` use the bare call form
`axios(url, {…})` against `/admin/profile`, `/admin/countries`, `/admin/states`, `/admin/cities`.
Because that is the global axios default and not `lib/apiClient`, they have no request interceptor
and no 401 handler. Their hand-written `Bearer` headers are therefore the only thing authenticating
them — **deleting those headers as "redundant" would send all four unauthenticated.** They must move
to `api.get` first. `AccountSettings.tsx` hits the same four endpoints with raw `fetch` (4 sites)
and is the same story.

---

## Appendix: how to re-derive these numbers

```bash
# Backend. NOTE the -a: controllers/taxReturnController.ts contains a NUL byte at
# line 408, so without --text, grep silently skips all 690 of its lines.
cd apps/api
grep -rhoa 'prisma\.[a-zA-Z]*\.[a-zA-Z]*(' controllers | wc -l     # 1095
grep -rhoa 'res\.status(500)' controllers | wc -l                  # 473
grep -rhoa 'instanceof UnauthorizedError' controllers | wc -l      # 165
grep -rhoa 'router\.\(post\|put\|patch\)(' routes | wc -l          # 233 mutating routes

# Frontend
cd ../web/src
grep -rhoa '\.data\.data\|data?\.data' --include=*.ts --include=*.tsx . | wc -l   # 574
grep -rhoa 'Bearer \${' --include=*.ts --include=*.tsx . | wc -l                 # 284
grep -cEa '^\s+[A-Z0-9_]+:' constants/api.ts                                     # 417 keys
grep -oEa '\$\{A?P?I?_?BASE_URL\}[^`]*' constants/api.ts | sort -u | wc -l       # 252 URLs
grep -rla 'computeDocumentTotals' --include=*.ts --include=*.tsx . | wc -l       # 0  ← §10.1

# §10.2 — the PDF "undefined". Any fractional amount reproduces it.
node -e "const o=['','one','two','three','four','five','six','seven','eight','nine'];
         const t=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
         let n=145.67; n%=1000; n%=100;
         console.log(t[Math.floor(n/10)] + ' ' + o[n%10]);"    # -> "forty undefined"
```
