// api-routes — REST API for the local web UI.
//
// All routes are mounted under /api by http-server.ts.

import { Hono } from "hono";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace } from "./workspace.js";
import { writeCodoc, buildAstMap, removeFile, resolveAll } from "./workspace.js";
import { CodocPath as mkCodocPath } from "@cobook/core";
import { buildDAG, checkCycles } from "@cobook/core";
import { loadChatMetas, deleteChatMeta } from "./chat-meta.js";

// ---------------------------------------------------------------------------
// Tree types
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

async function scanDirectory(dir: string, ext: string): Promise<TreeNode[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip hidden
    if (entry.isDirectory()) {
      const children = await scanDirectory(join(dir, entry.name), ext);
      // Only include directories that contain files
      if (children.length > 0) {
        nodes.push({ name: entry.name, type: "directory", children });
      }
    } else if (entry.name.endsWith(ext)) {
      nodes.push({ name: entry.name, type: "file" });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the codoc path from `/api/codoc/<path>` URLs.
 *  Accepts both `.codoc` and `.mdx` paths — normalizes to `.codoc`. */
function codocPathFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const marker = "/codoc/";
  const idx = pathname.indexOf(marker);
  if (idx === -1) return "";
  const raw = decodeURIComponent(pathname.slice(idx + marker.length));
  // Normalize .mdx → .codoc so the UI can reference files by their output name
  return raw.endsWith(".mdx") ? raw.replace(/\.mdx$/, ".codoc") : raw;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createApiRoutes(state: { workspace: Workspace | null }): Hono {
  const api = new Hono();

  /** Return 503 if no workspace is open. */
  function ws(c: { json: (data: unknown, status: number) => Response }): Workspace | null {
    if (!state.workspace) {
      c.json({ error: "no workspace open" }, 503);
      return null;
    }
    return state.workspace;
  }

  // ---- GET /tree ----------------------------------------------------------

  api.get("/tree", async (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const tree = await scanDirectory(w.outDir, ".mdx");
    return c.json(tree);
  });

  // ---- GET /codocs --------------------------------------------------------

  api.get("/codocs", (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const items = Array.from(w.codocs.values()).map((codoc) => ({
      path: codoc.path,
      title: codoc.ast.meta.title,
      tags: [...codoc.ast.meta.tags],
      dataFieldCount: codoc.ast.data.size,
      hasView: codoc.ast.view.kind === "mdx",
    }));
    return c.json(items);
  });

  // ---- GET /codoc/:path+ --------------------------------------------------

  api.get("/codoc/*", (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);
    const codoc = w.codocs.get(codocPath);

    if (!codoc) {
      return c.json({ error: `codoc not found: "${path}"` }, 404);
    }

    // Serialize data fields for the UI
    const dataFields: Record<string, { kind: string; resolved: unknown }> = {};
    for (const [fieldName, field] of codoc.ast.data) {
      const resolved = codoc.resolvedData?.[fieldName] ?? null;
      dataFields[fieldName] = { kind: field.kind, resolved };
    }

    return c.json({
      path: codoc.path,
      content: codoc.content,
      meta: {
        title: codoc.ast.meta.title,
        description: codoc.ast.meta.description,
        tags: [...codoc.ast.meta.tags],
      },
      view: codoc.ast.view,
      data: dataFields,
    });
  });

  // ---- PUT /codoc/:path+ --------------------------------------------------

  api.put("/codoc/*", async (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);
    const body = await c.req.json<{ content: string }>();

    if (!body.content) {
      return c.json({ error: "missing content field" }, 400);
    }

    const result = await writeCodoc(w, codocPath, body.content);
    if (!result.ok) {
      return c.json({ ok: false, diagnostics: result.diagnostics }, 400);
    }

    return c.json({ ok: true, diagnostics: result.diagnostics });
  });

  // ---- DELETE /codoc/:path+ ------------------------------------------------

  api.delete("/codoc/*", async (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);

    if (!w.codocs.has(codocPath)) {
      return c.json({ error: `codoc not found: "${path}"` }, 404);
    }

    const absolutePath = join(w.sourceDir, codocPath);
    await unlink(absolutePath);
    await removeFile(w, absolutePath);
    await resolveAll(w);

    return c.json({ ok: true });
  });

  // ---- GET /components ----------------------------------------------------

  api.get("/components", (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    return c.json(
      w.customComponents.map((entry) =>
        entry.kind === "ok"
          ? { kind: "ok" as const, name: entry.component.name, code: entry.component.code }
          : { kind: "error" as const, name: entry.error.name, error: entry.error.error },
      ),
    );
  });

  // ---- GET /dag -----------------------------------------------------------

  api.get("/dag", (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const astMap = buildAstMap(w);
    const dagResult = buildDAG(astMap);

    if (!dagResult.ok) {
      const errors = dagResult.error.map((e) => ({
        from: `${e.fromCodoc}#data.${e.fromField}`,
        target: e.target,
      }));
      return c.json({ ok: false, unknownTargets: errors });
    }

    const dag = dagResult.value;
    const cycleCheck = checkCycles(dag);

    // Serialize full node list
    const nodes = Array.from(dag.nodes.values()).map((n) => ({
      id: n.id,
      codocPath: n.codocPath,
      fieldName: n.fieldName,
      kind: n.field.kind,
    }));

    // Serialize edges
    const edges = dag.edges.map((e) => ({ from: e.from, to: e.to }));

    // Group nodes by codoc for cluster visualization
    const codocFieldMap = new Map<string, string[]>();
    for (const n of dag.nodes.values()) {
      let fields = codocFieldMap.get(n.codocPath);
      if (!fields) {
        fields = [];
        codocFieldMap.set(n.codocPath, fields);
      }
      fields.push(n.fieldName);
    }

    const codocs = Array.from(codocFieldMap.entries()).map(([path, fields]) => {
      const codoc = w.codocs.get(mkCodocPath(path));
      return {
        path,
        title: codoc?.ast.meta.title ?? null,
        tags: codoc ? [...codoc.ast.meta.tags] : [],
        fields,
      };
    });

    return c.json({
      ok: cycleCheck.kind === "acyclic",
      nodeCount: dag.nodes.size,
      edgeCount: dag.edges.length,
      cycles:
        cycleCheck.kind === "cyclic"
          ? cycleCheck.cycles.map((cy) => cy.path)
          : [],
      nodes,
      edges,
      codocs,
    });
  });

  // ---- GET /chats ----------------------------------------------------------

  api.get("/chats", async (c) => {
    const w = ws(c); if (!w) return c.json([], 200);
    const metas = await loadChatMetas(w.sourceDir);
    metas.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    return c.json(metas);
  });

  // ---- DELETE /chats/:sessionId ---------------------------------------------

  api.delete("/chats/:sessionId", async (c) => {
    const w = ws(c); if (!w) return c.json({ error: "no workspace open" }, 503);
    const deleted = await deleteChatMeta(w.sourceDir, c.req.param("sessionId"));
    return c.json({ ok: deleted });
  });

  return api;
}
