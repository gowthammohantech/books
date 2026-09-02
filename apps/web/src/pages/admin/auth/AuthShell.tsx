import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";

/**
 * The frame around /signup and /signin.
 *
 * Both pages were centred cards on a grey field, which said nothing about what
 * the product is — a problem for the signup half in particular, since it is the
 * first page a prospective customer sees and it was asking for a password
 * before saying what for. The left panel carries that pitch; the right is the
 * form, unchanged in behaviour.
 *
 * The two are one component rather than two similar ones because the tab pair
 * has to look identical on both routes: the whole point of a tab is that the
 * thing behind it is a sibling, and two copies drifting apart would break that
 * illusion at exactly the moment someone is deciding whether to trust the app.
 *
 * The tabs navigate rather than swap local state — /signin and /signup are real
 * routes with their own guards, titles and back-button behaviour, and
 * collapsing them into one route with a toggle would lose all three.
 */

const VALUE_PROPS = [
    "Purchase, sales, inventory, accounts & GST in one flow",
    "Multi-company, multi-branch, multi-warehouse",
    "An agent that drafts, files and reconciles for you",
];

interface AuthShellProps {
    /** Which tab reads as current. */
    active: "signup" | "signin";
    heading: string;
    subheading: string;
    children: ReactNode;
    /** Rendered under the form: the terms line, demo credentials, and so on. */
    footer?: ReactNode;
    /** Widens the right column for the multi-column signup form. */
    wide?: boolean;
}

const TABS = [
    { key: "signup", label: "Create account", to: "/signup" },
    { key: "signin", label: "Sign in", to: "/signin" },
] as const;

const AuthShell = ({
    active,
    heading,
    subheading,
    children,
    footer,
    wide = false,
}: AuthShellProps) => (
    <div className="flex min-h-screen flex-col lg:flex-row">
        {/* The pitch. Hidden below lg — on a phone it would push the form
            itself below the fold, and someone who came here to sign in has
            already been sold. */}
        <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex lg:w-1/2">
            <span className="flex items-center gap-2.5">
                <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground text-primary text-xs font-bold"
                >
                    EB
                </span>
                <span className="font-semibold">Elixir Book</span>
            </span>

            <div className="max-w-md">
                <h1 className="text-4xl font-bold leading-tight">
                    One system for procurement, sales, stock and the books.
                </h1>
                <p className="mt-5 text-primary-foreground/80">
                    GST-compliant ERP for Indian businesses — with an agent that drafts
                    documents, works your queues and reconciles alongside you.
                </p>
                <ul className="mt-8 space-y-3">
                    {VALUE_PROPS.map((prop) => (
                        <li key={prop} className="flex items-start gap-3">
                            <span
                                aria-hidden="true"
                                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary"
                            >
                                <Check size={12} strokeWidth={3} />
                            </span>
                            <span className="text-sm text-primary-foreground/90">{prop}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <p className="text-xs text-primary-foreground/70">
                GSTN-ready · MCA audit trail
            </p>
        </div>

        <div className="flex flex-1 items-center justify-center bg-background px-6 py-10">
            <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
                <div
                    className="mb-8 inline-flex rounded-lg bg-muted p-1"
                    role="tablist"
                    aria-label="Account access"
                >
                    {TABS.map((tab) => (
                        <Link
                            key={tab.key}
                            to={tab.to}
                            role="tab"
                            aria-selected={active === tab.key}
                            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${active === tab.key
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            {tab.label}
                        </Link>
                    ))}
                </div>

                <h2 className="text-3xl font-bold text-foreground">{heading}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{subheading}</p>

                <div className="mt-6">{children}</div>

                {footer && <div className="mt-6">{footer}</div>}
            </div>
        </div>
    </div>
);

export default AuthShell;
