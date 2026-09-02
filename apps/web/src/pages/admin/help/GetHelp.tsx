import { useMemo } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
    BookOpen,
    Code2,
    ExternalLink,
    LifeBuoy,
    Mail,
    Phone,
    Smartphone,
} from "lucide-react";

import Constants from "@constants/api";
import type { RootState } from "@store/index";
import { Card } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

/** Pages people most often land on after asking "where do I change X?". */
const COMMON_TASKS: Array<{ to: string; label: string }> = [
    { to: "/settings/company-settings", label: "Company details, logo & tax numbers" },
    { to: "/settings/email-settings", label: "Outgoing email (SMTP) setup" },
    { to: "/settings/document-defaults", label: "Invoice & document defaults" },
    { to: "/users", label: "Invite or deactivate users" },
    { to: "/roles", label: "Roles & permissions" },
];

/**
 * Get Help — where the sidebar footer sends someone who is stuck: product
 * documentation, the API reference, and how to reach whoever runs this
 * installation.
 */
const GetHelp = () => {
    const { user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );

    const company = systemSettings?.company;
    const companyName = company?.companyName?.trim();
    const supportEmail = company?.email?.trim();
    const supportPhone = company?.phone?.trim();

    // Swagger UI is served by the API, not the SPA — point at the API origin.
    const apiDocsUrl = `${(Constants.BASE_URL || "").replace(/\/$/, "")}/api/docs`;

    // Pre-fill the details a support reply would otherwise have to ask for.
    const mailtoHref = useMemo(() => {
        if (!supportEmail) return null;
        const subject = `Elixir Books support${companyName ? ` — ${companyName}` : ""}`;
        const body = [
            "What I was trying to do:",
            "",
            "",
            "What happened instead:",
            "",
            "",
            "--- details for support ---",
            `Company: ${companyName || "-"}`,
            `Signed in as: ${user?.email || "-"}`,
            `App: ${window.location.origin}`,
            `Browser: ${navigator.userAgent}`,
        ].join("\n");
        return `mailto:${supportEmail}?subject=${encodeURIComponent(
            subject
        )}&body=${encodeURIComponent(body)}`;
    }, [supportEmail, companyName, user?.email]);

    const resources = [
        {
            key: "guide",
            icon: <BookOpen size={20} className="text-primary" />,
            title: "User guide",
            note: "Step-by-step walkthroughs for invoicing, purchases, banking and reports.",
            href: "/documentation",
        },
        {
            key: "mobile",
            icon: <Smartphone size={20} className="text-primary" />,
            title: "Mobile guide",
            note: "Using Elixir Books from a phone or tablet.",
            href: "/documentation/mobile",
        },
        {
            key: "api",
            icon: <Code2 size={20} className="text-primary" />,
            title: "API reference",
            note: "Interactive Swagger docs for every endpoint, for integrations and scripts.",
            href: apiDocsUrl,
        },
    ];

    return (
        <div className="p-6">
            <PageHeader title="Get Help" />
            <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
                Documentation, the API reference, and how to reach the people who run
                this Elixir Books installation.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {resources.map((r) => (
                    <Card key={r.key}>
                        <a
                            href={r.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group block"
                        >
                            <div className="flex items-center gap-2 mb-2">
                                {r.icon}
                                <h2 className="text-base font-semibold text-foreground group-hover:text-primary">
                                    {r.title}
                                </h2>
                                <ExternalLink
                                    size={14}
                                    className="text-gray-400 shrink-0"
                                    aria-hidden="true"
                                />
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{r.note}</p>
                        </a>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Contact support">
                    {supportEmail || supportPhone ? (
                        <>
                            <p className="text-sm text-muted-foreground mb-4">
                                Questions about your data or account go to the administrator
                                for {companyName || "your organisation"}.
                            </p>
                            <ul className="space-y-3">
                                {supportEmail && (
                                    <li className="flex items-center gap-2 text-sm">
                                        <Mail size={16} className="text-muted-foreground shrink-0" />
                                        <a
                                            href={`mailto:${supportEmail}`}
                                            className="text-primary underline break-all"
                                        >
                                            {supportEmail}
                                        </a>
                                    </li>
                                )}
                                {supportPhone && (
                                    <li className="flex items-center gap-2 text-sm">
                                        <Phone size={16} className="text-muted-foreground shrink-0" />
                                        <a
                                            href={`tel:${supportPhone.replace(/\s+/g, "")}`}
                                            className="text-primary underline"
                                        >
                                            {supportPhone}
                                        </a>
                                    </li>
                                )}
                            </ul>
                            {mailtoHref && (
                                <>
                                    <a
                                        href={mailtoHref}
                                        className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
                                    >
                                        <LifeBuoy size={16} />
                                        Report a problem
                                    </a>
                                    <p className="text-xs text-muted-foreground mt-3">
                                        Opens your mail client with the account and browser
                                        details support usually has to ask for already filled
                                        in.
                                    </p>
                                </>
                            )}
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            No support contact has been set yet. Add an email address and
                            phone number under{" "}
                            <Link
                                to="/settings/company-settings"
                                className="text-primary underline"
                            >
                                Company Settings
                            </Link>{" "}
                            and they will show up here for everyone.
                        </p>
                    )}
                </Card>

                <Card title="Common tasks">
                    <ul className="space-y-2">
                        {COMMON_TASKS.map((t) => (
                            <li key={t.to}>
                                <Link
                                    to={t.to}
                                    className="text-sm text-primary hover:underline"
                                >
                                    {t.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>
            </div>
        </div>
    );
};

export default GetHelp;
