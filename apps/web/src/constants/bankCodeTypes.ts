// Regional bank-code formats. The code value itself is stored in the existing
// `IFSCCode` field; this only drives the label / placeholder / guidance shown to
// the user. Kept lenient + country-agnostic (whitelabel) — no hard format reject.
export interface BankCodeType {
    id: string;
    label: string;
    placeholder: string;
}

export const BANK_CODE_TYPES: BankCodeType[] = [
    { id: "IFSC", label: "IFSC Code", placeholder: "e.g. HDFC0001234" },
    { id: "SORT_CODE", label: "Sort Code (UK)", placeholder: "e.g. 12-34-56" },
    { id: "ROUTING", label: "Routing Number / ABA (US)", placeholder: "e.g. 021000021" },
    { id: "IBAN", label: "IBAN (Europe / Middle East)", placeholder: "e.g. DE89 3704 0044 0532 0130 00" },
    { id: "SWIFT", label: "SWIFT / BIC", placeholder: "e.g. DEUTDEFF500" },
    { id: "BSB", label: "BSB (Australia)", placeholder: "e.g. 062-000" },
    { id: "OTHER", label: "Bank Code", placeholder: "Enter bank code" },
];

// Default to IFSC for legacy rows (existing data is India-format) when type is null.
export const getBankCodeType = (id?: string | null): BankCodeType =>
    BANK_CODE_TYPES.find((t) => t.id === id) ?? BANK_CODE_TYPES[0];
