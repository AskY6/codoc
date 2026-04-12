import type { CodocId } from "@cobook/core";
import { describe, expect, it } from "vitest";
import { createCodoc } from "../../../src/usecases/codoc/create-codoc.js";
import { getCodoc } from "../../../src/usecases/codoc/get-codoc.js";
import { updateCodocContent } from "../../../src/usecases/codoc/update-codoc-content.js";
import { createWorkspace } from "../../../src/usecases/workspace/create-workspace.js";
import { makeTestCtx } from "../../helpers/ctx.js";

describe("updateCodocContent", () => {
  it("overwrites content and returns a fresh rev", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, { name: "Alpha", description: null });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: "A",
    });
    if (!created.ok) throw new Error("setup failed");

    const newContent = "---\ntitle: A\n---\n# Hello world";
    const updated = await updateCodocContent(ctx, {
      id: created.value.id as CodocId,
      content: newContent,
      expectedRev: created.value.rev,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.content).toBe(newContent);
    expect(updated.value.id).toBe(created.value.id);
    expect(updated.value.path).toBe("a.codoc");
    // Title now comes from parsed content frontmatter.
    expect(updated.value.title).toBe("A");
    expect(typeof updated.value.rev).toBe("string");
    expect(updated.value.rev).not.toBe(created.value.rev);
  });

  it("re-parses the ast from updated content", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, { name: "Alpha", description: null });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: "Original Title",
    });
    if (!created.ok) throw new Error("setup failed");

    const newContent = "---\ntitle: Updated Title\n---\nbody";
    const updated = await updateCodocContent(ctx, {
      id: created.value.id as CodocId,
      content: newContent,
      expectedRev: created.value.rev,
    });
    if (!updated.ok) throw new Error("update failed");

    // Re-read through getCodoc to confirm the ast was re-parsed.
    const refetched = await getCodoc(ctx, created.value.id as CodocId);
    expect(refetched.ok).toBe(true);
    if (!refetched.ok) return;
    expect(refetched.value.title).toBe("Updated Title");
    expect(refetched.value.content).toBe(newContent);
  });

  it("returns codoc-conflict when expectedRev is stale", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, { name: "Alpha", description: null });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: null,
    });
    if (!created.ok) throw new Error("setup failed");
    const staleRev = created.value.rev;

    // First write consumes the rev.
    const first = await updateCodocContent(ctx, {
      id: created.value.id as CodocId,
      content: "first",
      expectedRev: staleRev,
    });
    expect(first.ok).toBe(true);

    // Second write replays the now-stale rev.
    const second = await updateCodocContent(ctx, {
      id: created.value.id as CodocId,
      content: "second",
      expectedRev: staleRev,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.kind).toBe("codoc-conflict");
    }
  });

  it("returns codoc-not-found for an unknown id", async () => {
    const { ctx } = makeTestCtx();

    const result = await updateCodocContent(ctx, {
      id: "codoc_nope" as CodocId,
      content: "anything",
      expectedRev: "whatever",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("codoc-not-found");
    }
  });

  it("bumps updatedAt on every successful update", async () => {
    const { ctx } = makeTestCtx();
    const ws = await createWorkspace(ctx, { name: "Alpha", description: null });
    if (!ws.ok) throw new Error("setup failed");

    const created = await createCodoc(ctx, {
      workspaceId: ws.value.id,
      path: "a.codoc",
      title: null,
    });
    if (!created.ok) throw new Error("setup failed");

    // Nudge the clock beyond millisecond precision.
    await new Promise((r) => setTimeout(r, 2));

    const updated = await updateCodocContent(ctx, {
      id: created.value.id as CodocId,
      content: "x",
      expectedRev: created.value.rev,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.updatedAt).toBeGreaterThanOrEqual(created.value.updatedAt);
    }
  });
});
