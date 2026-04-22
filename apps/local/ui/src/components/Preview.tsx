import { useState, useEffect, type ComponentType } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DataFieldInfo } from "../api.ts";

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
      <div className="flex h-full items-center justify-center text-neutral-400">
        No document body
      </div>
    );
  }

  // MDX error → show warning + markdown fallback
  if (error) {
    return (
      <div className="p-4">
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <span className="font-medium">MDX error:</span> {error}
        </div>
        <div className="prose prose-sm max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{view.source}</Markdown>
        </div>
      </div>
    );
  }

  if (!Content) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        Rendering…
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none p-4">
      <Content components={componentMap} />
    </div>
  );
}
