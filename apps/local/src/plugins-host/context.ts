// ActivateContext — runtime handle passed to each plugin's activate(ctx).
//
// Compared to v1's WorkspacePluginContext, this surface is push-based: the
// plugin calls `ctx.routes.use(router)`, `ctx.jobs.start(name, fn)`, etc.
// Each registration returns a Disposable; the host bundles them into a
// DisposableStore and tears down when the workspace closes.

import type { EventEmitter } from "node:events";
import type { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Workspace } from "../domain/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Disposable } from "./disposable.js";
import { DisposableStore, toDisposable } from "./disposable.js";

// ---------------------------------------------------------------------------
// Job handle — kept simple; jobs are stoppable functions, not classes.
// ---------------------------------------------------------------------------

export interface JobHandle {
  /** Optional readiness signal (e.g. first-tick complete). */
  readonly ready?: Promise<void>;
  stop(): void;
}

export type JobFn = () => JobHandle;

// ---------------------------------------------------------------------------
// Update event (mirrors http.ts UpdateEvent — declared here to avoid cycles)
// ---------------------------------------------------------------------------

export interface UpdateEvent {
  readonly kind: "source-refreshed" | "codoc-updated" | "codoc-deleted";
  readonly codocPath?: string;
}

// ---------------------------------------------------------------------------
// ActivateContext
// ---------------------------------------------------------------------------

export interface ActivateContext<C = unknown> {
  // Identity
  readonly workspaceName: string;
  readonly pluginId: string;

  // Typed config (host already validated)
  readonly config: C;

  // Direct workspace handle (Phase 2: re-use existing Workspace type as-is).
  // §4.3's typed workspace.read/write/list API is a Phase 4 follow-up.
  readonly workspace: Workspace;

  // MCP tool registration. `paramsSchema` is forwarded verbatim to the MCP
  // SDK, which expects a Zod raw shape (Record<string, ZodType>). The host
  // doesn't constrain the shape — plugins import zod themselves.
  readonly mcp: {
    registerTool(
      name: string,
      description: string,
      paramsSchema: Record<string, unknown>,
      handler: (args: unknown, extra: unknown) => unknown | Promise<unknown>,
    ): Disposable;
  };

  // HTTP routes mounted at /api/plugins/<pluginId>
  readonly routes: {
    use(router: Hono): Disposable;
  };

  // Background jobs
  readonly jobs: {
    start(name: string, fn: JobFn): Disposable;
  };

  // Chat / provider registry
  readonly providers: ProviderRegistry;

  // SSE bus — plugins emit, host fans out
  readonly updates: EventEmitter;

  // Disposable bag — push anything else here
  readonly subscriptions: DisposableStore;
}

// ---------------------------------------------------------------------------
// Activation result — collected after activate() returns
// ---------------------------------------------------------------------------

export interface ActivationResult {
  readonly store: DisposableStore;
  router: Hono | null;
  readonly jobs: JobHandle[];
}

export interface BuildContextOptions<C = unknown> {
  readonly workspaceName: string;
  readonly pluginId: string;
  readonly config: C;
  readonly workspace: Workspace;
  readonly providers: ProviderRegistry;
  readonly updates: EventEmitter;
  readonly mcpServer: McpServer | null;
}

export interface ContextHandle<C = unknown> {
  readonly ctx: ActivateContext<C>;
  readonly result: ActivationResult;
}

export function buildActivateContext<C>(
  opts: BuildContextOptions<C>,
): ContextHandle<C> {
  const result: ActivationResult = {
    store: new DisposableStore(),
    router: null,
    jobs: [],
  };

  const ctx: ActivateContext<C> = {
    workspaceName: opts.workspaceName,
    pluginId: opts.pluginId,
    config: opts.config,
    workspace: opts.workspace,
    providers: opts.providers,
    updates: opts.updates,
    subscriptions: result.store,

    mcp: {
      registerTool(name, description, paramsSchema, handler) {
        if (!opts.mcpServer) return toDisposable(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (opts.mcpServer.tool as any)(name, description, paramsSchema, handler);
        // MCP SDK has no per-tool deregister; teardown happens by replacing
        // the McpServer when workspace closes.
        return toDisposable(() => {});
      },
    },

    routes: {
      use(r) {
        if (result.router) {
          console.warn(
            `[plugin-host] plugin "${opts.pluginId}" registered routes twice — last wins`,
          );
        }
        result.router = r;
        return toDisposable(() => {
          if (result.router === r) result.router = null;
        });
      },
    },

    jobs: {
      start(name, fn) {
        const handle = fn();
        result.jobs.push(handle);
        const stopper = toDisposable(() => {
          try {
            handle.stop();
          } catch (e) {
            console.warn(
              `[plugin-host] job "${name}" stop threw: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
        result.store.add(stopper);
        return stopper;
      },
    },
  };

  return { ctx, result };
}
