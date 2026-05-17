// Command palette — Cmd+K modal that enumerates all manifest-declared
// commands, filters them by query, and dispatches via the UI plugin host.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceCommandDescriptor,
  WorkspaceMenuItem,
} from "../api.ts";
import type { UiPluginHost } from "../plugins-host/host.ts";

interface Props {
  open: boolean;
  host: UiPluginHost;
  commands: readonly WorkspaceCommandDescriptor[];
  menu: readonly WorkspaceMenuItem[];
  onClose: () => void;
}

export function CommandPalette({ open, host, commands, menu, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restrict palette to commands listed in `commandPalette` menu (fall back to all).
  const visible = useMemo<WorkspaceCommandDescriptor[]>(() => {
    const ids = menu.length > 0 ? new Set(menu.map((m) => m.command)) : null;
    const all = ids ? commands.filter((c) => ids.has(c.id)) : commands;
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.category ?? "").toLowerCase().includes(q),
    );
  }, [commands, menu, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Focus the input on next paint.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (highlight >= visible.length) setHighlight(Math.max(0, visible.length - 1));
  }, [visible, highlight]);

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
                setHighlight((h) => Math.min(h + 1, visible.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const cmd = visible[highlight];
                if (cmd) void run(cmd);
              }
            }}
            placeholder="Type a command..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto py-1">
          {visible.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-neutral-400">No commands</li>
          )}
          {visible.map((cmd, i) => (
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
        </ul>
      </div>
    </div>
  );
}
