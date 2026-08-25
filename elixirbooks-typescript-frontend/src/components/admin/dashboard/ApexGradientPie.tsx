import React from "react";
import Chart from "react-apexcharts";

interface PieChartData {
    id: string;
    value: number;
    label: string;
}

interface GradientPieChartProps {
    data: PieChartData[];
    colors?: string[];
    width?: number;
    height?: number;
}

const ApexGradientPie: React.FC<GradientPieChartProps> = ({
    data,
    colors = ["#7539FF", "#06AED4", "#27AE60", "#E2B93B", "#3538CD"],
    width = 250,
    height = 250,
}) => {
    const series = data.map((item) => item.value);
    const labels = data.map((item) => item.label);

    const options: ApexCharts.ApexOptions = {
        chart: {
            type: "donut",
            toolbar: {
                show: true,
                tools: {
                    download: true,
                    selection: false,
                    zoom: false,
                    zoomin: false,
                    zoomout: false,
                    pan: false,
                    reset: false,
                },
            },
        },
        labels,
        colors,
        plotOptions: {
            pie: {
                startAngle: -90,
                endAngle: 270,
                donut: {
                    size: "65%",
                },
            },
        },
        fill: {
            type: "gradient",
        },
        tooltip: {
            theme: "light",
            style: {
                fontSize: "13px",
                fontFamily: "inherit",
            },
        },
        legend: {
            position: "bottom",
            labels: {
                colors: "#5D6772", // muted body text for legend
            },
        },
    };

    return (
        <Chart type="donut" width={width} height={height} series={series} options={options} />
    );
};

export default ApexGradientPie;
