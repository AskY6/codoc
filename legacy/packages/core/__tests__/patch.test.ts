import { describe, expect, it } from "vitest";
import { parseCodoc, patchCodocSource } from "../src/index.js";

describe("patchCodocSource", () => {
  it("replaces a top-level static value and round-trips through parseCodoc", () => {
    const source = `---
meta:
  title: Note
data:
  count: 1
  label: hello
---
`;
    const next = patchCodocSource(source, "count", 42);
    const ast = parseCodoc(next);
    expect(ast.data?.["count"]).toEqual({ kind: "static", value: 42 });
    expect(ast.data?.["label"]).toEqual({ kind: "static", value: "hello" });
    expect(ast.meta?.title).toBe("Note");
  });

  it("creates data.<key> when the key did not previously exist", () => {
    const source = `---
meta:
  title: Seed
data:
  existing: 1
---
`;
    const next = patchCodocSource(source, "added", "value");
    const ast = parseCodoc(next);
    expect(ast.data?.["added"]).toEqual({ kind: "static", value: "value" });
    expect(ast.data?.["existing"]).toEqual({ kind: "static", value: 1 });
  });

  it("preserves $ref and $source sibling fields as raw markers", () => {
    const source = `---
data:
  count: 1
  upstream:
    $ref: ./other.codoc#data.val
  feed:
    $source: rss
    url: https://example.com/feed.xml
---
`;
    const next = patchCodocSource(source, "count", 99);
    const ast = parseCodoc(next);
    expect(ast.data?.["count"]).toEqual({ kind: "static", value: 99 });
    // Ref and source markers survive the round-trip.
    expect(ast.data?.["upstream"]).toEqual({
      kind: "ref",
      $ref: "./other.codoc#data.val",
    });
    expect(ast.data?.["feed"]).toEqual({
      kind: "source",
      source: "rss",
      params: { url: "https://example.com/feed.xml" },
    });
  });

  it("preserves the MDX body verbatim", () => {
    const source = `---
data:
  title: Hello
---

# Heading

Body text.
`;
    const next = patchCodocSource(source, "title", "World");
    expect(next).toMatch(/# Heading/);
    expect(next).toMatch(/Body text\./);
    const ast = parseCodoc(next);
    expect(ast.data?.["title"]).toEqual({ kind: "static", value: "World" });
  });

  it("supports array index paths like articles[1].readAt", () => {
    const source = `---
data:
  articles:
    - title: a
      readAt: null
    - title: b
      readAt: null
---
`;
    const next = patchCodocSource(source, "articles[1].readAt", "2026-04-10");
    const ast = parseCodoc(next);
    const articles = (ast.data?.["articles"] as { kind: "static"; value: unknown[] })
      .value as Array<{ title: string; readAt: string | null }>;
    expect(articles[0]!.readAt).toBeNull();
    expect(articles[1]!.readAt).toBe("2026-04-10");
  });

  it("rejects forbidden path segments to prevent prototype pollution", () => {
    const source = `---
data:
  x: 1
---
`;
    expect(() => patchCodocSource(source, "__proto__.polluted", true)).toThrow(
      /Forbidden path segment/,
    );
  });

  it("throws when intermediate parent is missing", () => {
    const source = `---
data:
  x: 1
---
`;
    expect(() => patchCodocSource(source, "missing.child", 1)).toThrow(
      /missing parent|not an object/,
    );
  });
});
