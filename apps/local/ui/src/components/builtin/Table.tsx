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
