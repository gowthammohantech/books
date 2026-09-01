import { LINE_CENTRE_NONE } from '@components/admin/CostCenterSelect';

/**
 * Map a persisted line's RESOLVED profit centre back to the form's three-state
 * value: '' = inherit the header, '__none__' = deliberately untagged, or an id.
 *
 * The server resolves inheritance at write time, so every persisted line carries
 * an explicit centre. Hydrating that value straight into the form would make
 * every line look manually overridden — and, worse, those lines would then stop
 * following a change to the document's centre.
 */
export function resolveHydratedLineCentre(
    lineCentre: string | null | undefined,
    headerCentre: string | null,
): string {
    const line = lineCentre ?? null;
    if (line === headerCentre) return '';
    // Untagged while the header HAS a centre is a real per-line choice; untagged
    // when the header is also untagged is indistinguishable from inheriting.
    if (line === null) return headerCentre ? LINE_CENTRE_NONE : '';
    return String(line);
}

/**
 * Apply `resolveHydratedLineCentre` across a freshly-fetched document's lines.
 * Safe on documents saved before profit centres existed — those lines have no
 * `costCenterId` at all and collapse to "inherit".
 */
// The element type is deliberately NOT constrained to `{ costCenterId?: ... }`.
// Several document pages hydrate from an untyped (`any`) API payload; a
// constrained generic would infer T as the constraint itself and narrow the
// result to `{ costCenterId?: string | null }[]`, which then fails to satisfy
// the form's own line-item type.
export function hydrateLineCentres<T>(
    items: T[] | null | undefined,
    headerCentre: string | null | undefined,
): T[] {
    const header = headerCentre ?? null;
    return (items ?? []).map((item) => ({
        ...item,
        costCenterId: resolveHydratedLineCentre(
            (item as { costCenterId?: string | null } | null)?.costCenterId,
            header,
        ),
    }));
}
