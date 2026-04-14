// Browser-side MDX renderer.
//
// Takes raw MDX source + resolved data fields, compiles to React in
// the browser via @mdx-js/mdx, and renders with a provided component
// mapping. Data field references ({data.xxx}) are pre-resolved before
// compilation so the MDX source doesn't need scope injection.
//
// When MDX compilation fails (e.g. raw HTML with `class` instead of
// `className`), falls back to react-markdown which handles plain
// markdown gracefully.

import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";

export interface MdxRendererProps {
  source: string;
  data?: Record<string, unknown>;
  components?: Record<string, ComponentType<any>>;
}

/**
 * Inject `data` into the MDX module scope as a top-level export.
 *
 * Previous approach used regex to replace `{data.xxx}` patterns, but
 * that broke on complex expressions like `scores={{ key: data.xxx }}`.
 * Exporting `data` as a const makes all reference patterns work:
 *   - {data.xxx}, {data}, scores={data}, data.xxx inside {{ }}
 */
function injectDataExport(
  source: string,
  data: Record<string, unknown>,
): string {
  return `export const data = ${JSON.stringify(data)};\n\n${source}`;
}

export function MdxRenderer({ source, data, components }: MdxRendererProps) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function compileMdx() {
      try {
        const resolvedSource = data
          ? injectDataExport(source, data)
          : source;

        const mod = await evaluate(resolvedSource, {
          ...(runtime as any),
        });

        if (!cancelled) {
          const Content = mod.default;
          setContent(<Content {...(components ? { components } : {})} />);
          setFallback(false);
        }
      } catch {
        // MDX compilation failed (e.g. raw HTML with class= instead of
        // className=). Fall back to react-markdown which handles plain
        // markdown + strips unsupported HTML gracefully.
        if (!cancelled) {
          setFallback(true);
          setContent(null);
        }
      }
    }

    compileMdx();
    return () => { cancelled = true; };
  }, [source, data, components]);

  if (fallback) {
    return (
      <MdxErrorBoundary>
        <div className="mdx-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
        </div>
      </MdxErrorBoundary>
    );
  }

  if (!content) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Rendering…
      </div>
    );
  }

  return (
    <MdxErrorBoundary>
      <div className="mdx-content">{content}</div>
    </MdxErrorBoundary>
  );
}

class MdxErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MDX render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">MDX Render Error</p>
          <pre className="mt-2 text-xs text-destructive/80 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
