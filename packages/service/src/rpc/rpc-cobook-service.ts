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

export class RpcCobookService implements CobookService {
  readonly #transport: ServiceTransport;
  #requestId = 0;

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

  async *watch(_signal?: AbortSignal): AsyncIterable<WorkspaceWatchEvent> {
    throw new Error("RPC watch transport is not implemented yet.");
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
