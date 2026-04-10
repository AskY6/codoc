import type Anthropic from "@anthropic-ai/sdk";
import type { AgentContext } from "./types.js";

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic format)
// ---------------------------------------------------------------------------

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "listCodocs",
    description:
      "List all codoc files in the current workspace. Returns path, nodeState, and meta (title, description, tags) for each codoc.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "getCodoc",
    description:
      "Get a single codoc's full details: AST, resolved data, and node state.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path of the codoc file, e.g. 'notes/meeting.codoc'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "getWorkspaceStatus",
    description:
      "Get workspace overview: total codoc count and node state distribution (how many ready/dirty/error).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "createCodoc",
    description:
      "Create a new codoc file in the workspace. This writes the file, parses it, and triggers a rebuild.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path for the new codoc, e.g. 'summary.codoc'",
        },
        content: {
          type: "string",
          description: "Full YAML content of the codoc file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "updateCodoc",
    description:
      "Update an existing codoc file's content. Triggers incremental rebuild and downstream invalidation.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path of the codoc to update",
        },
        content: {
          type: "string",
          description: "New full YAML content",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "deleteCodoc",
    description:
      "Delete a codoc file from the workspace. Triggers rebuild to update the DAG.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path of the codoc to delete",
        },
      },
      required: ["path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor — maps tool name + input to service calls
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS = 10;

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<unknown> {
  switch (name) {
    case "listCodocs": {
      return await ctx.service.listCodocs(ctx.workspaceId);
    }

    case "getCodoc": {
      const path = String(input["path"]);
      const info = await ctx.service.getCodoc(ctx.workspaceId, path);
      if (!info) return { error: `Codoc not found: ${path}` };
      return info;
    }

    case "getWorkspaceStatus": {
      return await ctx.service.getStatus(ctx.workspaceId);
    }

    case "createCodoc": {
      const path = String(input["path"]);
      const content = String(input["content"]);
      await ctx.service.createCodoc(ctx.workspaceId, path, content);
      return { ok: true, path };
    }

    case "updateCodoc": {
      const path = String(input["path"]);
      const content = String(input["content"]);
      await ctx.service.updateCodoc(ctx.workspaceId, path, content);
      return { ok: true, path };
    }

    case "deleteCodoc": {
      const path = String(input["path"]);
      await ctx.service.deleteCodoc(ctx.workspaceId, path);
      return { ok: true, path };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export { MAX_TOOL_CALLS };
