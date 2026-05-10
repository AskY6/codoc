import { useState, useCallback } from "react";
import { publish } from "../lib/event-bus.ts";
import type { WorkspaceUiActionDescriptor } from "../api.ts";

export function WorkspaceActionBar({
  actions,
  onActionComplete,
}: {
  actions: readonly WorkspaceUiActionDescriptor[];
  onActionComplete?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const dispatch = useCallback(async (action: WorkspaceUiActionDescriptor) => {
    if (action.kind === "chat-prompt") {
      publish("send-prompt", { prompt: action.prompt });
      return;
    }

    setBusy(action.id);
    setResult(null);
    try {
      const res = await fetch(action.path, { method: action.method });
      const json = await res.json() as Record<string, unknown>;
      if (res.ok && json.ok !== false) {
        const msg = typeof json.message === "string" ? json.message : "Done";
        setResult({ id: action.id, ok: true, message: msg });
        onActionComplete?.();
      } else {
        const msg = typeof json.error === "string" ? json.error : `Failed (${res.status})`;
        setResult({ id: action.id, ok: false, message: msg });
      }
    } catch (e) {
      setResult({ id: action.id, ok: false, message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }, [onActionComplete]);

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={busy !== null}
          onClick={() => void dispatch(action)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-100 disabled:opacity-50"
        >
          {busy === action.id ? "..." : action.label}
        </button>
      ))}

      {result && (
        <span className={`ml-2 text-xs ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
