export interface Customer {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: string;
    image: string | null;
    currencyCode?: string | null;
    billingAddress: {
        name: string;
        addressLine1: string;
        addressLine2: string;
        city: string;
        state: string;
        country: string;
        pincode: string;
    };
    shippingAddress: {
        name: string;
        addressLine1: string;
        addressLine2: string;
        city: string;
        state: string;
        country: string;
        pincode: string;
    };
}