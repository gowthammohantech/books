import React from "react";
import {
    HelpCircle,
    TrendingDown,
    TrendingUp,
} from "lucide-react";

interface TransactionTypeBadgeProps {
    type: string;
}

const typeConfig: Record<
    string,
    {
        label: string;
        icon: React.ReactNode;
        className: string;
    }
> = {
    deposit: {
        label: "Deposit",
        icon: <TrendingUp size={14} className="ml-1 text-green-600" />,
        className: "bg-green-100 text-green-700",
    },
    withdrawal: {
        label: "Withdrawal",
        icon: <TrendingDown size={14} className="ml-1 text-red-600" />,
        className: "bg-red-100 text-red-700",
    },
    transfer_in: {
        label: "Transfer In",
        icon: <TrendingUp size={14} className="ml-1 text-green-600" />,
        className: "bg-green-100 text-green-700",
    },
    transfer_out: {
        label: "Transfer Out",
        icon: <TrendingDown size={14} className="ml-1 text-red-600" />,
        className: "bg-red-100 text-red-700",
    },
    payment: {
        label: "Payment",
        icon: <TrendingDown size={14} className="ml-1 text-orange-600" />,
        className: "bg-orange-100 text-orange-700",
    }
};

const TransactionTypeBadge: React.FC<TransactionTypeBadgeProps> = ({ type }) => {
    const normalized = type.toLowerCase().trim();
    const config = typeConfig[normalized] || {
        label: type,
        icon: <HelpCircle size={14} className="ml-1 text-gray-600" />,
        className: "bg-gray-100 text-gray-700",
    };

    return (
        <span
            className={`inline-flex items-center px-2 py-1 rounded-sm text-xs font-medium ${config.className}`}
        >
            {config.label}
            {config.icon}
        </span>
    );
};

export default TransactionTypeBadge;
