import { AreaChart, Area, ResponsiveContainer } from "recharts";

type ChartCardProps = {
    title: string;
    value: string | number;
    color: string;
    data?: { value: number }[];
};

const defaultData = [
    { value: 10 },
    { value: 20 },
    { value: 15 },
    { value: 25 },
    { value: 22 },
];

export function ChartCard({ title, value, color, data = defaultData }: ChartCardProps) {
    return (
        <div className="bg-white rounded-card shadow-card border border-border p-4 flex justify-between items-center">
            {/* Left Side - Title & Value */}
            <div>
                <p className="text-heading font-semibold text-sm">{title}</p>
                <p className="text-xl font-semibold text-heading">{value}</p>
            </div>

            {/* Right Side - Mini Chart */}
            <div className="w-20 h-12">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            fill={color}
                            fillOpacity={0.3}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
