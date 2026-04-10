interface MetricItem {
  label: string;
  value: string | number;
  detail?: string;
}

interface MetricBarProps {
  items: MetricItem[];
}

export function MetricBar({ items }: MetricBarProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex-1 min-w-[120px] rounded-lg border border-border bg-muted/30 px-4 py-3"
        >
          <div className="text-2xl font-semibold text-foreground">
            {item.value}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {item.label}
            {item.detail && (
              <span className="ml-1.5 text-primary">{item.detail}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
