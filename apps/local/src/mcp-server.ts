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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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

  // ---- Tool: update_data_field -----------------------------------------------

  server.tool(
    "update_data_field",
    "Update a single data field in a codoc's frontmatter without rewriting the whole file. Creates the field if it doesn't exist.",
    {
      path: z.string().describe("Workspace-relative path, e.g. 'reviews/alice-q1.codoc'"),
      field: z.string().describe("Field name to update, e.g. 'score'"),
      value: z.unknown().describe("New value — number, string, boolean, array, or object. For $ref use { \"$ref\": \"path#data.field\" }. For $source use { \"$source\": \"provider\", ...params }."),
    },
    async ({ path, field, value }) => {
      const codocPath = mkCodocPath(path);
      const codoc = ws.codocs.get(codocPath);

      if (!codoc) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      const updated = patchDataField(codoc.content, field, value);
      if (!updated.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${updated.error}` }],
          isError: true,
        };
      }

      const writeResult = await writeCodoc(ws, codocPath, updated.value);
      if (!writeResult.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${writeResult.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Updated field "${field}" in ${path}` }],
      };
    },
  );

  // ---- Tool: append_content -------------------------------------------------

  server.tool(
    "append_content",
    "Append MDX content to the end of a codoc's body without touching the frontmatter.",
    {
      path: z.string().describe("Workspace-relative path, e.g. 'notes/demo.codoc'"),
      content: z.string().describe("MDX content to append (e.g. a new section, component, etc.)"),
    },
    async ({ path, content: appendContent }) => {
      const codocPath = mkCodocPath(path);
      const codoc = ws.codocs.get(codocPath);

      if (!codoc) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      const newContent = codoc.content.trimEnd() + "\n\n" + appendContent.trim() + "\n";

      const writeResult = await writeCodoc(ws, codocPath, newContent);
      if (!writeResult.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${writeResult.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Appended content to ${path}` }],
      };
    },
  );

  // ---- Tool: create_from_template -------------------------------------------

  server.tool(
    "create_from_template",
    "Create a new codoc from a structured template. Generates the frontmatter and body automatically.",
    {
      path: z.string().describe("Workspace-relative path for the new file, e.g. 'reviews/bob-q1.codoc'"),
      title: z.string().describe("Document title"),
      tags: z.array(z.string()).optional().describe("Optional tags"),
      data: z.record(z.unknown()).optional().describe("Optional data fields as key-value pairs"),
      body: z.string().optional().describe("Optional MDX body content. If omitted, generates a heading from title."),
    },
    async ({ path, title, tags, data, body }) => {
      const codocPath = mkCodocPath(path);

      if (ws.codocs.has(codocPath)) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc already exists at "${path}". Use write_codoc or update_data_field instead.` }],
          isError: true,
        };
      }

      // Build frontmatter object
      const fm: Record<string, unknown> = { title };
      if (tags && tags.length > 0) fm.tags = tags;
      if (data && Object.keys(data).length > 0) fm.data = data;

      const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trim();
      const mdxBody = body?.trim() || `# ${title}`;

      const content = `---\n${yamlStr}\n---\n\n${mdxBody}\n`;

      const writeResult = await writeCodoc(ws, codocPath, content);
      if (!writeResult.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${writeResult.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Created ${path} with title "${title}"` }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Patch a single data field in the YAML frontmatter of a codoc source string.
 * Returns the updated full source, or an error message.
 */
function patchDataField(
  source: string,
  field: string,
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("---")) {
    return { ok: false, error: "codoc has no frontmatter — cannot patch data field" };
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return { ok: false, error: "malformed frontmatter" };
  }

  const closingIndex = trimmed.indexOf("\n---", firstNewline);
  if (closingIndex === -1) {
    return { ok: false, error: "unterminated frontmatter" };
  }

  const yamlStr = trimmed.slice(firstNewline + 1, closingIndex);
  const afterClosing = closingIndex + 4; // \n---
  const rest = trimmed.slice(afterClosing);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlStr);
  } catch (e) {
    return { ok: false, error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "frontmatter is not a mapping" };
  }

  const obj = { ...(parsed as Record<string, unknown>) };
  const data = (
    obj.data != null && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? { ...(obj.data as Record<string, unknown>) }
      : {}
  );

  data[field] = value;
  obj.data = data;

  const newYaml = stringifyYaml(obj, { lineWidth: 0 }).trim();
  return { ok: true, value: `---\n${newYaml}\n---${rest}` };
}

/** Start the MCP server on stdio transport. */
export async function startMcpServer(ws: Workspace): Promise<void> {
  const server = createMcpServer(ws);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
