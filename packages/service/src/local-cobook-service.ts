import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createDagEngine, createRuntimeContext, parseCodocText } from "@cobook/core";
import { loadWorkspace, toWorkspaceSnapshot, watchWorkspace } from "@cobook/workspace";

import type {
  BuildResult,
  InvalidationResult,
  ParsedCodoc,
  ResolveOptions,
  ResolvedValue
} from "@cobook/core";
import type { WorkspaceSnapshot } from "@cobook/workspace";

import type { ChatEvent, ChatInput } from "./ai/index.js";
import type {
  CobookService,
  WorkspaceDiagnostics,
  WorkspaceWatchEvent,
  WriteCodocInput,
  WriteCodocResult
} from "./cobook-service.js";
import { createLocalSourceExecutor } from "./source-executor/index.js";
import type { WorkspaceSession } from "./workspace-session.js";

export interface LocalCobookServiceOptions {
  chatHandler?: (input: ChatInput, service: CobookService) => AsyncIterable<ChatEvent>;
}

function workspaceNotOpen(): never {
  throw new Error("Workspace is not open.");
}

export class LocalCobookService implements CobookService {
  #session: WorkspaceSession | null = null;
  readonly #options: LocalCobookServiceOptions;

  constructor(options: LocalCobookServiceOptions = {}) {
    this.#options = options;
  }

