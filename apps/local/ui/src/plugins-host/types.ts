// UI activate context — the browser-side analog of `ActivateContext`
// from src/plugins-host/context.ts. v1 surface is intentionally small:
// commands, MDX components, and a chat helper.

import type { ComponentType } from "react";

export interface Disposable {
  dispose(): void;
}

export type UiCommandHandler = (args?: unknown) => unknown | Promise<unknown>;

export interface UiActivateContext<C = unknown> {
  readonly workspaceName: string;
  readonly pluginId: string;
  readonly config: C;

  readonly commands: {
    registerCommand(id: string, handler: UiCommandHandler): Disposable;
    executeCommand(id: string, args?: unknown): Promise<unknown>;
  };

  readonly mdxComponents: {
    register(name: string, component: ComponentType<Record<string, unknown>>): Disposable;
  };

  /** Open the chat panel with a pre-filled prompt; user still hits enter. */
  readonly chat: {
    openPrompt(prompt: string): void;
  };
}

/** A plugin's UI module — what plugins/<id>/ui/index.ts contributes back. */
export interface UiPluginModule {
  readonly pluginId: string;
  activateUi(ctx: UiActivateContext): void | Promise<void>;
}
