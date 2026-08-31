export interface RegisterFormData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    /** Names the WORKSPACE this signup creates — Tenant.name, and the source
     *  of its slug. Signup provisions a company, not just a login. */
    companyName: string;
}