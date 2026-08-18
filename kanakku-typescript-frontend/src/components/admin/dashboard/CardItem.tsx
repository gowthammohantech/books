import type { ReactNode } from "react";

interface CardItemProps {
    icon: ReactNode;
    label: string;
    value: string | number;
    color: string;
}

export function CardItem({ icon, label, value, color }: CardItemProps) {

    const colors: Record<string, string> = {
        purple: "bg-purple-50 border border-purple-300 text-purple-600",
        green: "bg-green-50 border border-green-300 text-green-700",
        blue: "bg-blue-50 border border-blue-300 text-blue-700",
        yellow: "bg-amber-50 border border-amber-300 text-amber-700",
        red: "bg-red-50 border border-red-300 text-red-700",
        gray: "bg-gray-50 border border-gray-300 text-gray-700",
        indigo: "bg-indigo-50 border border-indigo-300 text-indigo-700",
    };

    return (
        <div className="flex items-center gap-2">
            <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow transition-all duration-300 ${colors[color]}`}
            >
                {icon}
            </div>
            <div>
                <p className="text-xs text-gray-600 font-medium">{label}</p>
                <p className="text-sm font-semibold text-gray-600">{value}</p>
            </div>
        </div>

    );
}
