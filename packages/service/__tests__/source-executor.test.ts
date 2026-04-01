import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSource } from "../src/source-executor.js";
import { SourceError } from "../src/types.js";

describe("executeSource", () => {
  it("returns static value directly", async () => {
    const result = await executeSource({ type: "static", value: { x: 1 } }, "/tmp");
    expect(result).toEqual({ x: 1 });
  });

  it("returns null static value", async () => {
    const result = await executeSource({ type: "static", value: null }, "/tmp");
    expect(result).toBeNull();
  });

  it("reads and parses a JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codoc-test-"));
    try {
      await writeFile(join(dir, "data.json"), JSON.stringify({ count: 42 }));

      const result = await executeSource({ type: "file", path: "data.json" }, dir);
      expect(result).toEqual({ count: 42 });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns raw string for non-JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codoc-test-"));
    try {
      await writeFile(join(dir, "notes.txt"), "hello world");

      const result = await executeSource({ type: "file", path: "notes.txt" }, dir);
      expect(result).toBe("hello world");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws SourceError for missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codoc-test-"));
    try {
      await expect(
        executeSource({ type: "file", path: "missing.json" }, dir),
      ).rejects.toThrow(SourceError);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
