export interface StaffFormData {
    id?: string | number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    dateOfBirth: Date;
    password: string;
    confirmPassword: string;
    address: string;
    roleid: string;
    profileImage: File | null;
    profile_image_preview_url: string | null;
    profile_image_removed: boolean;
}

export interface StaffList {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string | null;
    roleid: string;
    roleName: string;
    profileImage: string;
    createdAt: string;
    /** Integer user type (1=Admin, 2=Vendor, 3=Staff, 4=Maintainer, 5=Supplier) */
    user_type?: number;
    /** Human-readable label derived from user_type */
    userTypeLabel?: string;
}