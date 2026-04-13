// Perf-review MDX components — AI Elements–inspired style.
//
// Design language:
// - Monochrome base, color only on score values
// - border-l-2 indent for hierarchical nesting (no heavy cards)
// - text-sm body, text-xs metadata
// - Badge: inline-flex rounded-md border bg-secondary px-1.5 py-0.5 text-xs
// - Breathing room via gap-2/gap-3, not excessive mb-8

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// MaterialHeader — raw material intake banner
// ---------------------------------------------------------------------------

export function MaterialHeader({
  subject,
  period,
  count,
}: {
  subject: string;
  period: string;
  count?: number;
}) {
  return (
    <div className="flex items-baseline justify-between pb-3 mb-4 border-b border-border">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight">{subject}</h2>
        <span className="text-xs text-muted-foreground">{period}</span>
      </div>
      {count != null && (
        <span className="text-xs text-muted-foreground">{count} 条</span>
      )}
    </div>
  );
}

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
  const scoreColor =
    total >= 4 ? "text-green-600" : total >= 3 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="flex items-baseline justify-between pb-3 mb-4 border-b border-border">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight">{subject}</h2>
        <span className="text-xs text-muted-foreground">{period}</span>
      </div>
      <span className={`font-mono text-lg font-bold ${scoreColor}`}>
        {total?.toFixed?.(2) ?? "—"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreCard — dimension row with left-border nested details
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
  const scoreColor =
    score >= 4 ? "text-green-600" : score >= 3 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-medium">{dimension}</span>
        <span className="text-xs text-muted-foreground">
          {(weight * 100).toFixed(0)}%
        </span>
        <span className={`ml-auto font-mono text-sm font-bold ${scoreColor}`}>
          {score}/5
        </span>
      </div>
      {children && (
        <div className="mt-1.5 border-l-2 border-muted pl-4 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight / Improvement
// ---------------------------------------------------------------------------

export function Highlight({ children }: { children?: ReactNode }) {
  return (
    <div className="text-sm text-foreground flex gap-1.5">
      <span className="shrink-0 text-muted-foreground">+</span>
      <span>{children}</span>
    </div>
  );
}

export function Improvement({ children }: { children?: ReactNode }) {
  return (
    <div className="text-sm text-foreground flex gap-1.5">
      <span className="shrink-0 text-muted-foreground">△</span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence — subtle inline citation
// ---------------------------------------------------------------------------

export function Evidence({
  strength,
  quote,
  children,
}: {
  strength?: string;
  quote?: string;
  children?: ReactNode;
}) {
  const label =
    strength === "verified" ? "已验证"
    : strength === "unconfirmed" ? "待确认"
    : strength === "unverifiable" ? "无法验证"
    : null;

  return (
    <div className="text-xs text-muted-foreground flex items-baseline gap-1.5 pl-4">
      {label && (
        <span className="inline-flex items-center rounded-md border bg-secondary px-1.5 py-0.5 text-[11px]">
          {label}
        </span>
      )}
      <span className="italic">{quote ?? children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedFact — two-line: badge + action, then result/scope indented
// ---------------------------------------------------------------------------

export function ExtractedFact({
  action,
  result,
  scope,
  strength,
  children: _children,
}: {
  action: string;
  result?: string;
  scope?: string;
  strength?: string;
  children?: ReactNode;
}) {
  const badgeLabel =
    strength === "verified" ? "可验证"
    : strength === "unconfirmed" ? "待确认"
    : "无法验证";

  return (
    <div className="py-1.5 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-flex items-center rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0">
          {badgeLabel}
        </span>
        <span className="font-medium">{action}</span>
      </div>
      {(result || scope) && (
        <div className="mt-0.5 pl-12 flex items-baseline gap-3 text-xs text-muted-foreground">
          {result && <span>→ {result}</span>}
          {scope && <span>[{scope}]</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WeightedTotal — compact formula
// ---------------------------------------------------------------------------

export function WeightedTotal({ scores }: { scores?: Record<string, unknown> }) {
  if (!scores) return null;
  const dims = [
    { key: "score_business", label: "业务", weight: 0.3 },
    { key: "score_technical", label: "技术", weight: 0.25 },
    { key: "score_impact", label: "影响", weight: 0.2 },
    { key: "score_growth", label: "成长", weight: 0.15 },
    { key: "score_ownership", label: "主动", weight: 0.1 },
  ];

  const total = typeof scores.weighted_total === "number"
    ? scores.weighted_total.toFixed(2)
    : dims.reduce((s, d) => s + (Number(scores[d.key]) || 0) * d.weight, 0).toFixed(2);

  return (
    <div className="mt-3 pt-3 border-t border-border flex items-baseline gap-3 text-sm">
      <span className="text-muted-foreground">加权总分</span>
      <div className="flex items-baseline gap-1 font-mono text-xs text-muted-foreground">
        {dims.map((d, i) => (
          <span key={d.key}>
            {i > 0 && " + "}
            {Number(scores[d.key]) || 0}×{(d.weight * 100).toFixed(0)}%
          </span>
        ))}
      </div>
      <span className="ml-auto font-mono font-bold">{total}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function Summary({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-6 border-l-2 border-muted pl-4">
      <p className="text-xs text-muted-foreground mb-1">总体评语</p>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export function CalibrationMatrix({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-6 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">姓名</th>
            <th className="pb-2 pr-3 font-medium text-right">业务</th>
            <th className="pb-2 pr-3 font-medium text-right">技术</th>
            <th className="pb-2 pr-3 font-medium text-right">影响</th>
            <th className="pb-2 pr-3 font-medium text-right">成长</th>
            <th className="pb-2 pr-3 font-medium text-right">主动</th>
            <th className="pb-2 font-medium text-right">总分</th>
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
  scores?: Record<string, unknown>;
}) {
  const s = scores ?? {};
  const num = (v: unknown): number =>
    typeof v === "number" ? v : 0;

  const cell = (v: unknown) => {
    const n = num(v);
    if (n === 0) {
      return <td className="py-2 pr-3 text-right font-mono text-muted-foreground">—</td>;
    }
    const color =
      n >= 4 ? "text-green-600" : n >= 3 ? "text-yellow-600" : "text-red-600";
    return <td className={`py-2 pr-3 text-right font-mono ${color}`}>{n}</td>;
  };

  const total = num(s.total);

  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-4 font-medium">{name}</td>
      {cell(s.business)}
      {cell(s.technical)}
      {cell(s.impact)}
      {cell(s.growth)}
      {cell(s.ownership)}
      <td className="py-2 text-right font-mono font-bold">
        {total.toFixed(2)}
      </td>
    </tr>
  );
}

export function AnomalyList({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-2 mb-6">
      <p className="text-xs text-muted-foreground font-medium">异常检测</p>
      {children}
    </div>
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
  return (
    <div className="text-sm border-l-2 border-muted pl-4 py-1">
      <div className="flex items-baseline gap-2">
        <span className="inline-flex items-center rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0">
          {type}
        </span>
        {dimension && <span className="text-muted-foreground text-xs">{dimension}</span>}
        {persons && (
          <span className="text-xs text-muted-foreground">
            ({persons.join(", ")})
          </span>
        )}
      </div>
      <p className="mt-1 leading-relaxed">{note}</p>
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
    <div className="border-l-2 border-muted pl-4 py-2 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{person}</span>
        <span className="text-xs text-muted-foreground">{dimension}</span>
        <span className="font-mono text-red-600">{from}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono text-green-600">{to}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{reason}</p>
    </div>
  );
}

export function CalibrationNote({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-2">
      {children}
    </div>
  );
}

const itemTypeLabels: Record<string, string> = {
  "data-gap": "数据缺口",
  comparability: "可比性",
  evidence: "证据",
};

export function Item({
  type,
  children,
}: {
  type?: string;
  children?: ReactNode;
}) {
  const label = (type && itemTypeLabels[type]) ?? type;
  return (
    <div className="border-l-2 border-muted pl-4 py-2 text-sm leading-relaxed">
      {label && (
        <span className="mb-1 inline-flex items-center rounded-md border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {label}
        </span>
      )}
      <p className="mt-1">{children}</p>
    </div>
  );
}

export function RankingSuggestion({ data: _data }: { data?: Record<string, unknown> }) {
  return (
    <div className="border-l-2 border-muted pl-4 text-sm text-muted-foreground mt-2">
      排序建议：基于校准后分数，见上方矩阵。
    </div>
  );
}
