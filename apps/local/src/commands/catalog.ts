// catalog — built-in component sources for `codoc add`.
//
// Each entry contains the TSX source that gets copied into
// .codoc/components/<Name>.tsx when the user runs `codoc add <name>`.
// Similar to shadcn/ui: you own the source after adding.

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
}

export const catalog: readonly CatalogEntry[] = [
  {
    name: "Badge",
    description: "Colored pill displaying a value — status, score, or label.",
    source: `\
interface BadgeProps {
  value?: string | number | boolean;
  label?: string;
  color?: "blue" | "green" | "red" | "amber" | "purple" | "neutral";
}

const colors: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  purple: "bg-purple-100 text-purple-700",
  neutral: "bg-neutral-100 text-neutral-700",
};

export function Badge({ value, label, color = "blue" }: BadgeProps) {
  return (
    <span
      className={\`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium \${colors[color] ?? colors.blue}\`}
    >
      {label && <span className="opacity-60">{label}</span>}
      {String(value ?? "")}
    </span>
  );
}

export default Badge;
`,
  },
  {
    name: "Card",
    description: "Information card with title, value, and description.",
    source: `\
import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  value?: string | number;
  description?: string;
  children?: ReactNode;
}

export function Card({ title, value, description, children }: CardProps) {
  return (
    <div className="not-prose rounded-lg border border-neutral-200 bg-white p-4">
      {title && (
        <div className="text-xs font-medium text-neutral-500">{title}</div>
      )}
      {value != null && (
        <div className="mt-1 text-2xl font-semibold">{String(value)}</div>
      )}
      {description && (
        <div className="mt-1 text-sm text-neutral-600">{description}</div>
      )}
      {children}
    </div>
  );
}

export default Card;
`,
  },
  {
    name: "Chart",
    description: "Simple bar chart from {label, value} data.",
    source: `\
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

export default Chart;
`,
  },
  {
    name: "Progress",
    description: "Horizontal progress bar with value and max.",
    source: `\
interface ProgressProps {
  value?: number;
  max?: number;
  label?: string;
}

export function Progress({ value = 0, max = 100, label }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div className="w-full">
      {label && <div className="mb-1 text-xs text-neutral-600">{label}</div>}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-neutral-200">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all"
            style={{ width: \`\${pct}%\` }}
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {value}/{max}
        </span>
      </div>
    </div>
  );
}

export default Progress;
`,
  },
  {
    name: "Table",
    description: "Data table auto-generated from an array of objects.",
    source: `\
interface TableProps {
  data?: unknown[];
  columns?: string[];
}

export function Table({ data, columns }: TableProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-sm text-neutral-400">No data</div>;
  }

  const rows = data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
  if (rows.length === 0) {
    return <div className="text-sm text-neutral-400">No data</div>;
  }

  const cols = columns ?? Object.keys(rows[0]!);

  return (
    <div className="not-prose overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {cols.map((col) => (
              <th
                key={col}
                className="border-b border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-500"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-neutral-100">
              {cols.map((col) => (
                <td key={col} className="px-3 py-2">
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export default Table;
`,
  },
];

/** Look up a catalog entry by name (case-insensitive). */
export function findEntry(name: string): CatalogEntry | undefined {
  return catalog.find((e) => e.name.toLowerCase() === name.toLowerCase());
}
