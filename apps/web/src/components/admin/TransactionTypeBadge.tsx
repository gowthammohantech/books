import React from "react";
import { HelpCircle, TrendingDown, TrendingUp } from "lucide-react";
import { Indicator, type IndicatorHue } from "@components/ui";

interface TransactionTypeBadgeProps {
    type: string;
}

/**
 * This component used to be a whole parallel badge system: stock Tailwind hues
 * (bg-green-100 / text-green-700 and friends) on its own geometry — rounded-sm,
 * text-xs, py-1 — so it never matched any other status chip in the app. It is
 * an Indicator now, and the hues are the shared tinted pairs.
 */
const typeConfig: Record<
    string,
    { label: string; icon: React.ReactNode; hue: IndicatorHue }
> = {
    deposit: { label: "Deposit", icon: <TrendingUp size={14} />, hue: "green" },
    transfer_in: { label: "Transfer In", icon: <TrendingUp size={14} />, hue: "green" },
    withdrawal: { label: "Withdrawal", icon: <TrendingDown size={14} />, hue: "red" },
    transfer_out: { label: "Transfer Out", icon: <TrendingDown size={14} />, hue: "red" },
    payment: { label: "Payment", icon: <TrendingDown size={14} />, hue: "orange" },
};

const TransactionTypeBadge: React.FC<TransactionTypeBadgeProps> = ({ type }) => {
    const normalized = type.toLowerCase().trim();
    const config = typeConfig[normalized] ?? {
        label: type,
        icon: <HelpCircle size={14} />,
        hue: "gray" as IndicatorHue,
    };

    return (
        <Indicator hue={config.hue} icon={config.icon}>
            {config.label}
        </Indicator>
    );
};

export default TransactionTypeBadge;
