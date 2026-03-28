"use client";

import { useEffect, useState, useMemo } from "react";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { CurrentDocProvider } from "@/hooks/use-current-doc";
import { getStore } from "@/hooks/use-workspace";
import { fetchDoc, forceDoc, fieldAction } from "@/lib/api";
import { getMdxComponents } from "./mdx-components";

interface DocViewProps {
  docId: string;
}

export function DocView({ docId }: DocViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string>("");
  const [MdxContent, setMdxContent] = useState<React.ComponentType | null>(null);

  // Load doc data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setMdxContent(null);

    fetchDoc(docId)
      .then((snapshot) => {
        getStore().hydrateDoc(snapshot);
        setView(snapshot.view);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [docId]);

  // Compile MDX when view changes
  useEffect(() => {
    if (!view) return;

    let cancelled = false;

    (async () => {
      try {
        const { default: Content } = await evaluate(view, {
          ...(runtime as any),
          useMDXComponents: getMdxComponents,
        });
        if (!cancelled) setMdxContent(() => Content);
      } catch (e) {
        if (!cancelled) {
          setError(`MDX compile error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [view]);

  const handleForce = () => {
    forceDoc(docId).catch(console.error);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading {docId}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <p className="font-medium">Error loading {docId}</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <CurrentDocProvider value={docId}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-sm font-medium font-mono">{docId}</h2>
          <button
            onClick={handleForce}
            className="text-xs px-2 py-1 rounded border hover:bg-secondary transition-colors"
          >
            Force All
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6 prose prose-sm max-w-none">
          {MdxContent && <MdxContent />}
        </div>
      </div>
    </CurrentDocProvider>
  );
}
