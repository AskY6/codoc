import type { ReactNode } from "react";
import { Sparkles, CloudDownload } from "lucide-react";
import { useFieldTTL } from "../runtime/codata-react.js";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
      {children}
    </span>
  );
}

export function PriceDisplay({ children }: { children: ReactNode }) {
  return (
    <span className="text-lg font-bold text-emerald-600">$ {children}</span>
  );
}

export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-1 not-prose">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function SourceBlock({
  path,
  children,
}: {
  path?: string;
  children: ReactNode;
}) {
  const ttl = useFieldTTL(path ?? "");
  return (
    <div className="rounded-lg border border-cyan-200/60 bg-gradient-to-br from-cyan-50/60 to-sky-50/40 not-prose overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-cyan-200/40">
        <CloudDownload size={12} className="text-cyan-500" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-cyan-500">$source</span>
        {ttl != null && (
          <span className="ml-auto rounded-full bg-cyan-100 px-1.5 py-0 text-[9px] font-medium text-cyan-600">
            TTL {ttl}s
          </span>
        )}
      </div>
      <pre className="p-2.5 text-[11px] font-mono leading-relaxed overflow-auto whitespace-pre-wrap break-all text-foreground/80 bg-transparent m-0">
        {children}
      </pre>
    </div>
  );
}

export function AIBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-violet-200/60 bg-gradient-to-br from-violet-50/80 to-purple-50/50 p-3 not-prose">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-violet-400">
        <Sparkles size={12} />
        {label}
      </div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

const highlightColors = {
  info: "bg-blue-50 border-blue-200 text-blue-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
};

export function Highlight({
  variant = "info",
  children,
}: {
  variant?: "info" | "warning" | "success";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm not-prose ${highlightColors[variant]}`}
    >
      {children}
    </div>
  );
}
