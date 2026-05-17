// Command palette — Cmd+K modal that enumerates manifest-declared commands,
// filters them by query, and dispatches via the UI plugin host. Commands
// from inactive plugins (Phase 5) appear in a separate section and are
// disabled: v1 keeps one plugin per workspace, so you have to switch
// workspaces to use them.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AllPluginCommandDescriptor,
  WorkspaceCommandDescriptor,
  WorkspaceMenuItem,
} from "../api.ts";
import type { UiPluginHost } from "../plugins-host/host.ts";

interface Props {
  open: boolean;
  host: UiPluginHost;
  commands: readonly WorkspaceCommandDescriptor[];
  menu: readonly WorkspaceMenuItem[];
  /** Phase 5: cross-plugin commands. Inactive ones render disabled. */
  allCommands?: readonly AllPluginCommandDescriptor[];
  activePluginId?: string;
  onClose: () => void;
}

export function CommandPalette({
  open,
  host,
  commands,
  menu,
  allCommands = [],
  activePluginId,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Active-plugin commands (clickable) — same shape as before.
  const activeVisible = useMemo<WorkspaceCommandDescriptor[]>(() => {
    const ids = menu.length > 0 ? new Set(menu.map((m) => m.command)) : null;
    const all = ids ? commands.filter((c) => ids.has(c.id)) : commands;
    return filterByQuery(all, query);
  }, [commands, menu, query]);

  // Inactive-plugin commands (disabled, listed below).
  const inactiveVisible = useMemo<AllPluginCommandDescriptor[]>(() => {
    if (!activePluginId) return [];
    const inactive = allCommands.filter((c) => c.pluginId !== activePluginId);
    return filterByQuery(inactive, query);
  }, [allCommands, activePluginId, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Only active commands are reachable via keyboard.
  useEffect(() => {
    if (highlight >= activeVisible.length) {
      setHighlight(Math.max(0, activeVisible.length - 1));
    }
  }, [activeVisible, highlight]);

  if (!open) return null;

  const run = async (cmd: WorkspaceCommandDescriptor) => {
    onClose();
    try {
      await host.executeCommand(cmd.id);
    } catch (e) {
      console.error(`[command-palette] ${cmd.id} failed:`, e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-100 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, activeVisible.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const cmd = activeVisible[highlight];
                if (cmd) void run(cmd);
              }
            }}
            placeholder="Type a command..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto py-1">
          {activeVisible.length === 0 && inactiveVisible.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-neutral-400">No commands</li>
          )}
          {activeVisible.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => void run(cmd)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  i === highlight ? "bg-blue-50 text-blue-700" : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <span>{cmd.title}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-400">
                  {cmd.id}
                </span>
              </button>
            </li>
          ))}

          {inactiveVisible.length > 0 && (
            <>
              <li className="mt-1 border-t border-neutral-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Other plugins
              </li>
              {inactiveVisible.map((cmd) => (
                <li key={`${cmd.pluginId}:${cmd.id}`}>
                  <div
                    className="flex w-full cursor-not-allowed items-center justify-between px-3 py-2 text-left text-sm text-neutral-400"
                    title={`Open a "${cmd.pluginId}" workspace to use this command`}
                  >
                    <span>{cmd.title}</span>
                    <span className="text-[10px] uppercase tracking-wider">
                      {cmd.pluginId}
                    </span>
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

function filterByQuery<T extends { id: string; title: string; category?: string }>(
  items: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) return [...items];
  const q = query.toLowerCase();
  return items.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.category ?? "").toLowerCase().includes(q),
  );
}
