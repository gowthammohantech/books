import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";

import { Card } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import { canView } from "@lib/navigation";
import { settingsBands } from "@lib/settingsCatalogue";
import type { SettingsBand } from "@lib/settingsCatalogue";
import type { RootState } from "@store/index";
import type { PermissionSet } from "@models/permissions";

/**
 * Drops the destinations this user cannot reach, then any group and band left
 * with nothing in it — an empty card is worse than no card.
 */
const visibleBands = (permissions: PermissionSet[]): SettingsBand[] =>
    settingsBands
        .map((band) => ({
            ...band,
            groups: band.groups
                .map((group) => ({
                    ...group,
                    // `slug: null` is an ungated route: always show it.
                    links: group.links.filter(
                        (link) =>
                            link.slug === null || canView(link.slug, permissions),
                    ),
                }))
                .filter((group) => group.links.length > 0),
        }))
        .filter((band) => band.groups.length > 0);

const AllSettings = () => {
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings,
    );
    const permissions = systemSettings?.permissions;

    const bands = useMemo(() => visibleBands(permissions ?? []), [permissions]);

    return (
        <>
            <PageHeader title="All Settings" />

            <div className="space-y-8">
                {bands.map((band) => (
                    <section key={band.id}>
                        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            {band.title}
                        </h2>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                            {band.groups.map((group) => (
                                <Card key={group.id} className="h-full">
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="text-primary">{group.icon}</span>
                                        <h3 className="text-sm font-semibold text-foreground">
                                            {group.title}
                                        </h3>
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
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </>
    );
};

export default AllSettings;
