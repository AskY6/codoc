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

// ---------------------------------------------------------------------------
// Tree types
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

async function scanDirectory(dir: string): Promise<TreeNode[]> {
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
      nodes.push({
        name: entry.name,
        type: "directory",
        children: await scanDirectory(join(dir, entry.name)),
      });
    } else if (entry.name.endsWith(".codoc")) {
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

/** Extract the codoc path from `/api/codoc/<path>` URLs. */
function codocPathFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const marker = "/codoc/";
  const idx = pathname.indexOf(marker);
  if (idx === -1) return "";
  return decodeURIComponent(pathname.slice(idx + marker.length));
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createApiRoutes(ws: Workspace): Hono {
  const api = new Hono();

  // ---- GET /tree ----------------------------------------------------------

  api.get("/tree", async (c) => {
    const tree = await scanDirectory(ws.sourceDir);
    return c.json(tree);
  });

  // ---- GET /codocs --------------------------------------------------------

  api.get("/codocs", (c) => {
    const items = Array.from(ws.codocs.values()).map((codoc) => ({
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
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);
    const codoc = ws.codocs.get(codocPath);

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
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);
    const body = await c.req.json<{ content: string }>();

    if (!body.content) {
      return c.json({ error: "missing content field" }, 400);
    }

    const result = await writeCodoc(ws, codocPath, body.content);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ ok: true });
  });

  // ---- DELETE /codoc/:path+ ------------------------------------------------

  api.delete("/codoc/*", async (c) => {
    const path = codocPathFromUrl(c.req.url);
    const codocPath = mkCodocPath(path);

    if (!ws.codocs.has(codocPath)) {
      return c.json({ error: `codoc not found: "${path}"` }, 404);
    }

    const absolutePath = join(ws.sourceDir, codocPath);
    await unlink(absolutePath);
    removeFile(ws, absolutePath);
    await resolveAll(ws);

    return c.json({ ok: true });
  });

  // ---- GET /dag -----------------------------------------------------------

  api.get("/dag", (c) => {
    const astMap = buildAstMap(ws);
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

    return c.json({
      ok: cycleCheck.kind === "acyclic",
      nodeCount: dag.nodes.size,
      edgeCount: dag.edges.length,
      cycles:
        cycleCheck.kind === "cyclic"
          ? cycleCheck.cycles.map((cy) => cy.path)
          : [],
    });
  });

  return api;
}
