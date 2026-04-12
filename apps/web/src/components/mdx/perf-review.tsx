// Perf-review MDX components.
//
// These semantic components are provided to the MDX renderer when
// displaying codocs tagged with "review" or "calibration". They
// render structured perf-review data with visual hierarchy.

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// ReviewHeader
// ---------------------------------------------------------------------------

export function ReviewHeader({
  subject,
  period,
  total,
}: {
  subject: string;
  period: string;
  total: number;
}) {
  const color =
    total >= 4 ? "text-green-700 bg-green-50 border-green-200"
    : total >= 3 ? "text-yellow-700 bg-yellow-50 border-yellow-200"
    : "text-red-700 bg-red-50 border-red-200";

  return (
    <div className="mb-8 flex items-baseline justify-between border-b border-border pb-4">
      <div>
        <h1 className="text-2xl font-semibold">{subject}</h1>
        <p className="text-sm text-muted-foreground">{period}</p>
      </div>
      <div className={`rounded-lg border px-4 py-2 text-center ${color}`}>
        <div className="text-2xl font-bold">{total?.toFixed?.(2) ?? "—"}</div>
        <div className="text-xs">加权总分</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreCard
// ---------------------------------------------------------------------------

export function ScoreCard({
  dimension,
  weight,
  score,
  children,
}: {
  dimension: string;
  weight: number;
  score: number;
  children?: ReactNode;
}) {
  const pct = ((score / 5) * 100).toFixed(0);
  const barColor =
    score >= 4 ? "bg-green-500" : score >= 3 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="mb-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{dimension}</h3>
          <span className="text-xs text-muted-foreground">
            (权重 {(weight * 100).toFixed(0)}%)
          </span>
        </div>
        <span className="text-lg font-bold">{score}/5</span>
      </div>
      <div className="h-2 rounded-full bg-muted mb-3">
        <div
          className={`h-2 rounded-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreCard children
// ---------------------------------------------------------------------------

export function Highlight({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-2 text-green-700">
      <span className="shrink-0">+</span>
      <span>{children}</span>
    </div>
  );
}

export function Improvement({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-2 text-yellow-700">
      <span className="shrink-0">△</span>
      <span>{children}</span>
    </div>
  );
}

export function Evidence({
  strength,
  quote,
  children,
}: {
  strength?: string;
  quote?: string;
  children?: ReactNode;
}) {
  const icon =
    strength === "verified" ? "✅"
    : strength === "unconfirmed" ? "⚠️"
    : strength === "unverifiable" ? "❌"
    : "📎";

  return (
    <div className="flex gap-2 text-muted-foreground text-xs mt-1">
      <span className="shrink-0">{icon}</span>
      <span className="italic">{quote ?? children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedFact
// ---------------------------------------------------------------------------

export function ExtractedFact({
  action,
  result,
  scope,
  strength,
  children,
}: {
  action: string;
  result?: string;
  scope?: string;
  strength?: string;
  children?: ReactNode;
}) {
  const badge =
    strength === "verified" ? { label: "可验证", cls: "bg-green-100 text-green-700" }
    : strength === "unconfirmed" ? { label: "需确认", cls: "bg-yellow-100 text-yellow-700" }
    : { label: "无法验证", cls: "bg-red-100 text-red-700" };

  return (
    <div className="rounded border border-border p-3 mb-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{action}</div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      {result && (
        <div className="text-muted-foreground mt-1">
          量化结果: {result}
        </div>
      )}
      {scope && (
        <div className="text-muted-foreground">影响范围: {scope}</div>
      )}
      {children && (
        <div className="text-xs text-muted-foreground mt-1 italic border-l-2 border-border pl-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WeightedTotal
// ---------------------------------------------------------------------------

export function WeightedTotal({ scores }: { scores?: Record<string, unknown> }) {
  if (!scores) return null;
  const dims = [
    { key: "score_business", label: "业务成果", weight: 0.3 },
    { key: "score_technical", label: "技术深度", weight: 0.25 },
    { key: "score_impact", label: "影响力", weight: 0.2 },
    { key: "score_growth", label: "成长性", weight: 0.15 },
    { key: "score_ownership", label: "主动性", weight: 0.1 },
  ];

  return (
    <div className="rounded-lg border border-border p-4 mt-4">
      <h3 className="font-medium mb-3">加权计算</h3>
      <div className="space-y-1 text-sm">
        {dims.map((d) => {
          const val = Number(scores[d.key]) || 0;
          return (
            <div key={d.key} className="flex justify-between text-muted-foreground">
              <span>
                {d.label} ({(d.weight * 100).toFixed(0)}%)
              </span>
              <span>
                {val} × {d.weight} = {(val * d.weight).toFixed(2)}
              </span>
            </div>
          );
        })}
        <div className="flex justify-between font-medium text-foreground border-t border-border pt-1 mt-1">
          <span>总分</span>
          <span>
            {typeof scores.weighted_total === "number"
              ? scores.weighted_total.toFixed(2)
              : dims
                  .reduce((sum, d) => sum + (Number(scores[d.key]) || 0) * d.weight, 0)
                  .toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function Summary({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
      <p className="font-medium mb-1">总体评语</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration components
// ---------------------------------------------------------------------------

export function CalibrationMatrix({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-6 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 font-medium">姓名</th>
            <th className="py-2 pr-4 font-medium text-right">业务</th>
            <th className="py-2 pr-4 font-medium text-right">技术</th>
            <th className="py-2 pr-4 font-medium text-right">影响力</th>
            <th className="py-2 pr-4 font-medium text-right">成长</th>
            <th className="py-2 pr-4 font-medium text-right">主动性</th>
            <th className="py-2 font-medium text-right">总分</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function PersonRow({
  name,
  scores,
}: {
  name: string;
  scores: Record<string, number>;
}) {
  const cell = (v: number) => {
    const color =
      v >= 4 ? "text-green-700" : v >= 3 ? "text-yellow-700" : "text-red-700";
    return <td className={`py-2 pr-4 text-right font-mono ${color}`}>{v}</td>;
  };

  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-4 font-medium">{name}</td>
      {cell(scores.business ?? 0)}
      {cell(scores.technical ?? 0)}
      {cell(scores.impact ?? 0)}
      {cell(scores.growth ?? 0)}
      {cell(scores.ownership ?? 0)}
      <td className="py-2 text-right font-mono font-bold">
        {(scores.total ?? 0).toFixed?.(2) ?? scores.total}
      </td>
    </tr>
  );
}

export function AnomalyList({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-2 mb-6">{children}</div>
  );
}

export function Anomaly({
  type,
  dimension,
  persons,
  note,
}: {
  type: string;
  dimension?: string;
  persons?: string[];
  note: string;
}) {
  const badge =
    type === "同分异质" ? "bg-yellow-100 text-yellow-700"
    : type === "分布偏移" ? "bg-blue-100 text-blue-700"
    : "bg-red-100 text-red-700";

  return (
    <div className="rounded border border-border p-3 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className={`rounded px-1.5 py-0.5 text-xs ${badge}`}>{type}</span>
        {dimension && <span className="text-muted-foreground">{dimension}</span>}
        {persons && (
          <span className="text-muted-foreground">
            — {persons.join(", ")}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">{note}</p>
    </div>
  );
}

export function AdjustmentSuggestion({
  person,
  dimension,
  from,
  to,
  reason,
}: {
  person: string;
  dimension: string;
  from: number;
  to: number;
  reason: string;
}) {
  return (
    <div className="rounded border border-border p-3 mb-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{person}</span>
        <span className="text-muted-foreground">{dimension}</span>
        <span className="font-mono text-red-600">{from}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono text-green-600">{to}</span>
      </div>
      <p className="text-muted-foreground mt-1">{reason}</p>
    </div>
  );
}

export function RankingSuggestion({ data: _data }: { data?: Record<string, unknown> }) {
  return (
    <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground mb-1">排序建议</p>
      <p>基于校准后分数的参考排序，见上方矩阵。</p>
    </div>
  );
}
