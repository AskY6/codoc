import { describe, expect, it } from "vitest";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { workspaceRepo } from "../../../src/repo/workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("createWorkspace", () => {
  it("mints an id from ctx.idGen and persists the workspace", async () => {
    const { ctx } = makeTestCtx();

    const result = await createWorkspace(ctx, {
      name: "Alpha",
      description: "first workspace",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const workspace = result.value;
    expect(workspace.id).toBe("ws_1");
    expect(workspace.name).toBe("Alpha");
    expect(workspace.description).toBe("first workspace");

    const fetched = await workspaceRepo.get(ctx, workspace.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value).toEqual(workspace);
    }
  });

  it("accepts a null description", async () => {
    const { ctx } = makeTestCtx();

    const result = await createWorkspace(ctx, {
      name: "NoDesc",
      description: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBeNull();
    }
  });

  it("returns workspace-already-exists if the same id collides", async () => {
    const { ctx } = makeTestCtx();
    // Force an id collision by using an idGen that always returns the same id.
    const fixedCtx = {
      ...ctx,
      idGen: {
        ...ctx.idGen,
        workspaceId: () => "ws_fixed" as never,
      },
    };

    const first = await createWorkspace(fixedCtx, {
      name: "First",
      description: null,
    });
    const second = await createWorkspace(fixedCtx, {
      name: "Second",
      description: null,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.kind).toBe("workspace-already-exists");
    }
  });
});
