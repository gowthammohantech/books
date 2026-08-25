import React from 'react';
import {
  DollarSign,
  CreditCard,
  Banknote,
  HelpCircle,
} from 'lucide-react';
import UPI from '@assets/images/upi.svg';
interface PaymentModeBadgeProps {
  mode: string;
}

const modeConfig: Record<
  string,
  {
    label: string;
    icon: React.ReactNode;
    className: string;
  }
> = {
  cash: {
    label: 'Cash',
    icon: <DollarSign size={14} className="ml-1 text-success" />,
    className: 'bg-success-soft text-success',
  },
  cheque: {
    label: 'Cheque',
    icon: <CreditCard size={14} className="ml-1 text-purple-600" />,
    className: 'bg-primary-soft text-purple-600',
  },
  bank: {
    label: 'Bank',
    icon: <Banknote size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  upi: {
    label: 'UPI',
    icon: <img src={UPI} alt="UPI" className="h-4 ml-1" />,
    className: 'bg-info-soft text-info',
  },
  'bank deposit': {
    label: 'Bank Deposit',
    icon: <Banknote size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  'bank transfer': {
    label: 'Bank Transfer',
    icon: <Banknote size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
  'petty cash': {
    label: 'Petty Cash',
    icon: <Banknote size={14} className="ml-1 text-info" />,
    className: 'bg-info-soft text-info',
  },
};

const PaymentModeBadge: React.FC<PaymentModeBadgeProps> = ({ mode }) => {
  const normalized = mode.toLowerCase().trim();
  const config = modeConfig[normalized] || {
    label: mode,
    icon: <HelpCircle size={14} className="ml-1 text-body" />,
    className: 'bg-surface text-body',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-control text-[13px] font-medium ${config.className}`}
    >
      {config.label}
      {config.icon}
    </span>
  );
};

export default PaymentModeBadge;
