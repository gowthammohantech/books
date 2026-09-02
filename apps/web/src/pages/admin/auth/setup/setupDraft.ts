import { currentTenantId, tenantSession } from "@utils/tenantStorage";
import type { SetupFormData } from "@models/setup";

/**
 * The wizard's in-progress answers, so a refresh mid-setup does not start over.
 *
 * WHY CLIENT-SIDE AND NOT PER-STEP ON THE SERVER. The /setup gate is
 * `companySettingsComplete`, which is true as soon as the workspace has a named
 * company. Committing step 1 or 2 to the server would therefore lift the gate
 * halfway through, and AppRoutes would stop redirecting to /setup — leaving the
 * user loose in an app whose modules and regional settings were never chosen.
 * One terminal commit keeps "configured" and "let in" the same event.
 *
 * SESSION storage, not local: an abandoned draft should not outlive the tab. It
 * is namespaced per workspace by `tenantSession`, because someone setting up
 * their second company must not be shown the first one's half-finished answers.
 */
const DRAFT_KEY = "setupDraft";

/** Bump when SetupFormData changes shape, to discard drafts of the old one. */
const DRAFT_VERSION = 1;

interface StoredDraft {
    version: number;
    step: number;
    data: SetupFormData;
}

export interface RestoredDraft {
    step: number;
    data: SetupFormData;
}

export function loadDraft(): RestoredDraft | null {
    const tenantId = currentTenantId();
    if (!tenantId) return null;

    const stored = tenantSession.getJson<StoredDraft>(tenantId, DRAFT_KEY);
    // A draft written by an older build describes a form this one no longer
    // has. Dropping it costs a few re-typed fields; restoring it would put
    // undefined into required inputs and fail validation with no visible cause.
    if (!stored || stored.version !== DRAFT_VERSION || !stored.data) return null;

    return { step: stored.step ?? 0, data: stored.data };
}

export function saveDraft(step: number, data: SetupFormData): void {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    tenantSession.setJson(tenantId, DRAFT_KEY, {
        version: DRAFT_VERSION,
        step,
        data,
    } satisfies StoredDraft);
}

/** Called once setup commits — the answers are the workspace's now. */
export function clearDraft(): void {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    tenantSession.remove(tenantId, DRAFT_KEY);
}
