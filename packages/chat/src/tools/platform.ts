// Platform tools — workspace-level operations available to all agents.
//
// Each tool closes over a `PlatformToolDeps` callback interface.
// The `runAgentTurn` use case in @cobook/service constructs these
// deps from `ServiceCtx`, keeping this module free of service-layer
// imports.

import type { Result } from "@cobook/core";
import { ok } from "@cobook/core";
import type { ToolId } from "@cobook/graph";
import type { ChatTool } from "../state/aliases.js";

// ---- Dependency interface ------------------------------------------------

export interface PlatformToolDeps {
  listCodocs(): Promise<unknown>;
  getCodoc(id: string): Promise<unknown>;
  createCodoc(input: {
    path?: string;
    title: string;
    content: string;
  }): Promise<unknown>;
  updateCodoc(input: {
    id: string;
    content: string;
  }): Promise<unknown>;
  deleteCodoc(id: string): Promise<unknown>;
  getWorkspaceStatus(): Promise<unknown>;
}

// ---- Tool factories ------------------------------------------------------

function listCodocsTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "listCodocs" as ToolId,
      name: "listCodocs",
      description:
        "List all codoc files in the current workspace. Returns id, title, description, and tags for each codoc.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(): Promise<Result<unknown, never>> {
      return ok(await deps.listCodocs());
    },
  };
}

function getCodocTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "getCodoc" as ToolId,
      name: "getCodoc",
      description:
        "Get a single codoc's full details: content, metadata, and resolved data.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The codoc id to retrieve",
          },
        },
        required: ["id"],
      },
    },
    async execute(input): Promise<Result<unknown, never>> {
      const { id } = input as { id: string };
      return ok(await deps.getCodoc(id));
    },
  };
}

function createCodocTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "createCodoc" as ToolId,
      name: "createCodoc",
      description:
        "Create a new codoc in the workspace with the given title and content.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path for the codoc, e.g. 'reviews/zhangsan-q2'. Use '/' to organize into directories. If omitted, derived from title.",
          },
          title: {
            type: "string",
            description: "Title for the new codoc",
          },
          content: {
            type: "string",
            description: "Full content of the codoc",
          },
        },
        required: ["title", "content"],
      },
    },
    async execute(input): Promise<Result<unknown, never>> {
      const { path, title, content } = input as {
        path?: string;
        title: string;
        content: string;
      };
      return ok(
        await deps.createCodoc({
          ...(path ? { path } : {}),
          title,
          content,
        }),
      );
    },
  };
}

function updateCodocTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "updateCodoc" as ToolId,
      name: "updateCodoc",
      description: "Update an existing codoc's content.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The codoc id to update",
          },
          content: {
            type: "string",
            description: "New content for the codoc",
          },
        },
        required: ["id", "content"],
      },
    },
    async execute(input): Promise<Result<unknown, never>> {
      const { id, content } = input as { id: string; content: string };
      return ok(await deps.updateCodoc({ id, content }));
    },
  };
}

function deleteCodocTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "deleteCodoc" as ToolId,
      name: "deleteCodoc",
      description: "Delete a codoc from the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The codoc id to delete",
          },
        },
        required: ["id"],
      },
    },
    async execute(input): Promise<Result<unknown, never>> {
      const { id } = input as { id: string };
      return ok(await deps.deleteCodoc(id));
    },
  };
}

function getWorkspaceStatusTool(deps: PlatformToolDeps): ChatTool {
  return {
    schema: {
      id: "getWorkspaceStatus" as ToolId,
      name: "getWorkspaceStatus",
      description:
        "Get workspace overview: total codoc count and status distribution.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(): Promise<Result<unknown, never>> {
      return ok(await deps.getWorkspaceStatus());
    },
  };
}

// ---- Public factory ------------------------------------------------------

export function createPlatformTools(
  deps: PlatformToolDeps,
): readonly ChatTool[] {
  return [
    listCodocsTool(deps),
    getCodocTool(deps),
    createCodocTool(deps),
    updateCodocTool(deps),
    deleteCodocTool(deps),
    getWorkspaceStatusTool(deps),
  ];
}
