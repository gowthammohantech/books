export interface EmailSettingsFormData {
    provider_type: string;
    userId: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    host: string;
    port: number | string;
    username: string;
    password: string;
    apiKey: string;
    smtp_status: boolean | string;
    node_status: boolean | string;
    resend_status: boolean | string;
}
