// Browser-side MDX renderer.
//
// Takes raw MDX source + resolved data fields, compiles to React in
// the browser via @mdx-js/mdx, and renders with a provided component
// mapping. Data field references ({data.xxx}) are pre-resolved before
// compilation so the MDX source doesn't need scope injection.

import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

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
  const [error, setError] = useState<string | null>(null);

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
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setContent(null);
        }
      }
    }

    compileMdx();
    return () => { cancelled = true; };
  }, [source, data, components]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">MDX Render Error</p>
        <pre className="mt-2 text-xs text-destructive/80 whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Rendering…
      </div>
    );
  }

  return <div className="mdx-content">{content}</div>;
}
