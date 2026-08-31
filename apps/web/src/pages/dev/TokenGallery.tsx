import { useState } from "react";
import { PlusIcon, TrashIcon, DownloadIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  RadioGroup,
  Select,
  Skeleton,
  SkeletonText,
  Switch,
  Tabs,
  type BadgeColor,
  type BadgeVariant,
  type ButtonSize,
  type ButtonVariant,
} from "@components/ui";

/**
 * Dev-only visual reference for the design system.
 *
 * The app has no component tests and no visual-regression tooling, and
 * Tailwind v4 does not error on an unknown utility — it silently emits
 * nothing. So a broken token migration shows up as a faded page, not a failed
 * build. This page puts every primitive, variant and token on one screen so a
 * migration stage can be checked by eye in seconds.
 *
 * Served at /_tokens in dev only, deliberately outside the auth and
 * setup-status gates so it renders with no backend running.
 */

const SECTION = "scroll-mt-4 space-y-3";
const H2 = "text-lg font-semibold text-foreground";
const H3 = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={SECTION}>
      <h2 className={H2}>{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="space-y-1">
      <div className={`h-12 rounded-md border border-border ${className}`} />
      <div className="font-mono text-[11px] leading-tight text-muted-foreground">{name}</div>
    </div>
  );
}

const BUTTON_VARIANTS: ButtonVariant[] = [
  "primary",
  "secondary",
  "outline",
  "soft",
  "white",
  "danger",
  "dangerOutline",
  "success",
  "warning",
  "ghost",
  "link",
];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
const BADGE_COLORS: BadgeColor[] = [
  "primary",
  "success",
  "danger",
  "warning",
  "info",
  "secondary",
  "indigo",
  "orange",
  "pink",
  "teal",
  "gray",
];
const BADGE_VARIANTS: BadgeVariant[] = ["soft", "solid", "outline"];

const SEMANTIC_TOKENS = [
  "bg-background",
  "bg-foreground",
  "bg-card",
  "bg-popover",
  "bg-primary",
  "bg-primary-foreground",
  "bg-secondary",
  "bg-muted",
  "bg-muted-foreground",
  "bg-accent",
  "bg-accent-foreground",
  "bg-destructive",
  "bg-border",
  "bg-input",
  "bg-ring",
];
const STATUS_TOKENS = [
  "bg-success",
  "bg-success-soft",
  "bg-warning",
  "bg-warning-soft",
  "bg-info",
  "bg-info-soft",
  "bg-destructive",
  "bg-destructive-soft",
];
const ACCENT_TOKENS = [
  "bg-indigo",
  "bg-orange",
  "bg-orange-soft",
  "bg-pink",
  "bg-pink-soft",
  "bg-teal",
  "bg-teal-soft",
];
const CHART_TOKENS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const SIDEBAR_TOKENS = [
  "bg-sidebar",
  "bg-sidebar-foreground",
  "bg-sidebar-primary",
  "bg-sidebar-accent",
  "bg-sidebar-border",
];
const GRAY_RAMP = [
  "bg-gray-50",
  "bg-gray-100",
  "bg-gray-200",
  "bg-gray-300",
  "bg-gray-400",
  "bg-gray-500",
  "bg-gray-600",
  "bg-gray-700",
  "bg-gray-800",
  "bg-gray-900",
  "bg-gray-950",
];
const RADII = ["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"];
const SHADOWS = [
  "shadow-2xs",
  "shadow-xs",
  "shadow-sm",
  "shadow",
  "shadow-md",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
];

