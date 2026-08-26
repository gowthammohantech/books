import type { ReactNode } from "react";

interface DashboardCardProps {
    title: string;
    icon: ReactNode;
    children: ReactNode; // this will be your <CardItem /> list
}

export function DashboardCard({ title, icon, children }: DashboardCardProps) {
    return (
        <div className="bg-white border border-border rounded-xl shadow-sm p-4 space-y-2 transition-all duration-300 hover:shadow">
            {/* Header */}
            <div className="flex items-center gap-2">
                <span className="p-2 rounded-full bg-gradient-to-r from-indigo-300 to-primary text-white flex items-center justify-center shadow">
                    {icon}
                </span>
                <h2 className="text-md font-semibold text-gray-600">{title}</h2>
            </div>

            {/* Content */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {children}
            </div>
        </div>

    );
}
