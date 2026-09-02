import React from "react";
import Chart from "react-apexcharts";
import { ChartFrame } from "../ui";
import { themeColor } from "@lib/designTokens";

interface Props {
    data: number[] | number[][]; // single or multiple series
    categories: string[];        // x-axis labels (e.g., months)
    color?: string | string[];   // single or multiple colors
    seriesNames?: string[];      // optional names for multiple series
}

const MultiLineAreaChart: React.FC<Props> = ({
    data,
    categories,
    color = themeColor("primary"),
    seriesNames = [],
}) => {
    // Prepare series for ApexCharts
    const series = Array.isArray(data[0])
        ? (data as number[][]).map((arr, idx) => ({
            name: seriesNames[idx] || `Series ${idx + 1}`,
            data: arr,
        }))
        : [{ name: seriesNames[0] || "Sales", data: data as number[] }];

    // Prepare colors array
    const colors = Array.isArray(color) ? color : [color];

    const options: ApexCharts.ApexOptions = {
        chart: {
            type: "area",
            toolbar: {
                show: true,
                tools: {
                    download: true,
                    selection: true,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: false,
                    reset: true,
                },
            },
            foreColor: themeColor("foreground"),
        },
        stroke: {
            curve: "smooth",
            width: 2,
            colors: colors,
        },
        markers: { size: 0 },
        dataLabels: { enabled: false },
        fill: {
            type: "gradient",
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.3,
                opacityTo: 0.7,
                stops: [0, 100],
                colorStops: colors.flatMap((c) => [
                    { offset: 0, color: c, opacity: 0.3 },
                    { offset: 100, color: c, opacity: 0 },
                ]),
            },
        },


        xaxis: { categories },
        tooltip: {
            theme: "light",
            style: { fontSize: "14px", fontFamily: "inherit" },
        },
        legend: { show: true },
    };

    // Height comes from the frame, not a literal: 300px was a third of a
    // laptop pane on its own.
    return (
        <ChartFrame minH="11rem" vh="26vh" maxH="18.75rem">
            {({ height }) => (
                <Chart options={options} series={series} type="area" height={height} width="100%" />
            )}
        </ChartFrame>
    );
};

export default MultiLineAreaChart;
