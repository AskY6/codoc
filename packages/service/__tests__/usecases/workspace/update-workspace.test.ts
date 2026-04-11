import type { WorkspaceId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { listWorkspaces } from "../../../src/usecases/workspace/list-workspaces.js";
import { updateWorkspace } from "../../../src/usecases/workspace/update-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("updateWorkspace", () => {
  it("renames a workspace and returns a fresh rev", async () => {
    const { ctx } = makeTestCtx();

    const created = await createWorkspace(ctx, {
      name: "Alpha",
      description: "first",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listBefore = await listWorkspaces(ctx);
    expect(listBefore.ok).toBe(true);
    if (!listBefore.ok) return;
    const originalRev = listBefore.value[0]!.rev;

    const updated = await updateWorkspace(ctx, {
      id: created.value.id,
      name: "Alpha Renamed",
      description: "renamed",
      expectedRev: originalRev,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.workspace.id).toBe(created.value.id);
    expect(updated.value.workspace.name).toBe("Alpha Renamed");
    expect(updated.value.workspace.description).toBe("renamed");
    expect(typeof updated.value.rev).toBe("string");
    expect(updated.value.rev).not.toBe(originalRev);
    expect(updated.value.codocCount).toBe(0);
  });

  it("accepts a null description on update", async () => {
    const { ctx } = makeTestCtx();
    const created = await createWorkspace(ctx, {
      name: "Alpha",
      description: "first",
    });
    if (!created.ok) throw new Error("setup failed");
    const list = await listWorkspaces(ctx);
    if (!list.ok) throw new Error("setup failed");

    const updated = await updateWorkspace(ctx, {
      id: created.value.id,
      name: "Alpha",
      description: null,
      expectedRev: list.value[0]!.rev,
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.workspace.description).toBeNull();
    }
  });

  it("returns workspace-conflict when expectedRev is stale", async () => {
    const { ctx } = makeTestCtx();

    const created = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!created.ok) throw new Error("setup failed");
    const list = await listWorkspaces(ctx);
    if (!list.ok) throw new Error("setup failed");
    const staleRev = list.value[0]!.rev;

    // First update consumes the rev.
    const first = await updateWorkspace(ctx, {
      id: created.value.id,
      name: "Alpha v2",
      description: null,
      expectedRev: staleRev,
    });
    expect(first.ok).toBe(true);

    // Second update reuses the now-stale rev.
    const second = await updateWorkspace(ctx, {
      id: created.value.id,
      name: "Alpha v3",
      description: null,
      expectedRev: staleRev,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.kind).toBe("workspace-conflict");
    }
  });

  it("returns workspace-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await updateWorkspace(ctx, {
      id: "ws_nonexistent" as WorkspaceId,
      name: "nope",
      description: null,
      expectedRev: "whatever",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("workspace-not-found");
    }
  });

  it("bumps updatedAt on every successful update", async () => {
    const { ctx } = makeTestCtx();

    const created = await createWorkspace(ctx, {
      name: "Alpha",
      description: null,
    });
    if (!created.ok) throw new Error("setup failed");
    const list1 = await listWorkspaces(ctx);
    if (!list1.ok) throw new Error("setup failed");
    const t0 = list1.value[0]!.updatedAt;

    // Nudge the clock forward beyond millisecond precision.
    await new Promise((r) => setTimeout(r, 2));

    const updated = await updateWorkspace(ctx, {
      id: created.value.id,
      name: "Alpha renamed",
      description: null,
      expectedRev: list1.value[0]!.rev,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.updatedAt).toBeGreaterThanOrEqual(t0);
    }
  });
});
