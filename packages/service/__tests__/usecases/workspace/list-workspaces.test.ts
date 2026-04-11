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
    }
  });
});
