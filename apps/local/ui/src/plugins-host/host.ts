// UiPluginHost — owns the browser-side plugin lifecycle.
//
// Mirrors src/plugins-host/host.ts on the server: scans registered UI modules,
// invokes activateUi(ctx) when the workspace plugin id is known, and disposes
// every registration when the workspace switches.

import type { ComponentType } from "react";
import { publish } from "../lib/event-bus.ts";
import { uiPluginRegistry } from "./registry.ts";
import type {
  Disposable,
  UiActivateContext,
  UiCommandHandler,
  UiPluginModule,
} from "./types.ts";

type ComponentMap = Record<string, ComponentType<Record<string, unknown>>>;

export interface PluginCommandSnapshot {
  /** Locally-registered (UI) command IDs. */
  readonly local: ReadonlySet<string>;
}

export interface UiPluginHostListener {
  onComponentsChanged?(): void;
  onCommandsChanged?(): void;
}

export class UiPluginHost {
  private activePluginId: string | null = null;
  private localCommands = new Map<string, UiCommandHandler>();
  private mdxComponents = new Map<string, ComponentType<Record<string, unknown>>>();
  private disposables: Disposable[] = [];
  private listeners = new Set<UiPluginHostListener>();

  /** Activate the UI module registered for the given plugin id, if any. */
  async activate(opts: { pluginId: string; workspaceName: string; config: unknown }): Promise<void> {
    this.deactivate();

    this.activePluginId = opts.pluginId;

    const mod: UiPluginModule | undefined = uiPluginRegistry[opts.pluginId];
    if (!mod) return;

    const ctx: UiActivateContext = {
      workspaceName: opts.workspaceName,
      pluginId: opts.pluginId,
      config: opts.config,

      commands: {
        registerCommand: (id, handler) => {
          if (this.localCommands.has(id)) {
            console.warn(`[ui-plugin-host] re-registered UI command "${id}" — last wins`);
          }
          this.localCommands.set(id, handler);
          this.fireCommandsChanged();
          const d: Disposable = {
            dispose: () => {
              if (this.localCommands.get(id) === handler) {
                this.localCommands.delete(id);
                this.fireCommandsChanged();
              }
            },
          };
          this.disposables.push(d);
          return d;
        },
        executeCommand: (id, args) => this.executeCommand(id, args),
      },

      mdxComponents: {
        register: (name, component) => {
          this.mdxComponents.set(name, component);
          this.fireComponentsChanged();
          const d: Disposable = {
            dispose: () => {
              if (this.mdxComponents.get(name) === component) {
                this.mdxComponents.delete(name);
                this.fireComponentsChanged();
              }
            },
          };
          this.disposables.push(d);
          return d;
        },
      },

      chat: {
        openPrompt: (prompt) => publish("send-prompt", { prompt }),
      },
    };

    try {
      await mod.activateUi(ctx);
    } catch (e) {
      console.error(
        `[ui-plugin-host] activateUi("${opts.pluginId}") threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  deactivate(): void {
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.localCommands.clear();
    this.mdxComponents.clear();
    this.activePluginId = null;
    this.fireCommandsChanged();
    this.fireComponentsChanged();
  }

  /** Execute a command — local handler if registered, else POST to server. */
  async executeCommand(id: string, args?: unknown): Promise<unknown> {
    const local = this.localCommands.get(id);
    if (local) return local(args);

    if (!this.activePluginId) {
      throw new Error(`no active plugin for command "${id}"`);
    }

    const url = `/api/plugins/${encodeURIComponent(this.activePluginId)}/commands/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: args === undefined ? "" : JSON.stringify(args),
    });
    const text = await res.text();
    let json: { ok?: boolean; result?: unknown; error?: string } = {};
    try {
      json = text.length > 0 ? (JSON.parse(text) as typeof json) : {};
    } catch {
      throw new Error(`bad response from ${url}: ${text.slice(0, 100)}`);
    }
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `request failed (${res.status})`);
    }
    return json.result;
  }

  hasLocalCommand(id: string): boolean {
    return this.localCommands.has(id);
  }

  getMdxComponents(): ComponentMap {
    return Object.fromEntries(this.mdxComponents);
  }

  getMdxComponentNames(): readonly string[] {
    return [...this.mdxComponents.keys()];
  }

  addListener(l: UiPluginHostListener): Disposable {
    this.listeners.add(l);
    return { dispose: () => this.listeners.delete(l) };
  }

  private fireCommandsChanged(): void {
    for (const l of this.listeners) l.onCommandsChanged?.();
  }
  private fireComponentsChanged(): void {
    for (const l of this.listeners) l.onComponentsChanged?.();
  }
}
