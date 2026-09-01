import { NavLink } from 'react-router-dom';

const DASHBOARDS = [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/dashboard/sales', label: 'Sales & Invoices' },
    { to: '/admin/dashboard/accounts', label: 'Accounts & P&L' },
    { to: '/admin/dashboard/expenses', label: 'Expenses' },
] as const;

/**
 * Quick switcher between the 4 dashboard views, rendered in the top-bar
 * (via PageHeader's action slot) on every dashboard page — so switching
 * views doesn't require going back to the left sidebar menu.
 */
const DashboardSwitcher = () => (
    <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-1">
        {DASHBOARDS.map((d) => (
            <NavLink
                key={d.to}
                to={d.to}
                end={'end' in d ? d.end : false}
                className={({ isActive }) =>
                    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        isActive
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:bg-white hover:text-foreground'
                    }`
                }
            >
                {d.label}
            </NavLink>
        ))}
    </div>
);

export default DashboardSwitcher;
