import React from 'react';
import { DollarSign, CreditCard, Banknote, HelpCircle } from 'lucide-react';
import { Indicator, type IndicatorHue } from '@components/ui';
import UPI from '@assets/images/upi.svg';

interface PaymentModeBadgeProps {
  mode: string;
}

/**
 * The bank rails take cyan rather than blue. Blue is the informational status
 * hue (Sent, Partially Paid), and a payment mode sitting in the same table
 * cell colour as a status was the reason these two were hard to tell apart at
 * a glance. Cash keeps green, cheque keeps blue.
 */
const modeConfig: Record<
  string,
  { label: string; icon: React.ReactNode; hue: IndicatorHue }
> = {
  cash: { label: 'Cash', icon: <DollarSign size={14} />, hue: 'green' },
  cheque: { label: 'Cheque', icon: <CreditCard size={14} />, hue: 'blue' },
  bank: { label: 'Bank', icon: <Banknote size={14} />, hue: 'cyan' },
  upi: {
    label: 'UPI',
    // Not a lucide glyph, so it cannot inherit currentColor — it stays an image.
    icon: <img src={UPI} alt="" className="h-3.5" />,
    hue: 'cyan',
  },
  'bank deposit': { label: 'Bank Deposit', icon: <Banknote size={14} />, hue: 'cyan' },
  'bank transfer': { label: 'Bank Transfer', icon: <Banknote size={14} />, hue: 'cyan' },
  'petty cash': { label: 'Petty Cash', icon: <Banknote size={14} />, hue: 'cyan' },
};

const PaymentModeBadge: React.FC<PaymentModeBadgeProps> = ({ mode }) => {
  const normalized = mode.toLowerCase().trim();
  const config = modeConfig[normalized] ?? {
    label: mode,
    icon: <HelpCircle size={14} />,
    hue: 'gray' as IndicatorHue,
  };

  return (
    <Indicator hue={config.hue} icon={config.icon}>
      {config.label}
    </Indicator>
  );
};

export default PaymentModeBadge;
