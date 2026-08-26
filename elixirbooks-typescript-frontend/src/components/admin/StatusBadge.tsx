import React from 'react';
import {
  CheckCircle,
  Hourglass,
  Ban,
  Clock,
  RefreshCw,
  PlusCircle,
} from 'lucide-react'; // Icon set

interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<
  string,
  {
    label: string;
    icon: React.ReactNode;
    className: string;
  }
> = {
  paid: {
    label: 'Paid',
    icon: <CheckCircle size={14} className="ml-1 text-success" />,
    className: 'bg-success-soft text-success',
  },
  pending: {
    label: 'Pending',
    icon: <Hourglass size={14} className="ml-1 text-warning" />,
    className: 'bg-warning-soft text-warning',
  },
  cancelled: {
    label: 'Cancelled',
    icon: <Ban size={14} className="ml-1 text-muted-foreground" />,
    className: 'bg-muted text-muted-foreground',
  },
  completed: {
    label: 'Completed',
    icon: <CheckCircle size={14} className="ml-1 text-success" />,
    className: 'bg-success-soft text-success',
  },
  partially_paid: {
    label: 'Partially Paid',
    icon: <RefreshCw size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  new: {
    label: 'New',
    icon: <PlusCircle size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  unpaid: {
    label: 'Unpaid',
    icon: <Hourglass size={14} className="ml-1 text-destructive" />,
    className: 'bg-destructive-soft text-destructive',
  },
  active: {
    label: 'Active',
    icon: <CheckCircle size={14} className="ml-1 text-success" />,
    className: 'bg-success-soft text-success',
  },
  inactive: {
    label: 'Inactive',
    icon: <Ban size={14} className="ml-1 text-destructive" />,
    className: 'bg-destructive-soft text-destructive',
  },
  draft: {
    label: 'Draft',
    icon: <Clock size={14} className="ml-1 text-warning" />,
    className: 'bg-warning-soft text-warning',
  },
  sent: {
    label: 'Sent',
    icon: <CheckCircle size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  declined: {
    label: 'Declined',
    icon: <Ban size={14} className="ml-1 text-destructive" />,
    className: 'bg-destructive-soft text-destructive',
  },
  accepted: {
    label: 'Accepted',
    icon: <CheckCircle size={14} className="ml-1 text-success" />,
    className: 'bg-success-soft text-success',
  }
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = statusConfig[status.toLowerCase()] || {
    label: status,
    icon: <Clock size={14} className="ml-1 text-muted-foreground" />,
    className: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[13px] font-medium ${config.className}`}
    >
      {config.label}
      {config.icon}
    </span>
  );
};

export default StatusBadge;
