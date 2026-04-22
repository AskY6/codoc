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
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {value}/{max}
        </span>
      </div>
    </div>
  );
}
