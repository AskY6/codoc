import { useState, useEffect, type ComponentType } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DataFieldInfo } from "../api.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

interface PreviewProps {
  view: { kind: "mdx"; source: string } | { kind: "empty" };
  data: Record<string, DataFieldInfo>;
  componentMap: Record<string, ComponentType<Record<string, unknown>>>;
}

export function Preview({ view, data, componentMap }: PreviewProps) {
  const [Content, setContent] = useState<React.ComponentType<{
    components?: Record<string, React.ComponentType<Record<string, unknown>>>;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (view.kind === "empty") {
      setContent(null);
      setError(null);
      return;
    }

    // Capture source before entering async — TS narrowing doesn't cross function boundaries
    const source = view.source;
    let cancelled = false;

    async function compile() {
      try {
        const { evaluate } = await import("@mdx-js/mdx");
        const runtime = await import("react/jsx-runtime");

        // Extract resolved values from data fields
        const resolved: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(data)) {
          if (field.resolved?.kind === "ready") {
            resolved[key] = field.resolved.value;
          }
        }

        // Prepend data export so {data.field} expressions work in MDX
        const mdxSource = `export const data = ${JSON.stringify(resolved)}\n\n${source}`;

        const mod = await evaluate(mdxSource, runtime as Parameters<typeof evaluate>[1]);

        if (!cancelled) {
          setContent(() => mod.default as typeof Content);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setContent(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void compile();
    return () => {
      cancelled = true;
    };
  }, [view, data]);

  if (view.kind === "empty") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <EmptyDocIcon className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm">This document is empty</p>
        <p className="mt-1 text-xs opacity-60">Add some content to see the preview.</p>
      </div>
    );
  }

  // MDX error → show warning + markdown fallback
  if (error) {
    return (
      <div className="animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800 shadow-sm">
          <AlertIcon className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">MDX Compilation Error</span>
            <p className="mt-1 font-mono text-xs opacity-80">{error}</p>
            <p className="mt-3 text-xs italic opacity-60">Showing Markdown fallback below...</p>
          </div>
        </div>
        <div className="prose prose-neutral prose-blue max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{view.source}</Markdown>
        </div>
      </div>
    );
  }

  if (!Content) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-blue-600" />
        <p className="text-sm font-medium">Rendering document...</p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-700">
      <ErrorBoundary
        fallback={(err, reset) => (
          <RenderError error={err} source={view.source} onRetry={reset} />
        )}
      >
        <div className="prose prose-neutral prose-blue max-w-none
          prose-headings:scroll-mt-20 prose-headings:font-bold prose-headings:tracking-tight
          prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
          prose-pre:rounded-xl prose-pre:bg-neutral-900 prose-pre:shadow-lg
          prose-img:rounded-xl prose-img:shadow-md">
          <Content components={componentMap} />
        </div>
      </ErrorBoundary>
    </div>
  );
}

function EmptyDocIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  );
}

function RenderError({ error, source, onRetry }: { error: Error; source: string; onRetry: () => void }) {
  return (
    <div className="animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="mb-8 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm">
        <AlertIcon className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-bold">Render Error</span>
          <p className="mt-1 break-all font-mono text-xs opacity-80">{error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      </div>
      <div className="prose prose-neutral prose-blue max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown>
      </div>
    </div>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
