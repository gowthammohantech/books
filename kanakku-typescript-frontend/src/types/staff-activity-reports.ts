export interface StaffActivityRowShape {
    userId: string;
    userName: string;
    invoicesCreated: number;
    invoicesUpdated: number;
    invoicesDeleted: number;
    totalValueCreated: number;
}

export interface StaffActivityTotalsShape {
    invoicesCreated: number;
    invoicesUpdated: number;
    invoicesDeleted: number;
    totalValueCreated: number;
}
