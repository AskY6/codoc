// Action bar — renders manifest-declared commands listed in
// menus["workspace.actionBar"] and dispatches via the UI plugin host.
//
// The bar is generic: it knows nothing about RSS or any specific plugin.
// Each button's onClick → host.executeCommand(id), which routes locally
// for UI-registered commands and falls through to
// POST /api/plugins/<id>/commands/<id> for server-registered ones.

import { useState, useCallback } from "react";
import type {
  WorkspaceCommandDescriptor,
  WorkspaceMenuItem,
} from "../api.ts";
import type { UiPluginHost } from "../plugins-host/host.ts";

interface Props {
  host: UiPluginHost;
  commands: readonly WorkspaceCommandDescriptor[];
  menu: readonly WorkspaceMenuItem[];
  onActionComplete?: () => void;
}

export function WorkspaceActionBar({ host, commands, menu, onActionComplete }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const cmdById = new Map(commands.map((c) => [c.id, c]));

  const dispatch = useCallback(
    async (id: string) => {
      const cmd = cmdById.get(id);
      const label = cmd?.title ?? id;

      setBusy(id);
      setFeedback(null);
      try {
        const result = await host.executeCommand(id);
        const message =
          result && typeof result === "object" && "message" in result &&
          typeof (result as { message: unknown }).message === "string"
            ? (result as { message: string }).message
            : `${label} done`;
        setFeedback({ id, ok: true, message });
        onActionComplete?.();
      } catch (e) {
        setFeedback({
          id,
          ok: false,
          message: e instanceof Error ? e.message : "Command failed",
        });
      } finally {
        setBusy(null);
      }
    },
    [cmdById, host, onActionComplete],
  );

  if (menu.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
      {menu.map((item) => {
        const cmd = cmdById.get(item.command);
        if (!cmd) return null;
        return (
          <button
            key={item.command}
            type="button"
            disabled={busy !== null}
            onClick={() => void dispatch(item.command)}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-100 disabled:opacity-50"
          >
            {busy === item.command ? "..." : cmd.title}
          </button>
        );
      })}

      {feedback && (
        <span className={`ml-2 text-xs ${feedback.ok ? "text-green-600" : "text-red-600"}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}