export default function TokenGallery() {
  const [tab, setTab] = useState("underline-a");
  const [segTab, setSegTab] = useState("seg-a");
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("r1");
  const [on, setOn] = useState(true);

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Design tokens &amp; primitives</h1>
          <p className="text-sm text-muted-foreground">
            Dev-only reference. Every primitive, variant and token on one screen — used to
            eyeball each stage of the token migration.
          </p>
        </header>

        <Section title="Palette">
          <h3 className={H3}>Semantic</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {SEMANTIC_TOKENS.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
          <h3 className={H3}>Status (extension)</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {STATUS_TOKENS.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
          <h3 className={H3}>Accents</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {ACCENT_TOKENS.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
          <h3 className={H3}>Charts</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {CHART_TOKENS.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
          <h3 className={H3}>Sidebar</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {SIDEBAR_TOKENS.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
          <h3 className={H3}>Neutral ramp (extension)</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-11">
            {GRAY_RAMP.map((c) => (
              <Swatch key={c} name={c.replace("bg-", "")} className={c} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className="space-y-2 rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">font-sans — Geist Variable</p>
            <p className="text-3xl font-bold text-foreground">The quick brown fox — ₹1,23,456.78</p>
            <p className="text-xl font-semibold text-foreground">The quick brown fox jumps</p>
            <p className="text-base text-foreground">
              Body copy at base size. Invoice #INV-2026-0042 · Due 30 Sep 2026
            </p>
            <p className="text-sm text-muted-foreground">
              Small / muted — the app default for secondary text.
            </p>
            <p className="text-xs text-muted-foreground">Extra small — table meta, timestamps.</p>
            <p className="font-mono text-sm text-foreground">
              font-mono — Geist Mono · 0123456789 · IL1 O0
            </p>
          </div>
        </Section>

        <Section title="Radius &amp; shadow">
          <div className="flex flex-wrap gap-4">
            {RADII.map((r) => (
              <div key={r} className="space-y-1">
                <div
                  className={`flex h-16 w-24 items-center justify-center bg-primary text-primary-foreground ${r}`}
                >
                  <span className="font-mono text-[11px]">{r.replace("rounded-", "")}</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">{r}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-5 rounded-xl bg-muted p-5">
            {SHADOWS.map((s) => (
              <div key={s} className="space-y-1">
                <div className={`h-16 w-24 rounded-lg bg-card ${s}`} />
                <div className="font-mono text-[11px] text-muted-foreground">{s}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Button">
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            {BUTTON_VARIANTS.map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-3">
                <span className="w-28 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {v}
                </span>
                {BUTTON_SIZES.map((s) => (
                  <Button key={s} variant={v} size={s}>
                    {s.toUpperCase()}
                  </Button>
                ))}
                <Button variant={v} leftIcon={<PlusIcon size={14} />}>
                  With icon
                </Button>
                <Button variant={v} isLoading>
                  Loading
                </Button>
                <Button variant={v} disabled>
                  Disabled
                </Button>
                <Button variant={v} size="icon" aria-label={`${v} icon action`}>
                  <TrashIcon size={15} />
                </Button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Badge">
          <div className="overflow-x-auto rounded-xl border border-border bg-card p-5">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase text-muted-foreground">
                    color
                  </th>
                  {BADGE_VARIANTS.map((v) => (
                    <th
                      key={v}
                      className="p-2 text-left text-xs font-semibold uppercase text-muted-foreground"
                    >
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BADGE_COLORS.map((c) => (
                  <tr key={c} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono text-[11px] text-muted-foreground">{c}</td>
                    {BADGE_VARIANTS.map((v) => (
                      <td key={v} className="p-2">
                        <Badge color={c} variant={v}>
                          {c}
                        </Badge>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid gap-5 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
            <FormField label="Customer name" placeholder="Acme Pvt Ltd" required />
            <FormField
              label="Email"
              placeholder="billing@acme.com"
              error="Enter a valid email address"
            />
            <FormField
              label="GSTIN"
              placeholder="29ABCDE1234F1Z5"
              helper="15 characters, state code first."
            />
            <FormField label="Locked field" placeholder="Read only" disabled />
            <Select
              label="Payment terms"
              placeholder="Select terms"
              options={[
                { value: "net15", label: "Net 15" },
                { value: "net30", label: "Net 30" },
                { value: "net60", label: "Net 60 (disabled)", disabled: true },
              ]}
            />
            <Select
              label="Tax regime"
              error="Required"
              placeholder="Select regime"
              options={[
                { value: "reg", label: "Regular" },
                { value: "comp", label: "Composition" },
              ]}
            />
            <div className="space-y-3">
              <Checkbox
                label="Send a copy to the customer"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Checkbox label="Disabled checkbox" checked={false} disabled onChange={() => {}} />
              <Switch checked={on} onChange={setOn} label="Recurring invoice" />
              <Switch checked={false} onChange={() => {}} label="Disabled switch" disabled />
            </div>
            <RadioGroup
              name="gallery-radio"
              value={radio}
              onChange={setRadio}
              options={[
                { value: "r1", label: "Cash" },
                { value: "r2", label: "Bank transfer" },
                { value: "r3", label: "UPI (disabled)", disabled: true },
              ]}
            />
          </div>
        </Section>

        <Section title="Card, Tabs, Skeleton">
          <div className="grid gap-5 md:grid-cols-2">
            <Card
              title="Outstanding"
              actions={
                <Button variant="link" size="sm" rightIcon={<DownloadIcon size={13} />}>
                  Export
                </Button>
              }
              footer={<span className="text-xs text-muted-foreground">Updated just now</span>}
            >
              <p className="text-2xl font-bold text-foreground">₹4,82,300.00</p>
              <p className="text-sm text-muted-foreground">Across 18 unpaid invoices</p>
            </Card>

            <Card title="Loading state">
              <SkeletonText lines={3} />
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            </Card>

            <Card title="Tabs — underline">
              <Tabs
                variant="underline"
                value={tab}
                onChange={setTab}
                tabs={[
                  { key: "underline-a", label: "Details" },
                  { key: "underline-b", label: "Line items" },
                  { key: "underline-c", label: "History" },
                  { key: "underline-d", label: "Disabled", disabled: true },
                ]}
              />
              <p className="mt-3 text-sm text-muted-foreground">Active: {tab}</p>
            </Card>

            <Card title="Tabs — segmented">
              <Tabs
                variant="segmented"
                value={segTab}
                onChange={setSegTab}
                tabs={[
                  { key: "seg-a", label: "Month" },
                  { key: "seg-b", label: "Quarter" },
                  { key: "seg-c", label: "Year" },
                ]}
              />
              <p className="mt-3 text-sm text-muted-foreground">Active: {segTab}</p>
            </Card>
          </div>
        </Section>

        <Section title="Table">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-xs uppercase text-muted-foreground">
                  <th className="border-b border-border px-4 py-3 text-left">Invoice</th>
                  <th className="border-b border-border px-4 py-3 text-left">Customer</th>
                  <th className="border-b border-border px-4 py-3 text-left">Status</th>
                  <th className="border-b border-border px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["INV-0041", "Acme Pvt Ltd", "success", "Paid", "₹1,20,000.00"],
                  ["INV-0042", "Globex Traders", "warning", "Partial", "₹64,500.00"],
                  ["INV-0043", "Initech LLP", "danger", "Overdue", "₹2,10,800.00"],
                  ["INV-0044", "Umbrella Co", "gray", "Draft", "₹87,000.00"],
                ].map(([id, cust, color, status, amt]) => (
                  <tr key={id} className="border-b border-border last:border-0 hover:bg-muted">
                    <td className="px-4 py-3 font-medium text-foreground">{id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cust}</td>
                    <td className="px-4 py-3">
                      <Badge color={color as BadgeColor}>{status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">{amt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
