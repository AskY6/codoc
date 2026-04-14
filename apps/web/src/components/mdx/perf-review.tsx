// Perf-review MDX components — B2B enterprise design language.
//
// Design principles:
// - Three-tier typography: title (14px/500, #1F2329), secondary (13px, #646A73), detail (12px, #8F959E)
// - Progressive disclosure: long analysis text collapsed by default
// - Status badges with semantic color (green=verified, amber=unconfirmed, gray=unverifiable)
// - White cards with subtle shadow for fact blocks, clean dividers between sections
// - Generous spacing: 24px between cards, 16-20px internal padding

import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Badge — semantic status tag with color coding
// ---------------------------------------------------------------------------

type EvidenceLevel = "verified" | "unconfirmed" | "unverifiable";

const badgeStyles: Record<EvidenceLevel, string> = {
  verified:
    "bg-emerald-50 text-emerald-700 border-emerald-200",
  unconfirmed:
    "bg-amber-50 text-amber-700 border-amber-200",
  unverifiable:
    "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const badgeLabels: Record<string, { level: EvidenceLevel; text: string }> = {
  verified:     { level: "verified",     text: "已验证" },
  "可验证":     { level: "verified",     text: "可验证" },
  unconfirmed:  { level: "unconfirmed",  text: "待确认" },
  "待确认":     { level: "unconfirmed",  text: "待确认" },
  unverifiable: { level: "unverifiable", text: "无法验证" },
  "无法验证":   { level: "unverifiable", text: "无法验证" },
};

