import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";

import { Card } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import {
    accountGroup,
    visibleGroups,
    visibleSettingsTabs,
} from "@lib/settingsCatalogue";
import type { SettingsGroup } from "@lib/settingsCatalogue";
import type { RootState } from "@store/index";

/**
 * The settings landing page: every destination on one screen, grouped.
 *
 * It shows both tabs at once on purpose. The rail's tabs exist to shorten a
 * list you are navigating; this page is the overview you come to when you do
 * not yet know which half your setting lives in, and hiding half of it behind
 * a tab would defeat that.
 */

const GroupCard = ({ group }: { group: SettingsGroup }) => (
    <Card className="h-full">
        <div className="mb-3 flex items-center gap-2">
            <span className="text-primary">{group.icon}</span>
            <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
        </div>
        <ul className="space-y-1">
            {group.links.map((link) => (
                <li key={link.to}>
                    <Link
                        to={link.to}
                        className="block rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                    >
                        {link.title}
                    </Link>
                </li>
            ))}
        </ul>
    </Card>
);

const AllSettings = () => {
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings,
    );
    const permissions = useMemo(
        () => systemSettings?.permissions ?? [],
        [systemSettings?.permissions],
    );

    // Same shape as the rail: the tabbed sections, then the user's own
    // settings as a section of their own.
    const sections = useMemo(
        () => [
            ...visibleSettingsTabs(permissions),
            ...visibleGroups([accountGroup], permissions).map((group) => ({
                id: group.id,
                title: group.title,
                groups: [group],
            })),
        ],
        [permissions],
    );

    return (
        <>
            <PageHeader title="All Settings" />

            <div className="space-y-8">
                {sections.map((section) => (
                    <section key={section.id}>
                        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            {section.title}
                        </h2>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                            {section.groups.map((group) => (
                                <GroupCard key={group.id} group={group} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </>
    );
};

export default AllSettings;
