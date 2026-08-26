import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import Table from "@components/admin/Table";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import NoRecords from "@components/admin/NoRecords";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";

interface Change { field: string; old: unknown; new: unknown; }
interface AuditLog {
  id: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType: string;
  entityLabel: string | null;
  summary: string;
  changes: Change[] | null;
  affectedCount: number | null;
  userName: string;
  ipAddress: string | null;
  createdAt: string;
}
interface PaginationData { total: number; page: number; limit: number; totalPages: number; }

const ACTIONS = ["", "CREATE", "UPDATE", "DELETE"];

const ActivityLogList: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { token } = useSelector((state: RootState) => state.auth);
  const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
  const { formatDate } = useDateFormatter();

  const search = searchParams.get("search") || "";
  const entityType = searchParams.get("entityType") || "";
  const action = searchParams.get("action") || "";
  const limit = Number(searchParams.get("limit") || 10);
  const page = Number(searchParams.get("page") || 1);

  const [searchInput, setSearchInput] = useState(search);
  const [entityTypeInput, setEntityTypeInput] = useState(entityType);

  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => { setEntityTypeInput(entityType); }, [entityType]);

  const setParam = (patch: Record<string, string>) => {
    const next = Object.fromEntries(searchParams.entries());
    setSearchParams({ ...next, ...patch, page: patch.page ?? "1" });
  };

  const fetchLogs = async () => {
    try {
      setIsLoading(true);
      const res = await axios.get(Constants.GET_ACTIVITY_LOGS_URL, {
        params: { search, entityType, action, limit, page },
        headers: { Authorization: `Bearer ${token}` },
      });
      setLogs(res.data.data.items || []);
      setPagination(res.data.data.pagination);
    } catch (err) {
      console.error("Error fetching activity logs:", err);
      toast.error("Failed to fetch activity logs.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, entityType, action, limit, page]);

  const from = (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);
  const headers = ["", "When", "Who", "Action", "Entity", "Summary"];

  const renderValue = (v: unknown): string =>
    v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

  return (
    <div className="space-y-4">
      <PageHeader title="Activity Log" />

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search summary / entity…"
          onKeyDown={(e) => { if (e.key === "Enter") setParam({ search: searchInput }); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        />
        <input
          type="text"
          value={entityTypeInput}
          onChange={(e) => setEntityTypeInput(e.target.value)}
          placeholder="Entity type (e.g. Invoice)"
          onKeyDown={(e) => { if (e.key === "Enter") setParam({ entityType: entityTypeInput }); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        />
        <select
          value={action}
          onChange={(e) => setParam({ action: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a || "All actions"}</option>
          ))}
        </select>
      </div>

      <Table headers={headers}>
        {logs.map((log) => (
          <Fragment key={log.id}>
            <tr className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3">
                {log.changes && log.changes.length > 0 ? (
                  <button
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    aria-label="toggle changes"
                  >
                    {expanded === log.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                ) : null}
              </td>
              <td className="px-4 py-3">
                {formatDate(log.createdAt, systemSettings?.dateFormat.format || "d-m-Y")}
              </td>
              <td className="px-4 py-3">{log.userName}</td>
              <td className="px-4 py-3">{log.action}</td>
              <td className="px-4 py-3">
                {log.entityType}{log.entityLabel ? ` · ${log.entityLabel}` : ""}
              </td>
              <td className="px-4 py-3">{log.summary}</td>
            </tr>
            {expanded === log.id && log.changes && (
              <tr className="bg-gray-50">
                <td colSpan={6} className="px-8 py-3">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left py-1 pr-6">Field</th>
                        <th className="text-left py-1 pr-6">Old</th>
                        <th className="text-left py-1">New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.changes.map((c) => (
                        <tr key={c.field}>
                          <td className="py-1 pr-6 font-medium">{c.field}</td>
                          <td className="py-1 pr-6 text-red-600">{renderValue(c.old)}</td>
                          <td className="py-1 text-green-700">{renderValue(c.new)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {!isLoading && !logs.length && (
          <NoRecords colSpan={6} message="No activity found" />
        )}
        {isLoading && (
          <tr key="table-loader">
            <td className="text-center py-1 text-gray-950 font-semibold" colSpan={6}>
              <LoaderSpinner />
            </td>
          </tr>
        )}
      </Table>

      <PaginationWrapper
        count={pagination.totalPages}
        page={page}
        from={from}
        to={to}
        total={pagination.total}
        onChange={(_, newPage) => setParam({ page: String(newPage) })}
        paginationVariant="outlined"
        paginationShape="rounded"
      />
    </div>
  );
};

export default ActivityLogList;
