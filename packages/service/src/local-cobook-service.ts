import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createRuntimeContext, createUnimplementedDagEngine, parseCodocText } from "@cobook/core";
import { loadWorkspace, toWorkspaceSnapshot } from "@cobook/workspace";

import type { BuildResult, ParsedCodoc, ResolveOptions, ResolvedValue } from "@cobook/core";
import type { WorkspaceSnapshot } from "@cobook/workspace";

import type { ChatEvent, ChatInput } from "./ai/index.js";
import type { CobookService, WriteCodocInput, WriteCodocResult } from "./cobook-service.js";
import type { WorkspaceSession } from "./workspace-session.js";

function workspaceNotOpen(): never {
  throw new Error("Workspace is not open.");
}

function unimplemented(method: string): never {
  throw new Error(`LocalCobookService.${method} is not implemented yet.`);
}

export class LocalCobookService implements CobookService {
  #session: WorkspaceSession | null = null;

  async openWorkspace(root: string): Promise<WorkspaceSnapshot> {
    const workspace = await loadWorkspace(root);

    this.#session = {
      root: workspace.root,
      config: workspace.config,
      codocs: workspace.codocs,
      dag: createUnimplementedDagEngine(),
      runtime: createRuntimeContext()
    };

    return toWorkspaceSnapshot(this.#session);
  }

  async getWorkspace(): Promise<WorkspaceSnapshot> {
    if (!this.#session) {
      workspaceNotOpen();
    }

    return toWorkspaceSnapshot(this.#session);
  }

  async build() {
    if (!this.#session) {
      workspaceNotOpen();
    }

    return this.#session.dag.build(Array.from(this.#session.codocs.values()));
  }

  async rebuildCodoc(_codocId: string): Promise<BuildResult> {
    if (!this.#session) {
      workspaceNotOpen();
    }

    const existing = this.#session.codocs.get(_codocId);
    if (!existing) {
      throw new Error(`Codoc "${_codocId}" was not found.`);
    }

    const raw = await readFile(join(this.#session.root, existing.filePath), "utf8");
    const parsed = parseCodocText(existing.filePath, raw);

    this.#session.codocs.delete(_codocId);
    this.#session.codocs.set(parsed.id, parsed);

    return this.#session.dag.rebuildCodoc(parsed);
  }

  async listCodocs() {
    const snapshot = await this.getWorkspace();
    return snapshot.codocs;
  }

  async readCodoc(_codocId: string): Promise<ParsedCodoc> {
    if (!this.#session) {
      workspaceNotOpen();
    }

    const codoc = this.#session.codocs.get(_codocId);
    if (!codoc) {
      throw new Error(`Codoc "${_codocId}" was not found.`);
    }

    return codoc;
  }

  async writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult> {
    if (!this.#session) {
      workspaceNotOpen();
    }

    const absolutePath = join(this.#session.root, input.filePath);
    const flag = input.overwrite ? "w" : "wx";

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.content, { encoding: "utf8", flag });

    const parsed = parseCodocText(input.filePath, input.content);
    if (parsed.id !== input.codocId) {
      throw new Error(
        `Written codoc id "${parsed.id}" does not match requested id "${input.codocId}".`
      );
    }

    this.#session.codocs.set(parsed.id, parsed);

    return {
      codocId: parsed.id,
      filePath: input.filePath,
      changed: true
    };
  }

  async resolve(_node: string, _opts?: ResolveOptions): Promise<ResolvedValue> {
    return unimplemented("resolve");
  }

  async graph() {
    if (!this.#session) {
      workspaceNotOpen();
    }

    return this.#session.dag.snapshot();
  }

  async *chat(_input: ChatInput): AsyncIterable<ChatEvent> {
    yield {
      kind: "status",
      status: "thinking",
      message: "Chat flow is not implemented yet."
    };
    yield {
      kind: "message",
      content: "Base agent and chat orchestration are not implemented yet."
    };
    yield {
      kind: "status",
      status: "done"
    };
  }
}
