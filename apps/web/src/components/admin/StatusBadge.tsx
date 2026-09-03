import React from 'react';
import {
  CheckCircle,
  Hourglass,
  Ban,
  Clock,
  RefreshCw,
  PlusCircle,
} from 'lucide-react';
import { Indicator, type IndicatorHue } from '@components/ui';

interface StatusBadgeProps {
  status: string;
}

/**
 * Nothing here styles anything any more: the pill geometry and every colour
 * come from Indicator, and the icons inherit currentColor rather than each
 * carrying a text-* class that had to be kept in step with its background by
 * hand. This map is now purely "what does this status word mean".
 */
const statusConfig: Record<
  string,
  { label: string; icon: React.ReactNode; hue: IndicatorHue }
> = {
  paid: { label: 'Paid', icon: <CheckCircle size={14} />, hue: 'green' },
  completed: { label: 'Completed', icon: <CheckCircle size={14} />, hue: 'green' },
  active: { label: 'Active', icon: <CheckCircle size={14} />, hue: 'green' },
  accepted: { label: 'Accepted', icon: <CheckCircle size={14} />, hue: 'green' },
  pending: { label: 'Pending', icon: <Hourglass size={14} />, hue: 'yellow' },
  draft: { label: 'Draft', icon: <Clock size={14} />, hue: 'yellow' },
  partially_paid: { label: 'Partially Paid', icon: <RefreshCw size={14} />, hue: 'blue' },
  new: { label: 'New', icon: <PlusCircle size={14} />, hue: 'blue' },
  sent: { label: 'Sent', icon: <CheckCircle size={14} />, hue: 'blue' },
  unpaid: { label: 'Unpaid', icon: <Hourglass size={14} />, hue: 'red' },
  inactive: { label: 'Inactive', icon: <Ban size={14} />, hue: 'red' },
  declined: { label: 'Declined', icon: <Ban size={14} />, hue: 'red' },
  cancelled: { label: 'Cancelled', icon: <Ban size={14} />, hue: 'gray' },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = statusConfig[status.toLowerCase()] ?? {
    label: status,
    icon: <Clock size={14} />,
    hue: 'gray' as IndicatorHue,
  };

  return (
    <Indicator hue={config.hue} icon={config.icon}>
      {config.label}
    </Indicator>
  );
};

export default StatusBadge;
