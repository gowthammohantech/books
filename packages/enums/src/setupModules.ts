/**
 * The module keys the setup wizard can store, shared so the two apps cannot
 * drift apart.
 *
 * HAND-WRITTEN, unlike `generated.ts`. There is no Prisma enum behind this:
 * the selection is a per-workspace preference stored as a GeneralSetting row
 * (key `enabledModules`), not a column, so `scripts/generate.mjs` has nothing
 * to read. It lives here anyway because BOTH apps need the same list — the API
 * rejects a payload containing anything else, and the web catalogue in
 * `apps/web/src/lib/setupModules.ts` decides what each key shows and hides.
 *
 * Adding a key here is not enough to make it do anything: give it a group in
 * the web catalogue too, or it will validate and then be ignored.
 *
 * REMOVING a key is the one change to think about. Workspaces already store
 * the old value, so a removed key must keep parsing — both readers drop keys
 * they do not recognise rather than failing, which turns a removal into "that
 * module goes back to being visible" instead of a broken sidebar.
 */
export type SetupModuleKey =
    | 'accounts'
    | 'taxation'
    | 'auditTrail'
    | 'sales'
    | 'purchases'
    | 'inventory'
    | 'fixedAssets'
    | 'projects'
    | 'production'
    | 'serviceBilling';

export const SETUP_MODULE_KEYS = [
    'accounts',
    'taxation',
    'auditTrail',
    'sales',
    'purchases',
    'inventory',
    'fixedAssets',
    'projects',
    'production',
    'serviceBilling',
] as const satisfies readonly SetupModuleKey[];

/** Narrow an untrusted value to the keys this build knows. */
export function parseSetupModuleKeys(value: unknown): SetupModuleKey[] | null {
    if (!Array.isArray(value)) return null;
    const known = new Set<string>(SETUP_MODULE_KEYS);
    const keys = value.filter(
        (v): v is SetupModuleKey => typeof v === 'string' && known.has(v)
    );
    return keys.length > 0 ? keys : null;
}
