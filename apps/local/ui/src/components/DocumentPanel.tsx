import { useState, useEffect, useCallback, Fragment, type ComponentType } from "react";
import { Preview } from "./Preview.tsx";
import { DataPanel } from "./DataPanel.tsx";
import type { CodocDetail } from "../api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocMode = "edit" | "split" | "preview" | "data";

export interface DocumentPanelProps {
  codoc: CodocDetail;
  workspaceName: string;
  componentMap: Record<string, ComponentType<Record<string, unknown>>>;
  onSave: (content: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// DocumentPanel — center panel with breadcrumb, mode tabs, content, status bar
// ---------------------------------------------------------------------------

export function DocumentPanel({ codoc, workspaceName, componentMap, onSave }: DocumentPanelProps) {
  const [mode, setMode] = useState<DocMode>("preview");
  const [editValue, setEditValue] = useState(codoc.content);
  const [saving, setSaving] = useState(false);

  const dirty = editValue !== codoc.content;

  // Sync edit value when codoc changes externally
  useEffect(() => {
    setEditValue(codoc.content);
  }, [codoc.content]);

  // Reset to preview mode when switching codocs
  const [prevPath, setPrevPath] = useState(codoc.path);
  if (codoc.path !== prevPath) {
    setPrevPath(codoc.path);
    setMode("preview");
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(editValue);
    } finally {
      setSaving(false);
    }
  }, [editValue, onSave]);

  // Cmd/Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, handleSave]);

  // Breadcrumb
  const pathSegments = codoc.path.replace(/\.codoc$/, "").split("/");
  const breadcrumb = [workspaceName, ...pathSegments];

  // Stats
  const wordCount = codoc.content.split(/\s+/).filter(Boolean).length;
  const fieldCount = Object.keys(codoc.data).length;

  const modes: { id: DocMode; label: string; icon: React.ReactNode }[] = [
    { id: "edit", label: "Edit", icon: <PencilIcon /> },
    { id: "split", label: "Split", icon: <ColumnsIcon /> },
    { id: "preview", label: "Preview", icon: <EyeIcon /> },
    { id: "data", label: "Data", icon: <DatabaseIcon /> },
  ];

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 px-6 py-2.5 text-sm">
        {breadcrumb.map((seg, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRightIcon className="text-neutral-300" />}
            <span
              className={
                i === breadcrumb.length - 1
                  ? "font-semibold text-neutral-800 truncate"
                  : "text-neutral-400 truncate"
              }
            >
              {i === breadcrumb.length - 1
                ? codoc.meta.title ?? seg
                : seg}
            </span>
          </Fragment>
        ))}
      </div>

      {/* Mode tabs */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 pb-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-1">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                mode === m.id
                  ? "bg-white text-neutral-800 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
              onClick={() => setMode(m.id)}
            >
              <span className={mode === m.id ? "text-blue-600" : "text-neutral-400"}>
                {m.icon}
              </span>
              {m.label}
            </button>
          ))}
        </div>

        {codoc.meta.tags.length > 0 && (
          <div className="flex gap-1.5">
            {codoc.meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-medium text-neutral-500 uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {mode === "edit" && (
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-white p-8 font-mono text-sm leading-relaxed text-neutral-800 outline-none"
          />
        )}

        {mode === "split" && (
          <div className="flex h-full divide-x divide-neutral-200">
            <div className="flex-1 overflow-auto">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                spellCheck={false}
                className="h-full w-full resize-none bg-neutral-50/30 p-6 font-mono text-sm leading-relaxed text-neutral-800 outline-none"
              />
            </div>
            <div className="flex-1 overflow-auto p-8">
              <div className="prose prose-neutral prose-blue max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-pre:rounded-xl prose-pre:bg-neutral-900">
                <Preview view={codoc.view} data={codoc.data} componentMap={componentMap} />
              </div>
            </div>
          </div>
        )}

        {mode === "preview" && (
          <div className="h-full overflow-auto bg-neutral-50/30">
            <div className="mx-auto min-h-full max-w-3xl bg-white px-10 py-10 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
              <Preview view={codoc.view} data={codoc.data} componentMap={componentMap} />
            </div>
          </div>
        )}

        {mode === "data" && (
          <div className="h-full overflow-auto p-6">
            <DataPanel data={codoc.data} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 border-t border-neutral-200 px-6 py-2 text-xs text-neutral-400">
        <span>{wordCount.toLocaleString()} words</span>
        <Dot />
        <span>Codoc</span>
        {fieldCount > 0 && (
          <>
            <Dot />
            <span>{fieldCount} data field{fieldCount !== 1 ? "s" : ""}</span>
          </>
        )}
        {(mode === "edit" || mode === "split") && (
          <>
            <Dot />
            {dirty ? (
              saving ? (
                <span className="text-blue-500">Saving...</span>
              ) : (
                <span className="text-amber-500">Unsaved changes</span>
              )
            ) : (
              <span className="text-green-500">Saved</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-neutral-200">&middot;</span>;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