  async openWorkspace(root: string): Promise<WorkspaceSnapshot> {
    const previousSession = this.#session;
    const previousWatchControllers =
      previousSession && previousSession.root === root
        ? previousSession.watchControllers
        : new Set<AbortController>();
    const workspace = await loadWorkspace(root);
    const sourceExecutor = createLocalSourceExecutor();
    const dag = createDagEngine({
      loadSource: (spec, context) =>
        sourceExecutor.resolve(spec, {
          workspaceRoot: workspace.root,
          node: context.node,
          codocFilePath: context.codocFilePath
        })
    });

    this.#session = {
      root: workspace.root,
      config: workspace.config,
      codocs: workspace.codocs,
      componentRegistry: workspace.componentRegistry,
      dag,
      runtime: createRuntimeContext(),
      sourceExecutor,
      lastBuild: null,
      watchControllers: previousWatchControllers
    };
    this.#session.lastBuild = this.#session.dag.build(Array.from(this.#session.codocs.values()));
    syncRuntimeState(this.#session);
    if (previousSession && previousSession.root !== workspace.root) {
      disposeSession(previousSession);
    }

    return toWorkspaceSnapshot(this.#session);
  }

  async closeWorkspace(): Promise<void> {
    disposeSession(this.#session);
    this.#session = null;
  }

  async getWorkspace(): Promise<WorkspaceSnapshot> {
    return toWorkspaceSnapshot(requireSession(this.#session));
  }

  async build() {
    const session = requireSession(this.#session);

    session.lastBuild = session.dag.build(Array.from(session.codocs.values()));
    syncRuntimeState(session);
    return session.lastBuild;
  }

  async rebuildCodoc(codocId: string): Promise<BuildResult> {
    const session = requireSession(this.#session);

    const existing = session.codocs.get(codocId);
    if (!existing) {
      throw new Error(`Codoc "${codocId}" was not found.`);
    }

    const raw = await readFile(join(session.root, existing.filePath), "utf8");
    const parsed = parseCodocText(existing.filePath, raw);
    const conflict = session.codocs.get(parsed.id);
    if (parsed.id !== codocId && conflict && conflict.filePath !== existing.filePath) {
      throw new Error(`Codoc id "${parsed.id}" already exists in the workspace.`);
    }

    session.codocs.delete(codocId);
    session.codocs.set(parsed.id, parsed);
    session.lastBuild = session.dag.rebuildCodoc(parsed);
    syncRuntimeState(session);

    return session.lastBuild;
  }

  async listCodocs() {
    const snapshot = await this.getWorkspace();
    return snapshot.codocs;
  }

  async readCodoc(codocId: string): Promise<ParsedCodoc> {
    const session = requireSession(this.#session);

    const codoc = session.codocs.get(codocId);
    if (!codoc) {
      throw new Error(`Codoc "${codocId}" was not found.`);
    }

    return codoc;
  }

  async writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult> {
    const session = requireSession(this.#session);

    const absolutePath = join(session.root, input.filePath);
    const flag = input.overwrite ? "w" : "wx";
    const previousFileState = await snapshotFileState(absolutePath);
    let wroteTargetFile = false;

    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.content, { encoding: "utf8", flag });
      wroteTargetFile = true;

      const parsed = parseCodocText(input.filePath, input.content);
      if (parsed.id !== input.codocId) {
        throw new Error(
          `Written codoc id "${parsed.id}" does not match requested id "${input.codocId}".`
        );
      }

      const existingAtPath = findCodocByFilePath(session.codocs, input.filePath);
      if (existingAtPath && existingAtPath.id !== parsed.id) {
        session.codocs.delete(existingAtPath.id);
      }

      const existingById = session.codocs.get(parsed.id);
      if (existingById && existingById.filePath !== input.filePath) {
        throw new Error(`Codoc id "${parsed.id}" already exists at "${existingById.filePath}".`);
      }

      session.codocs.set(parsed.id, parsed);
      session.lastBuild = session.dag.rebuildCodoc(parsed);
      syncRuntimeState(session);

      return {
        codocId: parsed.id,
        filePath: input.filePath,
        changed: true,
        build: session.lastBuild
      };
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (wroteTargetFile) {
        try {
          await restoreFileState(absolutePath, previousFileState);
          await this.openWorkspace(session.root);
        } catch (rollbackError) {
          const normalizedRollbackError =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
          throw new Error(
            `${normalizedError.message}\nWrite rollback failed: ${normalizedRollbackError.message}`
          );
        }
      }

      throw normalizedError;
    }
  }

  async invalidate(node: string): Promise<InvalidationResult> {
    const session = requireSession(this.#session);
    const result = session.dag.invalidate(node);

    for (const dirtiedNode of result.dirtiedNodes) {
      const previous = session.runtime.states.get(dirtiedNode);
      session.runtime.states.set(dirtiedNode, {
        status: "dirty",
        version: previous?.version ?? 0,
        value: previous?.value,
        error: previous?.error ?? null
      });
    }

    return result;
  }

  async resolve(node: string, opts?: ResolveOptions): Promise<ResolvedValue> {
    const session = requireSession(this.#session);
    ensureBuildSucceeded(session);

    const previous = session.runtime.states.get(node);
    session.runtime.states.set(node, {
      status: "computing",
      version: previous?.version ?? 0,
      value: previous?.value,
      error: null
    });

    try {
      const resolved = await session.dag.resolve(node, opts);
      session.runtime.states.set(node, {
        status: "ready",
        version: resolved.version,
        value: resolved.value,
        error: null
      });
      return resolved;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      session.runtime.states.set(node, {
        status: "error",
        version: (previous?.version ?? 0) + 1,
        value: previous?.value,
        error: normalizedError
      });
      throw normalizedError;
    }
  }

  async graph() {
    const session = requireSession(this.#session);

    return session.dag.snapshot();
  }

  async diagnostics(): Promise<WorkspaceDiagnostics> {
    const session = requireSession(this.#session);
    const graph = session.dag.snapshot();

    return {
      build: session.lastBuild,
      graph,
      nodes: graph.nodes.map((node) => ({
        node,
        state: session.runtime.states.get(node.id) ?? createIdleNodeState(),
        dependents: session.dag.getDependents(node.id)
      }))
    };
  }

  async *watch(signal?: AbortSignal): AsyncIterable<WorkspaceWatchEvent> {
    const session = requireSession(this.#session);
    const lifecycleController = new AbortController();
    const queue: WorkspaceWatchEvent[] = [];
    let wake: (() => void) | null = null;
    let watchError: Error | null = null;
    let stopped = lifecycleController.signal.aborted;

    const onAbort = () => {
      stopped = true;
      wake?.();
    };
    session.watchControllers.add(lifecycleController);

    const forwardAbort = () => {
      lifecycleController.abort(
        signal?.reason instanceof Error ? signal.reason : new Error("The operation was aborted.")
      );
    };
    if (signal?.aborted) {
      forwardAbort();
    } else {
      signal?.addEventListener("abort", forwardAbort, {
        once: true
      });
    }

    lifecycleController.signal.addEventListener("abort", onAbort, {
      once: true
    });

    const watcher = await watchWorkspace(
      session.root,
      session.config,
      async (change) => {
        if (stopped) {
          return;
        }

        try {
          const build = await this.applyWorkspaceChange(change);
          queue.push({
            change,
            build
          });
        } catch (error) {
          watchError = error instanceof Error ? error : new Error(String(error));
        } finally {
          wake?.();
        }
      },
      async (error) => {
        watchError = error;
        wake?.();
      }
    );

    try {
      while (!stopped) {
        if (queue.length === 0) {
          if (watchError) {
            throw watchError;
          }

          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          if (stopped) {
            break;
          }
          if (watchError) {
            throw watchError;
          }
        }

        while (queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield event;
          }
        }
      }
    } finally {
      session.watchControllers.delete(lifecycleController);
      signal?.removeEventListener("abort", forwardAbort);
      lifecycleController.signal.removeEventListener("abort", onAbort);
      watcher.close();
    }
  }

  async *chat(input: ChatInput): AsyncIterable<ChatEvent> {
    if (this.#options.chatHandler) {
      yield* this.#options.chatHandler(input, this);
      return;
    }

    yield {
      kind: "status",
      status: "thinking",
      message: "No chat handler was configured for this service."
    };
    yield {
      kind: "message",
      content: "Configure LocalCobookService with a base-agent chat handler to enable chat."
    };
    yield {
      kind: "status",
      status: "done"
    };
  }

  private async applyWorkspaceChange(change: { kind: string; path: string }): Promise<BuildResult> {
    const session = requireSession(this.#session);

    if (change.path === "cobook.yaml" || change.kind !== "updated") {
      await this.openWorkspace(session.root);
      return requireSession(this.#session).lastBuild ?? emptyBuildResult();
    }

    const changedCodoc = findCodocByFilePath(session.codocs, change.path);
    if (!changedCodoc) {
      await this.openWorkspace(session.root);
      return requireSession(this.#session).lastBuild ?? emptyBuildResult();
    }

    return this.rebuildCodoc(changedCodoc.id);
  }
}

function requireSession(session: WorkspaceSession | null): WorkspaceSession {
  return session ?? workspaceNotOpen();
}

function disposeSession(session: WorkspaceSession | null): void {
  if (!session) {
    return;
  }

  for (const controller of session.watchControllers) {
    controller.abort(new Error("Workspace session was closed."));
  }

  session.watchControllers.clear();
}

function ensureBuildSucceeded(session: WorkspaceSession): void {
  const buildResult =
    session.lastBuild ?? session.dag.build(Array.from(session.codocs.values()));

  session.lastBuild = buildResult;
  if (buildResult.success) {
    return;
  }

  const details = buildResult.errors
    .map((error) => `- [${error.code}] ${error.message}`)
    .join("\n");
  throw new Error(`Workspace build failed:\n${details}`);
}

function syncRuntimeState(session: WorkspaceSession): void {
  const liveNodes = new Set(session.dag.snapshot().nodes.map((node) => node.id));

  for (const nodeKey of Array.from(session.runtime.states.keys())) {
    if (!liveNodes.has(nodeKey)) {
      session.runtime.states.delete(nodeKey);
    }
  }
}

function createIdleNodeState() {
  return {
    status: "idle" as const,
    version: 0,
    value: undefined,
    error: null
  };
}

function emptyBuildResult(): BuildResult {
  return {
    success: true,
    errors: [],
    affectedNodes: []
  };
}

async function snapshotFileState(path: string): Promise<
  | {
      exists: true;
      content: string;
    }
  | {
      exists: false;
    }
> {
  try {
    return {
      exists: true,
      content: await readFile(path, "utf8")
    };
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return {
        exists: false
      };
    }

    throw error;
  }
}

async function restoreFileState(
  path: string,
  previousState:
    | {
        exists: true;
        content: string;
      }
    | {
        exists: false;
      }
): Promise<void> {
  if (previousState.exists) {
    await writeFile(path, previousState.content, "utf8");
    return;
  }

  try {
    await unlink(path);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function findCodocByFilePath(
  codocs: Map<string, ParsedCodoc>,
  filePath: string
): ParsedCodoc | null {
  for (const codoc of codocs.values()) {
    if (codoc.filePath === filePath) {
      return codoc;
    }
  }

  return null;
}
