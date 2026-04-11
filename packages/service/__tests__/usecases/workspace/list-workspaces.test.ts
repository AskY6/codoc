import { describe, expect, it } from "vitest";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { listWorkspaces } from "../../../src/usecases/workspace/list-workspaces.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("listWorkspaces", () => {
  it("returns an empty list on a fresh storage", async () => {
    const { ctx } = makeTestCtx();

    const result = await listWorkspaces(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("returns previously created workspaces with their updatedAt", async () => {
    const { ctx } = makeTestCtx();

    const before = Date.now();
    await createWorkspace(ctx, { name: "Alpha", description: null });
    await createWorkspace(ctx, { name: "Beta", description: "second" });

    const result = await listWorkspaces(ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const items = result.value;
    expect(items).toHaveLength(2);

    const names = items.map((item) => item.workspace.name).sort();
    expect(names).toEqual(["Alpha", "Beta"]);

    for (const item of items) {
      expect(typeof item.updatedAt).toBe("number");
      expect(item.updatedAt).toBeGreaterThanOrEqual(before);
      expect(item.codocCount).toBe(0);
    }
  });

  it("folds codocCount onto each list row", async () => {
    const { ctx } = makeTestCtx();
    const alpha = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    const beta = await createWorkspace(ctx, {
      name: "Beta",
      description: null,
    });
    if (!alpha.ok || !beta.ok) throw new Error("setup failed");

    const { createCodoc } = await import(
      "../../../src/usecases/codoc/create-codoc.js"
    );
    await createCodoc(ctx, {
      workspaceId: alpha.value.id,
      path: "one.codoc",
      title: "one",
    });
    await createCodoc(ctx, {
      workspaceId: alpha.value.id,
      path: "two.codoc",
      title: "two",
    });
    await createCodoc(ctx, {
      workspaceId: beta.value.id,
      path: "only.codoc",
      title: "only",
    });

    const result = await listWorkspaces(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byName = new Map(
      result.value.map((it) => [it.workspace.name, it.codocCount]),
    );
    expect(byName.get("Alpha")).toBe(2);
    expect(byName.get("Beta")).toBe(1);
  });
});
