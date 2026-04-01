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

export class RpcCobookService implements CobookService {
  readonly #transport: ServiceTransport;
  #requestId = 0;
  #watchId = 0;

  constructor(transport: ServiceTransport) {
    this.#transport = transport;
  }

  async openWorkspace(root: string): Promise<WorkspaceSnapshot> {
    return this.send("openWorkspace", {
      root
    });
  }

  async getWorkspace(): Promise<WorkspaceSnapshot> {
    return this.send("getWorkspace");
  }

  async build(): Promise<BuildResult> {
    return this.send("build");
  }

  async rebuildCodoc(codocId: string): Promise<BuildResult> {
    return this.send("rebuildCodoc", {
      codocId
    });
  }

  async listCodocs(): Promise<CodocSummary[]> {
    return this.send("listCodocs");
  }

  async readCodoc(codocId: string): Promise<ParsedCodoc> {
    return this.send("readCodoc", {
      codocId
    });
  }

  async writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult> {
    return this.send("writeCodoc", input);
  }

  async invalidate(node: string): Promise<InvalidationResult> {
    return this.send("invalidate", {
      node
    });
  }

  async resolve(node: string, _opts?: ResolveOptions): Promise<ResolvedValue> {
    return this.send("resolve", {
      node
    });
  }

  async graph(): Promise<GraphSnapshot> {
    return this.send("graph");
  }

  async diagnostics(): Promise<WorkspaceDiagnostics> {
    return this.send("diagnostics");
  }

  async *watch(signal?: AbortSignal): AsyncIterable<WorkspaceWatchEvent> {
    const watchId = `watch-${this.#watchId++}`;
    let started = false;
    const abortPromise = createAbortPromise(signal);

    try {
      await this.send("watchStart", {
        watchId
      });
      started = true;

      while (true) {
        const next = (await Promise.race([
          this.send<WatchRpcNextResult>("watchNext", {
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
            watchId
          });
        } catch {
          // Ignore teardown errors on already-closed watch sessions.
        }
      }
    }
  }

  async *chat(input: ChatInput): AsyncIterable<ChatEvent> {
    const events = await this.send<ChatEvent[]>("chat", input);

    for (const event of events) {
      yield event;
    }
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