function StatusBadge({ strength }: { strength?: string | undefined }) {
  const entry = strength ? badgeLabels[strength] : null;
  if (!entry) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${badgeStyles[entry.level]}`}
    >
      {entry.text}
    </span>
  );
}

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
    <div className="flex items-baseline justify-between pb-3 mb-6 border-b border-border">
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
    total >= 4 ? "text-emerald-600" : total >= 3 ? "text-amber-600" : "text-red-500";

  return (
    <div className="flex items-baseline justify-between pb-3 mb-6 border-b border-border">
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
// ScoreCard — dimension row with expandable detail
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
    score >= 4 ? "text-emerald-600" : score >= 3 ? "text-amber-600" : "text-red-500";

  return (
    <div className="mb-5 rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-[#1F2329]">{dimension}</span>
          <span className="text-[11px] text-[#8F959E]">
            {(weight * 100).toFixed(0)}%
          </span>
        </div>
        <span className={`font-mono text-sm font-bold ${scoreColor}`}>
          {score}/5
        </span>
      </div>
      {children && (
        <div className="border-t border-border/40 px-4 py-3 space-y-1.5">
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
    <div className="flex gap-2 text-[13px] text-[#1F2329] leading-relaxed">
      <span className="shrink-0 text-emerald-500 mt-0.5">+</span>
      <span>{children}</span>
    </div>
  );
}

export function Improvement({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px] text-[#1F2329] leading-relaxed">
      <span className="shrink-0 text-amber-500 mt-0.5">△</span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence — collapsible detail analysis
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
  const [open, setOpen] = useState(false);
  const content = quote ?? children;
  if (!content) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-1.5 text-[12px] text-[#8F959E] hover:text-[#646A73] transition-colors"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}
        />
        <span>查看分析详情</span>
      </button>

      {open && (
        <div className="mt-2 ml-5 border-l-2 border-neutral-200 pl-4 py-2">
          <p className="text-[12px] leading-[1.75] text-[#8F959E]">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedFact — primary fact card with three-tier typography
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
  return (
    <div className="mb-6 rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4">
      {/* Tier 1: status + title */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <StatusBadge strength={strength} />
        </div>
        <p className="text-[14px] font-medium leading-relaxed text-[#1F2329]">
          {action}
        </p>
      </div>

      {/* Tier 2: quantified result + scope */}
      {(result || scope) && (
        <div className="mt-2.5 ml-[calc(2px+0.75rem+0.75rem)] border-l-2 border-amber-200/60 pl-3">
          {result && (
            <p className="text-[13px] leading-[1.6] text-[#646A73]">
              → {result}
            </p>
          )}
          {scope && (
            <p className="text-[12px] leading-[1.6] text-[#8F959E] mt-0.5">
              {scope}
            </p>
          )}
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
    <div className="mt-6 rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-[#646A73]">加权总分</span>
        <span className="font-mono text-base font-bold text-[#1F2329]">{total}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] text-[#8F959E]">
        {dims.map((d, i) => (
          <span key={d.key}>
            {i > 0 && "+ "}
            {Number(scores[d.key]) || 0}×{(d.weight * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function Summary({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-8 rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[#8F959E] mb-2">
        总体评语
      </p>
      <p className="text-[14px] leading-[1.75] text-[#1F2329]">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export function CalibrationMatrix({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-8 rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border bg-neutral-50/60 text-left text-[11px] text-[#8F959E]">
            <th className="px-4 py-2.5 font-medium">姓名</th>
            <th className="px-3 py-2.5 font-medium text-right">业务</th>
            <th className="px-3 py-2.5 font-medium text-right">技术</th>
            <th className="px-3 py-2.5 font-medium text-right">影响</th>
            <th className="px-3 py-2.5 font-medium text-right">成长</th>
            <th className="px-3 py-2.5 font-medium text-right">主动</th>
            <th className="px-4 py-2.5 font-medium text-right">总分</th>
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
      return <td className="px-3 py-3 text-right font-mono text-[#8F959E]">—</td>;
    }
    const color =
      n >= 4 ? "text-emerald-600" : n >= 3 ? "text-amber-600" : "text-red-500";
    return <td className={`px-3 py-3 text-right font-mono ${color}`}>{n}</td>;
  };

  const total = num(s.total);

  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-neutral-50/40 transition-colors">
      <td className="px-4 py-3 font-medium text-[#1F2329]">{name}</td>
      {cell(s.business)}
      {cell(s.technical)}
      {cell(s.impact)}
      {cell(s.growth)}
      {cell(s.ownership)}
      <td className="px-4 py-3 text-right font-mono font-bold text-[#1F2329]">
        {total.toFixed(2)}
      </td>
    </tr>
  );
}

export function AnomalyList({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-3 mb-8">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[#8F959E]">
        异常检测
      </p>
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
    <div className="rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {type}
        </span>
        {dimension && (
          <span className="text-[12px] text-[#8F959E]">{dimension}</span>
        )}
        {persons && (
          <span className="text-[12px] text-[#8F959E]">
            ({persons.join(", ")})
          </span>
        )}
      </div>
      <p className="text-[13px] leading-[1.7] text-[#646A73]">{note}</p>
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
    <div className="rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4 mb-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[14px] font-medium text-[#1F2329]">{person}</span>
        <span className="text-[12px] text-[#8F959E]">{dimension}</span>
        <div className="flex items-baseline gap-1.5 ml-auto">
          <span className="font-mono text-sm text-red-500">{from}</span>
          <span className="text-[#8F959E]">→</span>
          <span className="font-mono text-sm text-emerald-600">{to}</span>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-[1.7] text-[#8F959E]">{reason}</p>
    </div>
  );
}

export function CalibrationNote({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-3">
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
    <div className="rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4 mb-4">
      {label && (
        <span className="mb-2 inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-[#646A73]">
          {label}
        </span>
      )}
      <p className="text-[13px] leading-[1.7] text-[#646A73]">{children}</p>
    </div>
  );
}

export function RankingSuggestion({ data: _data }: { data?: Record<string, unknown> }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-5 py-4 mt-4">
      <p className="text-[13px] text-[#8F959E]">
        排序建议：基于校准后分数，见上方矩阵。
      </p>
    </div>
  );
}
