
import api from '@lib/apiClient';
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import Constants from "@constants/api";
import { canView } from "@lib/navigation";
import type { RootState } from "@store/index";

export type EntityType = "invoice" | "contact" | "product";

export interface EntityResult {
    /** Namespaced so an invoice and a contact can never collide on raw id. */
    id: string;
    type: EntityType;
    title: string;
    subtitle: string;
    path: string;
}

/** Below this the results are noise and every keystroke costs three requests. */
const MIN_QUERY_LENGTH = 2;
const PER_TYPE_LIMIT = 5;

const ENTITY_LABELS: Record<EntityType, string> = {
    invoice: "Invoices",
    contact: "Parties",
    product: "Items"
};

export const entityLabel = (type: EntityType) => ENTITY_LABELS[type];

/**
 * The slice of each list response the palette actually reads. Deliberately
 * narrower than the full API types: a palette row is a title, a subtitle and a
 * link, and pinning it to the whole Invoice/Product shape would break this hook
 * every time an unrelated field on those moved.
 */
interface InvoiceRow {
    id: string;
    invoiceNumber?: string | null;
    status?: string | null;
    customer?: { name?: string | null } | null;
}

interface ContactRow {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    organisation?: string | null;
    email?: string | null;
    mobile?: string | null;
}

interface ProductRow {
    id: string;
    name?: string | null;
    code?: string | null;
    item_type?: string | null;
}

const contactName = (contact: {
    firstName?: string | null;
    lastName?: string | null;
    organisation?: string | null;
    id: string;
}) => {
    const person = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
    return person || contact.organisation || contact.id;
};

/**
 * Live records matching the palette query — invoices by number or customer,
 * contacts by name, items by name or code.
 *
 * Each source is gated by the same permission slug its sidebar entry uses, so
 * a user who cannot see Invoices never fires the invoice request. Sources fail
 * independently: one endpoint erroring drops that section, it does not blank
 * the others.
 */
export const useEntitySearch = (query: string) => {
    const { token, user } = useSelector((state: RootState) => state.auth);
    const permissions = useSelector(
        (state: RootState) => state.systemSettings.data?.permissions
    );
    const [results, setResults] = useState<EntityResult[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (!token || trimmed.length < MIN_QUERY_LENGTH) {
            setResults([]);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const perms = permissions ?? [];
        const headers = {};
        const common = { signal: controller.signal, headers };

        const fetchInvoices = async (): Promise<EntityResult[]> => {
            if (!canView("invoices", perms)) return [];
            const res = await api.get(Constants.GET_INVOICES_FOR_LIST_URL, {
                ...common,
                params: { search: trimmed, page: 1, limit: PER_TYPE_LIMIT }
            });
            const invoices: InvoiceRow[] = res.data?.data?.invoices ?? [];
            return invoices.map((invoice) => ({
                id: `invoice:${invoice.id}`,
                type: "invoice" as const,
                title: invoice.invoiceNumber ?? "Invoice",
                subtitle: [invoice.customer?.name, invoice.status]
                    .filter(Boolean)
                    .join(" · "),
                path: `/view-invoice/${invoice.id}`
            }));
        };

        const fetchContacts = async (): Promise<EntityResult[]> => {
            if (!canView("contacts", perms)) return [];
            const res = await api.get(`${Constants.API_BASE_URL}/admin/contacts`, {
                ...common,
                params: { view: "all-active", q: trimmed, pageSize: PER_TYPE_LIMIT }
            });
            const contacts: ContactRow[] = res.data?.data ?? [];
            return contacts.map((contact) => ({
                id: `contact:${contact.id}`,
                type: "contact" as const,
                title: contactName(contact),
                subtitle: [contact.email, contact.mobile].filter(Boolean).join(" · "),
                path: `/contacts/${contact.id}`
            }));
        };

        const fetchProducts = async (): Promise<EntityResult[]> => {
            if (!canView("product-services", perms)) return [];
            const res = await api.get(Constants.FETCH_PRODUCTS_URL, {
                ...common,
                params: { search: trimmed, page: 1, limit: PER_TYPE_LIMIT }
            });
            const products: ProductRow[] = res.data?.data?.products ?? [];
            return products.map((product) => ({
                id: `product:${product.id}`,
                type: "product" as const,
                title: product.name ?? "Item",
                subtitle: [product.code, product.item_type].filter(Boolean).join(" · "),
                path: `/products/view/${product.id}`
            }));
        };

        setLoading(true);
        Promise.all(
            [fetchInvoices, fetchContacts, fetchProducts].map((fetcher) =>
                fetcher().catch(() => [] as EntityResult[])
            )
        )
            .then((groups) => {
                if (controller.signal.aborted) return;
                setResults(groups.flat());
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [query, token, user, permissions]);

    return { results, loading };
};
