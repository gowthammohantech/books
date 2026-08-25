export type ThermalDocType = 'INVOICE' | 'QUOTATION' | 'PURCHASE' | 'PURCHASE_ORDER' | 'CHALLAN' | 'DEBIT_NOTE' | 'CREDIT_NOTE';

export interface ThermalDoc {
    title: string;
    number: string;
    dateLabel: string;
    party: {
        name: string;
        address?: string;
        gstin?: string;
    };
    items: {
        name: string;
        qty: number;
        rate: number;
        amount: number;
    }[];
    currencyCode: string;
    subtotal: number;
    taxLines: {
        label: string;
        amount: number;
    }[];
    total: number;
    notes?: string;
}

type TaxLineRow = { kind: string | null; percent: number; name?: string; amount: number };

function buildTaxLines(
    items: { taxes?: unknown }[],
    fallbackTotalTax: number,
): ThermalDoc['taxLines'] {
    const breakdown: Record<string, number> = {};
    for (const line of items) {
        const rawTaxes = line.taxes;
        const taxes: TaxLineRow[] = Array.isArray(rawTaxes) ? (rawTaxes as TaxLineRow[]) : [];
        for (const t of taxes) {
            const key = t.kind ? `${t.kind} ${t.percent}%` : (t.name ?? 'Tax');
            breakdown[key] = (breakdown[key] ?? 0) + Number(t.amount ?? 0);
        }
    }
    const entries = Object.entries(breakdown);
    if (entries.length === 0) {
        return [{ label: 'Tax', amount: fallbackTotalTax }];
    }
    return entries.map(([label, amount]) => ({ label, amount }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptDocument(docType: ThermalDocType, data: any): ThermalDoc {
    // Total: invoice/quotation use TotalAmount (PascalCase); purchase uses totalAmount (camelCase)
    const total: number = Number(data.TotalAmount ?? data.totalAmount ?? 0);
    const currencyCode: string = data.currencyCode ?? '';

    // Tax fallback for invoice/quotation: vat field; for purchase: totalTax
    const fallbackTax: number = Number(data.vat ?? data.totalTax ?? 0);

    // Items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems: any[] = Array.isArray(data.items) ? data.items : [];

    const items: ThermalDoc['items'] = rawItems.map((item) => ({
        // purchase items have item.product.name; invoice/quotation have item.name or item.productName
        name: item.name ?? item.productName ?? item.product?.name ?? '',
        qty: Number(item.qty ?? 0),
        rate: Number(item.rate ?? 0),
        amount: Number(item.amount ?? item.lineTotal ?? 0),
    }));

    const subtotal: number =
        items.length > 0
            ? items.reduce((sum, i) => sum + i.amount, 0)
            : Number(data.taxableAmount ?? 0);

    const taxLines = buildTaxLines(rawItems, fallbackTax);

    const notes: string | undefined = data.notes ?? undefined;

    switch (docType) {
        case 'INVOICE': {
            const party = data.billTo ?? {};
            const addr = party.billingAddress;
            const addrStr = [
                addr?.addressLine1,
                addr?.city,
                addr?.state,
                addr?.country,
            ]
                .filter(Boolean)
                .join(', ');
            return {
                title: 'TAX INVOICE',
                number: data.invoiceNumber ?? '',
                dateLabel: data.invoiceDate ?? '',
                party: {
                    name: party.name ?? '',
                    address: addrStr || party.address || undefined,
                    gstin: party.gstin ?? undefined,
                },
                items,
                currencyCode,
                subtotal,
                taxLines,
                total,
                notes,
            };
        }

        case 'QUOTATION': {
            const party = data.billTo ?? {};
            const addr = party.billingAddress;
            const addrStr = [
                addr?.addressLine1,
                addr?.city,
                addr?.state,
                addr?.country,
            ]
                .filter(Boolean)
                .join(', ');
            return {
                title: 'QUOTATION',
                number: data.quotationId ?? '',
                dateLabel: data.quotationDate ?? '',
                party: {
                    name: party.name ?? '',
                    address: addrStr || party.address || undefined,
                    gstin: party.gstin ?? undefined,
                },
                items,
                currencyCode,
                subtotal,
                taxLines,
                total,
                notes,
            };
        }

        case 'PURCHASE': {
            // Purchase: party is the supplier (billTo in PurchaseShape — the vendor the company buys from)
            const party = data.billTo ?? {};
            return {
                title: 'PURCHASE',
                number: data.purchaseId ?? '',
                dateLabel: data.purchaseDate ?? data.createdAt ?? '',
                party: {
                    name: party.name ?? '',
                    address: party.address ?? undefined,
                    gstin: party.gstin ?? undefined,
                },
                items,
                currencyCode,
                subtotal,
                taxLines,
                total,
                notes,
            };
        }

        case 'PURCHASE_ORDER': {
            // Purchase Order: party is the supplier (billTo — the vendor the company buys from)
            const party = data.billTo ?? {};
            return {
                title: 'PURCHASE ORDER',
                number: data.purchaseOrderId ?? '',
                dateLabel: data.purchaseOrderDate ?? data.createdAt ?? '',
                party: {
                    name: party.name ?? '',
                    address: party.address ?? undefined,
                    gstin: party.gstin ?? undefined,
                },
                items,
                currencyCode,
                subtotal,
                taxLines,
                total,
                notes,
            };
        }

        case 'CHALLAN': {
            // Delivery Challan: DeliveryChannalDetail shape
            // number: challanNumber, date: challanDate
            // party: billTo.name + billTo.billingAddress (nested object, no gstin field)
            // items: { name, qty, rate, amount } — direct fields (no product wrapper)
            // totals: taxableAmount (subtotal), vat (tax), totalAmount
            const challanBillTo = data.billTo ?? {};
            const challanAddr = challanBillTo.billingAddress;
            const challanAddrStr = challanAddr
                ? [challanAddr.addressLine1, challanAddr.city, challanAddr.state, challanAddr.country]
                      .filter(Boolean)
                      .join(', ')
                : challanBillTo.address ?? '';
            // Challan items use direct name/qty/rate/amount fields
            const challanItems: ThermalDoc['items'] = (Array.isArray(data.items) ? data.items : []).map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (item: any) => ({
                    name: item.name ?? item.productName ?? item.product?.name ?? '',
                    qty: Number(item.qty ?? item.quantity ?? 0),
                    rate: Number(item.rate ?? 0),
                    amount: Number(item.amount ?? item.lineTotal ?? 0),
                }),
            );
            const challanSubtotal =
                challanItems.length > 0
                    ? challanItems.reduce((sum, i) => sum + i.amount, 0)
                    : Number(data.taxableAmount ?? 0);
            // Challan uses `vat` for tax; totalAmount for grand total
            const challanTotal = Number(data.totalAmount ?? data.TotalAmount ?? 0);
            const challanTax = Number(data.vat ?? data.totalTax ?? 0);
            // Only emit a tax line if there is a non-zero tax value
            const challanTaxLines: ThermalDoc['taxLines'] =
                challanTax !== 0 ? [{ label: 'Tax', amount: challanTax }] : [];
            return {
                title: 'DELIVERY CHALLAN',
                number: data.challanNumber ?? data.id ?? '',
                dateLabel: data.challanDate ?? data.createdAt ?? '',
                party: {
                    name: challanBillTo.name ?? '',
                    address: challanAddrStr || undefined,
                    gstin: challanBillTo.gstin ?? undefined,
                },
                items: challanItems,
                currencyCode: data.currencyCode ?? '',
                subtotal: challanSubtotal,
                taxLines: challanTaxLines,
                total: challanTotal,
                notes: data.notes ?? undefined,
            };
        }

        case 'DEBIT_NOTE': {
            // Debit Note: DebitNoteDetail shape
            // number: debitNoteId, date: debitNoteDate
            // party: vendor (not billTo) — vendor.name + vendor.address (flat string)
            // items: { product: { name }, quantity (not qty), rate, amount }
            // totals: taxableAmount, totalTax, totalAmount
            const vendor = data.vendor ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const debitItems: ThermalDoc['items'] = (Array.isArray(data.items) ? data.items : []).map((item: any) => ({
                name: item.product?.name ?? item.name ?? item.productName ?? '',
                qty: Number(item.quantity ?? item.qty ?? 0),
                rate: Number(item.rate ?? 0),
                amount: Number(item.amount ?? item.lineTotal ?? 0),
            }));
            const debitSubtotal =
                debitItems.length > 0
                    ? debitItems.reduce((sum, i) => sum + i.amount, 0)
                    : Number(data.taxableAmount ?? 0);
            const debitTotal = Number(data.totalAmount ?? data.TotalAmount ?? 0);
            const debitTax = Number(data.totalTax ?? data.vat ?? 0);
            const debitTaxLines: ThermalDoc['taxLines'] =
                debitTax !== 0 ? [{ label: 'Tax', amount: debitTax }] : [];
            return {
                title: 'DEBIT NOTE',
                number: data.debitNoteId ?? data.id ?? '',
                dateLabel: data.debitNoteDate ?? data.createdAt ?? '',
                party: {
                    name: vendor.name ?? '',
                    address: vendor.address ?? undefined,
                    gstin: vendor.gstin ?? undefined,
                },
                items: debitItems,
                currencyCode: data.currencyCode ?? '',
                subtotal: debitSubtotal,
                taxLines: debitTaxLines,
                total: debitTotal,
                notes: data.notes ?? undefined,
            };
        }

        case 'CREDIT_NOTE': {
            // Credit Note: shares the invoice shape
            // number: creditNoteNumber, date: creditNoteDate
            // party: billTo (customer) — billTo.name + billTo.billingAddress (nested) or flat address
            // items: { name, qty, rate, amount }
            // totals: taxableAmount (subtotal), vat (tax), totalAmount
            const creditParty = data.billTo ?? {};
            const creditAddr = creditParty.billingAddress;
            const creditAddrStr = creditAddr
                ? [creditAddr.addressLine1, creditAddr.city, creditAddr.state, creditAddr.country]
                      .filter(Boolean)
                      .join(', ')
                : creditParty.address ?? '';
            const creditTotal = Number(data.totalAmount ?? data.TotalAmount ?? 0);
            const creditTax = Number(data.vat ?? data.totalTax ?? 0);
            const creditTaxLines: ThermalDoc['taxLines'] =
                creditTax !== 0 ? [{ label: 'Tax', amount: creditTax }] : [];
            return {
                title: 'CREDIT NOTE',
                number: data.creditNoteNumber ?? data.id ?? '',
                dateLabel: data.creditNoteDate ?? data.createdAt ?? '',
                party: {
                    name: creditParty.name ?? '',
                    address: creditAddrStr || undefined,
                    gstin: creditParty.gstin ?? undefined,
                },
                items,
                currencyCode,
                subtotal,
                taxLines: creditTaxLines,
                total: creditTotal,
                notes,
            };
        }
    }
}
