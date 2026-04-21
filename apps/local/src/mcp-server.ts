// mcp-server — MCP tool server exposing codoc operations to Claude Code.
//
// Runs on stdio transport. Claude Code connects to this as an MCP server
// and gains tools to read, write, list, and search codocs.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { writeCodoc, buildAstMap } from "./workspace.js";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { buildDAG, checkCycles } from "@cobook/core";

export function createMcpServer(ws: Workspace): McpServer {
  const server = new McpServer({
    name: "codoc-local",
    version: "0.0.1",
  });

  // ---- Tool: list_codocs ---------------------------------------------------

  server.tool(
    "list_codocs",
    "List all codocs in the workspace with their paths and titles",
    {},
    async () => {
      const items = Array.from(ws.codocs.values()).map((c) => ({
        path: c.path,
        title: c.ast.meta.title,
        hasData: c.ast.data.size > 0,
        hasView: c.ast.view.kind === "mdx",
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
      };
    },
  );

  // ---- Tool: read_codoc ----------------------------------------------------

  server.tool(
    "read_codoc",
    "Read a codoc's source content and resolved data",
    { path: z.string().describe("Workspace-relative path, e.g. 'notes/meeting.codoc'") },
    async ({ path }) => {
      const codocPath = mkCodocPath(path);
      const codoc = ws.codocs.get(codocPath);

      if (!codoc) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      const result = {
        path: codoc.path,
        title: codoc.ast.meta.title,
        content: codoc.content,
        resolvedData: codoc.resolvedData,
        meta: {
          description: codoc.ast.meta.description,
          tags: [...codoc.ast.meta.tags],
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ---- Tool: write_codoc ---------------------------------------------------

  server.tool(
    "write_codoc",
    "Write or update a codoc file. Content is the full source (YAML frontmatter + MDX body).",
    {
      path: z.string().describe("Workspace-relative path, e.g. 'reviews/alice-q1.codoc'"),
      content: z.string().describe("Full codoc source content"),
    },
    async ({ path, content }) => {
      const codocPath = mkCodocPath(path);
      const result = await writeCodoc(ws, codocPath, content);

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Written and compiled: ${path}` }],
      };
    },
  );

  // ---- Tool: search_codocs -------------------------------------------------

  server.tool(
    "search_codocs",
    "Search codocs by keyword in content, title, or tags",
    { query: z.string().describe("Search keyword") },
    async ({ query }) => {
      const lower = query.toLowerCase();
      const matches: Array<{ path: string; title: string | null; matchIn: string }> = [];

      for (const codoc of ws.codocs.values()) {
        const matchIn: string[] = [];
        if (codoc.content.toLowerCase().includes(lower)) matchIn.push("content");
        if (codoc.ast.meta.title?.toLowerCase().includes(lower)) matchIn.push("title");
        if (codoc.ast.meta.tags.some((t) => t.toLowerCase().includes(lower))) matchIn.push("tags");

        if (matchIn.length > 0) {
          matches.push({ path: codoc.path, title: codoc.ast.meta.title, matchIn: matchIn.join(", ") });
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(matches, null, 2) }],
      };
    },
  );

  // ---- Tool: dag_status ----------------------------------------------------

  server.tool(
    "dag_status",
    "Check the workspace DAG for broken refs and cycles",
    {},
    async () => {
      const astMap = buildAstMap(ws);
      const dagResult = buildDAG(astMap);

      if (!dagResult.ok) {
        const errors = dagResult.error.map((e) => ({
          from: `${e.fromCodoc}#data.${e.fromField}`,
          target: e.target,
        }));
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ok: false, unknownTargets: errors }, null, 2),
          }],
        };
      }

      const cycleCheck = checkCycles(dagResult.value);
      if (cycleCheck.kind === "cyclic") {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              cycles: cycleCheck.cycles.map((c) => c.path),
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: true,
            nodeCount: dagResult.value.nodes.size,
            edgeCount: dagResult.value.edges.length,
          }, null, 2),
        }],
      };
    },
  );

  return server;
}

/** Start the MCP server on stdio transport. */
export async function startMcpServer(ws: Workspace): Promise<void> {
  const server = createMcpServer(ws);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
