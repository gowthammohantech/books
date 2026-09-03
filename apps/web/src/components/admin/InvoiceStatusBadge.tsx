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
import { Indicator } from '@components/ui';

interface InvoiceStatusBadgeProps {
  status: string;
  /** Optional context lets the badge surface the derived "Delayed Payment" overlay. */
  dueDate?: string | Date | null;
  totalAmount?: number | null;
  totalPaid?: number | null;
}

// Icons inherit currentColor from the pill — no text-* class here.
const ICONS: Record<DisplayStatus, React.ReactNode> = {
  DRAFT: <FileText size={14} />,
  SENT: <Send size={14} />,
  PARTIALLY_PAID: <RefreshCw size={14} />,
  PAID: <CheckCircle size={14} />,
  DELAYED: <AlertTriangle size={14} />,
  CANCELLED: <Ban size={14} />,
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
    <Indicator
      hue={meta?.hue ?? 'gray'}
      icon={ICONS[display] ?? <Clock size={14} />}
    >
      {meta?.label ?? status}
    </Indicator>
  );
};

export default InvoiceStatusBadge;
