import { EmptyStateRow } from "@components/ui";
import type { IllustrationKey } from "@utils/illustrations";

type NoRecordsProps = {
    colSpan: number;
    message?: string;
    /** Artwork to draw. Defaults to the generic `no-data`; pass something
     *  closer to the subject where the table has one. */
    art?: IllustrationKey;
};

/**
 * The empty row for a table body.
 *
 * A thin wrapper over `EmptyStateRow` that keeps the original signature
 * (`colSpan`, `message`) it has had across ~50 call sites, so all of them
 * picked up the illustration without being edited. New code can use
 * `EmptyStateRow` directly and get a description and a call to action too.
 */
const NoRecords: React.FC<NoRecordsProps> = ({
    colSpan,
    message = "No records found",
    art = "no-data",
}) => <EmptyStateRow colSpan={colSpan} art={art} title={message} />;

export default NoRecords;
