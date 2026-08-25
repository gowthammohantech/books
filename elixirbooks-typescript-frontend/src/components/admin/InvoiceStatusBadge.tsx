import React from 'react';
import {
  CheckCircle,
  Ban,
  Clock,
  RefreshCw,
  FileText,
  Send,
  AlertTriangle,
} from 'lucide-react';
import {
  deriveInvoiceDisplayStatus,
  DISPLAY_STATUS_META,
  type DisplayStatus,
} from '@utils/invoiceStatus';

interface InvoiceStatusBadgeProps {
  status: string;
  /** Optional context lets the badge surface the derived "Delayed Payment" overlay. */
  dueDate?: string | Date | null;
  totalAmount?: number | null;
  totalPaid?: number | null;
}

const ICONS: Record<DisplayStatus, React.ReactNode> = {
  DRAFT: <FileText size={14} className="ml-1 text-warning" />,
  SENT: <Send size={14} className="ml-1 text-info" />,
  PARTIALLY_PAID: <RefreshCw size={14} className="ml-1 text-info" />,
  PAID: <CheckCircle size={14} className="ml-1 text-success" />,
  DELAYED: <AlertTriangle size={14} className="ml-1 text-danger" />,
  CANCELLED: <Ban size={14} className="ml-1 text-body" />,
};

const InvoiceStatusBadge: React.FC<InvoiceStatusBadgeProps> = ({
  status,
  dueDate,
  totalAmount,
  totalPaid,
}) => {
  const display = deriveInvoiceDisplayStatus({ status, dueDate, totalAmount, totalPaid });
  const meta = DISPLAY_STATUS_META[display];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-control text-[13px] font-medium ${
        meta?.classes ?? 'bg-surface text-body'
      }`}
    >
      {meta?.label ?? status}
      {ICONS[display] ?? <Clock size={14} className="ml-1 text-body" />}
    </span>
  );
};

export default InvoiceStatusBadge;
