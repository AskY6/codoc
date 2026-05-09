// mcp-server — MCP tool server exposing codoc operations to Claude Code.
//
// Runs on stdio transport. Claude Code connects to this as an MCP server
// and gains tools to read, write, list, and search codocs.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Workspace, WriteResult } from "./workspace.js";
import { writeCodoc, buildAstMap } from "./workspace.js";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { buildDAG, checkCycles } from "@cobook/core";
import { stringify as stringifyYaml } from "yaml";
import { diagnoseCodoc } from "./diagnose.js";
import type { Diagnostic } from "./diagnose.js";
import { recognizeEnhancements, BUILTIN_COMPONENT_META } from "./recognize.js";
import type { ComponentMeta } from "./recognize.js";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import * as esbuild from "esbuild";
import { loadComponents, removeFile, resolveAll } from "./workspace.js";
import { loadChatMetas, deleteChatMeta } from "./chat-meta.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { updateDataField } from "./workspace-service.js";
import { FieldName as mkFieldName } from "@cobook/core";

export function createMcpServer(ws: Workspace, registry?: ProviderRegistry, updates?: import("node:events").EventEmitter): McpServer {
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
    "Write or update a codoc file. Content is the full source (YAML frontmatter + MDX body). Validates MDX before writing — errors block the write.",
    {
      path: z.string().describe("Workspace-relative path, e.g. 'reviews/alice-q1.codoc'"),
      content: z.string().describe("Full codoc source content"),
    },
    async ({ path, content }) => {
      const codocPath = mkCodocPath(path);
      const result = await writeCodoc(ws, codocPath, content);
      return writeResultToMcp(result, `Written and compiled: ${path}`, ws, codocPath);
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

  // ---- Tool: diagnose_codoc ---------------------------------------------------

  server.tool(
    "diagnose_codoc",
    "Run MDX diagnostics on a codoc to check for unknown components, missing imports, and invalid data references. Does not modify the file.",
    { path: z.string().describe("Workspace-relative path, e.g. 'decision.codoc'") },
    async ({ path }) => {
      const codocPath = mkCodocPath(path);
      const codoc = ws.codocs.get(codocPath);

      if (!codoc) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      const ctx = {
        customComponentNames: new Set(
          ws.customComponents
            .filter((c) => c.kind === "ok")
            .map((c) => c.component.name),
        ),
        builtinComponentNames: new Set(BUILTIN_COMPONENT_META.map((c) => c.name)),
      };
      const diagnostics = diagnoseCodoc(codoc.ast, ctx);

      if (diagnostics.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No issues found in ${path}` }],
        };
      }

      return {
        content: [{ type: "text" as const, text: formatDiagnostics(path, diagnostics) }],
        isError: diagnostics.some((d) => d.severity === "error"),
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
      const fieldName = mkFieldName(field);
      const ctx = { ws, updates };

      const result = await updateDataField(ctx, codocPath, fieldName, value);

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      // For static field writes, use writeResultToMcp for enhancement hints.
      if (result.writeResult) {
        return writeResultToMcp(result.writeResult, result.message, ws, codocPath);
      }

      return {
        content: [{ type: "text" as const, text: result.message }],
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
      const result = await writeCodoc(ws, codocPath, newContent);
      return writeResultToMcp(result, `Appended content to ${path}`, ws, codocPath);
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
      const result = await writeCodoc(ws, codocPath, content);
      return writeResultToMcp(result, `Created ${path} with title "${title}"`, ws, codocPath);
    },
  );

  // ---- Tool: suggest_enhancements -------------------------------------------

  server.tool(
    "suggest_enhancements",
    "Analyze a codoc and suggest component enhancements for its data fields. Returns structured suggestions for fields that could benefit from richer visualization.",
    { path: z.string().describe("Workspace-relative path, e.g. 'decision.codoc'") },
    async ({ path }) => {
      const codocPath = mkCodocPath(path);
      const codoc = ws.codocs.get(codocPath);

      if (!codoc) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      // Merge builtin + custom component metadata
      const customMeta: ComponentMeta[] = ws.customComponents
        .filter((c) => c.kind === "ok")
        .map((c) => ({
          name: c.component.name,
          description: "Custom component",
          props: [],
          template: `<${c.component.name} data={data.FIELD} />`,
          dataTypeHints: [],
        }));
      const allMeta = [...BUILTIN_COMPONENT_META, ...customMeta];

      const enhancements = recognizeEnhancements(codoc.ast, codoc.resolvedData, allMeta);

      if (enhancements.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No enhancement opportunities found in ${path}. All fields are either already using components or have no matching component.` }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(enhancements, null, 2) }],
      };
    },
  );

  // ---- Tool: list_components ------------------------------------------------

  server.tool(
    "list_components",
    "List all available components (built-in and custom) with their metadata, props, and usage templates.",
    {},
    async () => {
      const customMeta: ComponentMeta[] = ws.customComponents
        .filter((c) => c.kind === "ok")
        .map((c) => ({
          name: c.component.name,
          description: "Custom component",
          props: [],
          template: `<${c.component.name} />`,
          dataTypeHints: [],
        }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            builtin: BUILTIN_COMPONENT_META,
            custom: customMeta,
          }, null, 2),
        }],
      };
    },
  );

  // ---- Tool: write_component ------------------------------------------------

  server.tool(
    "write_component",
    "Create or update a custom React component (.tsx) in the workspace. The code is validated via esbuild compilation before writing. The component becomes available for use in codoc MDX bodies immediately.",
    {
      name: z.string().describe("PascalCase component name, e.g. 'RadarChart'"),
      code: z.string().describe("Full .tsx source code for the component. Must export a default or named React component."),
    },
    async ({ name, code }) => {
      // Validate PascalCase name
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        return {
          content: [{ type: "text" as const, text: `Error: component name must be PascalCase (e.g. "RadarChart"), got "${name}"` }],
          isError: true,
        };
      }

      // Compile to validate before writing
      try {
        await esbuild.build({
          stdin: { contents: code, loader: "tsx", resolveDir: join(ws.sourceDir, "components") },
          bundle: true,
          write: false,
          format: "cjs",
          platform: "neutral",
          jsx: "automatic",
          jsxImportSource: "react",
          external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
          logLevel: "silent",
        });
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Compilation error:\n${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }

      // Write the file
      const componentsDir = join(ws.sourceDir, "components");
      await mkdir(componentsDir, { recursive: true });
      const filePath = join(componentsDir, `${name}.tsx`);
      await writeFile(filePath, code, "utf-8");

      // Reload components
      await loadComponents(ws);

      return {
        content: [{ type: "text" as const, text: `Component "${name}" written to components/${name}.tsx and compiled successfully.` }],
      };
    },
  );

  // ---- Tool: delete_codoc ---------------------------------------------------

  server.tool(
    "delete_codoc",
    "Delete a codoc from the workspace. Removes the source file and compiled output.",
    { path: z.string().describe("Workspace-relative path, e.g. 'notes/old.codoc'") },
    async ({ path }) => {
      const codocPath = mkCodocPath(path);

      if (!ws.codocs.has(codocPath)) {
        return {
          content: [{ type: "text" as const, text: `Error: codoc not found at "${path}"` }],
          isError: true,
        };
      }

      const absolutePath = join(ws.sourceDir, codocPath);
      await unlink(absolutePath);
      await removeFile(ws, absolutePath);
      await resolveAll(ws);

      return {
        content: [{ type: "text" as const, text: `Deleted ${path}` }],
      };
    },
  );

  // ---- Tool: list_chats -----------------------------------------------------

  server.tool(
    "list_chats",
    "List all chat sessions with metadata (title, provider, timestamps).",
    {},
    async () => {
      const metas = await loadChatMetas(ws.sourceDir);
      metas.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

      if (metas.length === 0) {
        return { content: [{ type: "text" as const, text: "No chat sessions found." }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(metas, null, 2) }],
      };
    },
  );

  // ---- Tool: read_chat ------------------------------------------------------

  if (registry) {
    server.tool(
      "read_chat",
      "Read the message history of a chat session.",
      { sessionId: z.string().describe("Session ID from list_chats") },
      async ({ sessionId }) => {
        const metas = await loadChatMetas(ws.sourceDir);
        const meta = metas.find((m) => m.sessionId === sessionId);

        if (!meta) {
          return {
            content: [{ type: "text" as const, text: `Error: chat session "${sessionId}" not found` }],
            isError: true,
          };
        }

        const providerId = meta.provider ?? "claude-code";
        const provider = registry.get(providerId);

        if (!provider) {
          return {
            content: [{ type: "text" as const, text: `Error: provider "${providerId}" not available` }],
            isError: true,
          };
        }

        const messages = await provider.readHistory(sessionId, ws.sourceDir);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ title: meta.title, provider: providerId, messages }, null, 2),
          }],
        };
      },
    );
  }

  // ---- Tool: fetch_url ------------------------------------------------------

  server.tool(
    "fetch_url",
    "Fetch content from a URL. Useful for reading RSS/Atom feeds, web pages, and other external data.",
    {
      url: z.string().url().describe("URL to fetch"),
      maxBytes: z.number().optional().default(100_000).describe("Max response bytes (default 100KB)"),
    },
    async ({ url, maxBytes }) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${res.status} ${res.statusText} for ${url}` }],
            isError: true,
          };
        }
        const text = await res.text();
        return {
          content: [{ type: "text" as const, text: text.slice(0, maxBytes) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Fetch error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  // ---- Tool: delete_chat ----------------------------------------------------

  server.tool(
    "delete_chat",
    "Delete a chat session by its session ID.",
    { sessionId: z.string().describe("Session ID from list_chats") },
    async ({ sessionId }) => {
      const deleted = await deleteChatMeta(ws.sourceDir, sessionId);
      if (!deleted) {
        return {
          content: [{ type: "text" as const, text: `Error: chat session "${sessionId}" not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Deleted chat session ${sessionId}` }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a WriteResult into an MCP tool response.
 *  When a workspace and codocPath are provided, appends enhancement suggestions. */
function writeResultToMcp(
  result: WriteResult,
  successHeader: string,
  ws?: Workspace,
  codocPath?: ReturnType<typeof mkCodocPath>,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  if (!result.ok) {
    return {
      content: [{ type: "text" as const, text: formatDiagnostics("Write blocked", result.diagnostics) }],
      isError: true,
    };
  }

  const warnings = result.diagnostics.filter((d) => d.severity === "warning");
  const msg = warnings.length > 0
    ? formatDiagnostics(successHeader, warnings)
    : successHeader;

  // Append enhancement suggestions if available
  if (ws && codocPath) {
    const codoc = ws.codocs.get(codocPath);
    if (codoc) {
      const customMeta: ComponentMeta[] = ws.customComponents
        .filter((c) => c.kind === "ok")
        .map((c) => ({
          name: c.component.name,
          description: "Custom component",
          props: [],
          template: `<${c.component.name} data={data.FIELD} />`,
          dataTypeHints: [],
        }));
      const enhancements = recognizeEnhancements(codoc.ast, codoc.resolvedData, [...BUILTIN_COMPONENT_META, ...customMeta]);
      if (enhancements.length > 0) {
        const hints = enhancements.map((e) => {
          const names = e.suggestions.map((s) => s.name).join(", ");
          const usage = e.currentUsage === "raw-expression" ? "raw expression" : "not used in view";
          return `  - ${e.field} (${e.valueType}, ${usage}): try ${names}`;
        });
        return {
          content: [{
            type: "text" as const,
            text: msg + "\n\nEnhancement opportunities:\n" + hints.join("\n"),
          }],
        };
      }
    }
  }

  return { content: [{ type: "text" as const, text: msg }] };
}

/** Format diagnostics into a human-readable (and LLM-readable) string. */
function formatDiagnostics(header: string, diagnostics: readonly Diagnostic[]): string {
  const lines = [header];
  for (const d of diagnostics) {
    const loc = d.line != null ? `:${d.line}${d.column != null ? `:${d.column}` : ""}` : "";
    lines.push(`  [${d.severity}]${loc} ${d.message}`);
  }
  return lines.join("\n");
}

/** Start the MCP server on stdio transport. */
export async function startMcpServer(ws: Workspace, registry?: ProviderRegistry): Promise<void> {
  const server = createMcpServer(ws, registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
