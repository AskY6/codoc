interface DataTableProps {
  rows: Record<string, unknown>[];
}

export function DataTable({ rows }: DataTableProps) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No data</p>;
  }
  const headers = Object.keys(rows[0]!);
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-left font-medium text-muted-foreground border-b border-border/60"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
            >
              {headers.map((h) => (
                <td key={h} className="px-3 py-2.5 text-foreground">
                  {String(row[h] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
