import type {
  ChatEvent,
  ChatInput,
  CobookService,
  WorkspaceDiagnostics,
  WorkspaceSnapshot,
  WorkspaceWatchEvent,
  WriteCodocInput,
  WriteCodocResult
} from "../cobook-service.js";
import type {
  BuildResult,
  CodocSummary,
  GraphSnapshot,
  InvalidationResult,
  ParsedCodoc,
  ResolveOptions,
  ResolvedValue
} from "../cobook-service.js";

import type { ServiceTransport } from "./types.js";
import type { WatchRpcNextResult } from "./types.js";

interface OpenWorkspaceRpcResult {
  sessionId: string;
  workspace: WorkspaceSnapshot;
}

export class RpcCobookService implements CobookService {
  readonly #transport: ServiceTransport;
  #requestId = 0;
  #watchId = 0;
  #sessionId: string | null = null;

  constructor(transport: ServiceTransport) {
    this.#transport = transport;
  }

  async openWorkspace(root: string): Promise<WorkspaceSnapshot> {
    await this.closeWorkspace();

    const opened = await this.send<OpenWorkspaceRpcResult>("openWorkspace", {
      root
    });
    this.#sessionId = opened.sessionId;
    return opened.workspace;
  }

  async closeWorkspace(): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) {
      return;
    }

    this.#sessionId = null;
    await this.send("closeWorkspace", {
      sessionId
    });
  }

  async getWorkspace(): Promise<WorkspaceSnapshot> {
    return this.send("getWorkspace", this.sessionParams());
  }

  async build(): Promise<BuildResult> {
    return this.send("build", this.sessionParams());
  }

  async rebuildCodoc(codocId: string): Promise<BuildResult> {
    return this.send("rebuildCodoc", this.sessionParams({ codocId }));
  }

  async listCodocs(): Promise<CodocSummary[]> {
    return this.send("listCodocs", this.sessionParams());
  }

  async readCodoc(codocId: string): Promise<ParsedCodoc> {
    return this.send("readCodoc", this.sessionParams({ codocId }));
  }

  async writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult> {
    return this.send("writeCodoc", this.sessionParams(input));
  }

  async invalidate(node: string): Promise<InvalidationResult> {
    return this.send("invalidate", this.sessionParams({ node }));
  }

  async resolve(node: string, _opts?: ResolveOptions): Promise<ResolvedValue> {
    return this.send("resolve", this.sessionParams({ node }));
  }

  async graph(): Promise<GraphSnapshot> {
    return this.send("graph", this.sessionParams());
  }

  async diagnostics(): Promise<WorkspaceDiagnostics> {
    return this.send("diagnostics", this.sessionParams());
  }

  async *watch(signal?: AbortSignal): AsyncIterable<WorkspaceWatchEvent> {
    const sessionId = this.requireSessionId();
    const watchId = `watch-${this.#watchId++}`;
    let started = false;
    const abortPromise = createAbortPromise(signal);

    try {
      await this.send("watchStart", {
        sessionId,
        watchId
      });
      started = true;

      while (true) {
        const next = (await Promise.race([
          this.send<WatchRpcNextResult>("watchNext", {
            sessionId,
            watchId
          }),
          abortPromise
        ])) as WatchRpcNextResult;

        if (next.done) {
          break;
        }

        yield next.event as WorkspaceWatchEvent;
      }
    } finally {
      if (started) {
        try {
          await this.send("watchStop", {
            sessionId,
            watchId
          });
        } catch {
          // Ignore teardown errors on already-closed watch sessions.
        }
      }
    }
  }

  async *chat(input: ChatInput): AsyncIterable<ChatEvent> {
    const events = await this.send<ChatEvent[]>("chat", this.sessionParams(input));

    for (const event of events) {
      yield event;
    }
  }

  private sessionParams<T extends object>(params?: T): { sessionId: string } & T {
    return {
      sessionId: this.requireSessionId(),
      ...(params ?? ({} as T))
    };
  }

  private requireSessionId(): string {
    if (!this.#sessionId) {
      throw new Error("Workspace is not open.");
    }

    return this.#sessionId;
  }

  private async send<TResult>(method: string, params?: unknown): Promise<TResult> {
    const response = await this.#transport.send<TResult>({
      id: `rpc-${this.#requestId++}`,
      method: method as never,
      ...(params !== undefined ? { params } : {})
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.result;
  }
}

function createAbortPromise(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    return new Promise<never>(() => {});
  }

  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error("The operation was aborted.")
    );
  }

  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("The operation was aborted.")
        );
      },
      {
        once: true
      }
    );
  });
}
