import axios from "axios";

/**
 * Resolves a customer-facing public share URL for an invoice or quotation,
 * enabling the public link server-side if it isn't already. Mirrors the
 * auto-provisioning done by the email-template resolver (RESOLVE_EMAIL_TEMPLATE_URL)
 * and EditInvoice.tsx's "PUBLIC LINK" handlers, so fallback/reminder email bodies
 * never fall back to an admin-app URL that 404s/login-walls external recipients.
 *
 * Returns `null` when a tokened URL cannot be produced (e.g. the enable-link
 * call fails) — callers MUST treat that as a hard failure and never fall back
 * to a token-less/admin URL in a customer-facing email body.
 */
export async function resolvePublicDocumentLink(opts: {
    /** Base admin API URL for the document type, e.g. `${API_BASE_URL}/admin/invoices`. */
    adminBaseUrl: string;
    /** Public route segment, e.g. "invoice" or "quotation" (matches `/[segment]/:token`). */
    routeSegment: "invoice" | "quotation";
    documentId: string;
    authToken: string | null | undefined;
    /** Tenant's configured public base URL (CompanySettings.publicBaseUrl), if any. */
    publicBaseUrl?: string | null;
    /** Already-known token, if the caller has one, to avoid a redundant enable call. */
    existingToken?: string | null;
    existingEnabled?: boolean;
}): Promise<string | null> {
    const base = (opts.publicBaseUrl?.replace(/\/$/, "")) || window.location.origin;

    let publicToken = opts.existingEnabled ? opts.existingToken ?? null : null;
    if (!publicToken) {
        try {
            const res = await axios.post(
                `${opts.adminBaseUrl}/${opts.documentId}/enable-public-link`,
                {},
                { headers: { Authorization: `Bearer ${opts.authToken}` } },
            );
            publicToken = res.data?.data?.publicViewToken ?? null;
        } catch (error) {
            console.error("Failed to enable public link:", error);
        }
    }

    return publicToken ? `${base}/${opts.routeSegment}/${publicToken}` : null;
}
