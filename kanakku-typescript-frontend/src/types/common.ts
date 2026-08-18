export interface OptionType {
    id: string;
    name: string;
}

export interface SelectedAdmin {
    companyName: string;
    email: string;
    phone: string;
    address: string;
    city?: { id: string; name: string; };
    state?: { id: string; name: string; };
    country?: { id: string; name: string; };
    pincode: string;
    siteLogo: string;
    logoUrl?: string;
    favicon: File | null;
    companyLogo: string;
    fax: string;
    userId: string | null;
}

export interface SelectedSupplier {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    profileImage: string;
}

export interface Pagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface PaymentMode {
    id: string;
    name: string;
    slug: string;
}
