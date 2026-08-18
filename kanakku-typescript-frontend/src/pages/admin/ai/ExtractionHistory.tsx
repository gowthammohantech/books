/**
 * AI Extraction History (Cluster H, slice H.2).
 *
 * Lists every AiExtractionJob owned by the user, with status badge,
 * vendor/total pulled from extractedData, and per-row actions:
 *   - View         → opens a read-only modal with the parsed JSON
 *   - Re-confirm   → if status=EXTRACTED, jumps back into the ScanBill
 *                    review step seeded from this job (we just open the
 *                    modal pointing at the same jobId via state)
 *   - Discard      → POST /:id/discard
 */
import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import Constants from '@constants/api';
import Modal from '@components/admin/Modal';
import PaginationWrapper from '@components/admin/PaginationWrapper';
import Table from '@components/admin/Table';
import TableRow from '@components/admin/TableRow';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { PageHeader } from '@/context/PageHeaderContext';

interface ExtractedData {
  vendorName: string | null;
  invoiceNumber: string | null;
  total: number;
  currency: string;
  [key: string]: unknown;
}

interface Job {
  id: string;
  status: 'PENDING' | 'EXTRACTED' | 'CONFIRMED' | 'FAILED' | 'DISCARDED';
  sourceFilePath: string;
  mimeType: string;
  extractedData: ExtractedData | null;
  confidence: number | null;
  costUsd: number | null;
  errorMessage: string | null;
  resultingPurchaseId: string | null;
  createdAt: string;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_STYLES: Record<Job['status'], string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  EXTRACTED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  DISCARDED: 'bg-gray-100 text-gray-500 line-through',
};

const ExtractionHistory: FC = () => {
  const token = useSelector((s: RootState) => s.auth.token);
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();
  const { format } = useCurrencyFormatter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const [viewJob, setViewJob] = useState<Job | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await axios.get(`${Constants.AI_EXTRACT_BILL_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setJobs(res.data?.data?.jobs ?? []);
      setPagination(
        res.data?.data?.pagination ?? { total: 0, page: 1, limit: 20, totalPages: 1 },
      );
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? err.message)
        : 'Failed to load extraction history';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [token, page, statusFilter]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  async function handleDiscard(job: Job) {
    if (!token) return;
    if (!confirm('Discard this extraction? The source file will be deleted.')) return;
    try {
      await axios.post(
        `${Constants.AI_EXTRACT_BILL_URL}/${job.id}/discard`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success('Extraction discarded');
      void fetchJobs();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? err.message)
        : 'Failed to discard';
      toast.error(message);
    }
  }

  const headers = useMemo(
    () => ['#', 'File', 'Uploaded', 'Vendor', 'Total', 'Confidence', 'Status', 'Actions'],
    [],
  );

  const startIdx = (pagination.page - 1) * pagination.limit;

  return (
    <div className="space-y-4">
      <PageHeader title="AI Extractions" />

      <div className="flex justify-between items-center">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 bg-white text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
        >
          <option value="">All statuses</option>
          <option value="EXTRACTED">Extracted (awaiting confirm)</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="FAILED">Failed</option>
          <option value="DISCARDED">Discarded</option>
        </select>
        <div className="text-sm text-gray-600">{pagination.total} total</div>
      </div>

      <Table headers={headers}>
        {loading && (
          <tr>
            <td colSpan={headers.length} className="text-center py-6 text-gray-500">
              <Loader2 size={18} className="inline animate-spin mr-2" /> Loading…
            </td>
          </tr>
        )}
        {!loading && jobs.length === 0 && (
          <tr>
            <td colSpan={headers.length} className="text-center py-8 text-gray-500">
              No extractions yet. Scan your first bill from the Purchases page.
            </td>
          </tr>
        )}
        {!loading &&
          jobs.map((job, idx) => (
            <TableRow
              key={job.id}
              index={startIdx + idx + 1}
              row={job}
              columns={[
                <span className="flex items-center gap-2 text-gray-700">
                  {job.mimeType === 'application/pdf' ? (
                    <FileText size={16} className="text-red-500" />
                  ) : (
                    <ImageIcon size={16} className="text-blue-500" />
                  )}
                  <span className="text-xs">{job.mimeType.split('/')[1]?.toUpperCase()}</span>
                </span>,
                <span className="text-gray-700 text-sm">
                  {formatDate(job.createdAt, 'd-m-Y H:i')}
                </span>,
                <span className="text-gray-800">
                  {job.extractedData?.vendorName ?? <span className="text-gray-400">—</span>}
                </span>,
                <span className="text-gray-800">
                  {job.extractedData?.total
                    ? format(Number(job.extractedData.total))
                    : <span className="text-gray-400">—</span>}
                </span>,
                <span className="text-gray-700 text-sm">
                  {job.confidence !== null ? `${(job.confidence * 100).toFixed(0)}%` : '—'}
                </span>,
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[job.status]}`}
                >
                  {job.status}
                </span>,
              ]}
              actions={[
                {
                  label: 'view',
                  icon: <Eye className="text-blue-500 hover:text-blue-700" size={16} />,
                  onClick: (j: Job) => setViewJob(j),
                },
                ...(job.status === 'CONFIRMED' && job.resultingPurchaseId
                  ? [
                      {
                        label: 'open',
                        icon: <CheckCircle2 className="text-green-500 hover:text-green-700" size={16} />,
                        onClick: (j: Job) => navigate(`/admin/purchases/view/${j.resultingPurchaseId}`),
                      },
                    ]
                  : []),
                ...(job.status === 'EXTRACTED' || job.status === 'FAILED' || job.status === 'PENDING'
                  ? [
                      {
                        label: 'discard',
                        icon: <Trash2 className="text-red-500 hover:text-red-700" size={16} />,
                        onClick: (j: Job) => handleDiscard(j),
                      },
                    ]
                  : []),
              ]}
            />
          ))}
      </Table>

      <PaginationWrapper
        page={pagination.page}
        count={pagination.totalPages}
        from={startIdx + 1}
        to={Math.min(pagination.page * pagination.limit, pagination.total)}
        total={pagination.total}
        onChange={(_, p) => setPage(p)}
      />

      {viewJob && (
        <Modal
          isOpen={!!viewJob}
          onClose={() => setViewJob(null)}
          title={`Extraction ${viewJob.id.slice(0, 8)}`}
          size="3xl"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Info label="Status" value={viewJob.status} />
              <Info label="Created" value={formatDate(viewJob.createdAt, 'd-m-Y H:i')} />
              <Info label="Confidence" value={viewJob.confidence !== null ? `${(viewJob.confidence * 100).toFixed(0)}%` : '—'} />
              <Info label="Cost" value={viewJob.costUsd !== null ? `$${viewJob.costUsd.toFixed(4)}` : '—'} />
            </div>
            {viewJob.errorMessage && (
              <div className="flex items-start gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-sm">
                <XCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{viewJob.errorMessage}</span>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Extracted JSON</h3>
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-96">
                {JSON.stringify(viewJob.extractedData, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const Info: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between border-b border-gray-100 py-1">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-800 font-medium">{value}</span>
  </div>
);

export default ExtractionHistory;
