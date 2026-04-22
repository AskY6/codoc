interface ChartProps {
  data?: Array<{ label: string; value: number }>;
  height?: number;
}

export function Chart({ data, height = 200 }: ChartProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-sm text-neutral-400">No data</div>;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(20, Math.min(60, 400 / data.length));
  const gap = 8;
  const svgWidth = data.length * (barWidth + gap);
  const chartH = height - 30;

  return (
    <div className="not-prose overflow-auto">
      <svg width={svgWidth} height={height}>
        {data.map((d, i) => {
          const barH = (d.value / maxVal) * chartH;
          const x = i * (barWidth + gap);
          const y = chartH - barH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                className="fill-blue-500"
              />
              <text
                x={x + barWidth / 2}
                y={chartH + 16}
                textAnchor="middle"
                className="fill-neutral-500"
                fontSize={10}
              >
                {d.label}
              </text>
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-neutral-600"
                fontSize={10}
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
