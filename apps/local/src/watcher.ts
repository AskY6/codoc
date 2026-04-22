// watcher — watches source .codoc files and triggers recompile on change.

import { watch } from "chokidar";
import type { Workspace } from "./workspace.js";
import { loadFile, removeFile, resolveAll, compileAll, loadComponents } from "./workspace.js";

export interface WatcherOptions {
  readonly debounceMs?: number;
}

/**
 * Start watching the workspace source directory for .codoc file changes.
 * On any change: reload → re-resolve → recompile affected files.
 */
export function startWatcher(
  ws: Workspace,
  options?: WatcherOptions,
): { close: () => Promise<void> } {
  const debounceMs = options?.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let needsRebuild = false;

  async function rebuild(): Promise<void> {
    if (pending) {
      needsRebuild = true;
      return;
    }
    pending = true;
    try {
      await resolveAll(ws);
      await compileAll(ws);
      console.log(`[codoc] compiled ${ws.codocs.size} codoc(s)`);
    } catch (e) {
      console.error("[codoc] compile error:", e);
    } finally {
      pending = false;
      if (needsRebuild) {
        needsRebuild = false;
        scheduleRebuild();
      }
    }
  }

  function scheduleRebuild(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), debounceMs);
  }

  // Watch the directory itself (not a glob). Chokidar v4 with glob patterns
  // uses literal string matching in _handleRead, which fails to detect new files.
  // Filter by .codoc extension in the event handlers instead.
  const watcher = watch(ws.sourceDir, {
    ignoreInitial: true,
  });

  function handleCodocEvent(absPath: string, action: () => void | Promise<void>): void {
    if (absPath.endsWith(".codoc")) {
      void Promise.resolve(action()).then(scheduleRebuild);
    } else if (absPath.endsWith(".tsx")) {
      void loadComponents(ws).then(() => {
        console.log(`[codoc] reloaded custom components`);
      });
    }
  }

  watcher.on("add", (absPath) => {
    handleCodocEvent(absPath, () => loadFile(ws, absPath));
  });

  watcher.on("change", (absPath) => {
    handleCodocEvent(absPath, () => loadFile(ws, absPath));
  });

  watcher.on("unlink", (absPath) => {
    handleCodocEvent(absPath, () => {
      if (absPath.endsWith(".codoc")) {
        removeFile(ws, absPath);
      }
    });
  });

  return {
    close: () => watcher.close(),
  };
}
