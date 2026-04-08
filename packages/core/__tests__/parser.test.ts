import { describe, expect, it } from "vitest";
import { parseCodoc } from "../src/index.js";
import { ParseError } from "../src/index.js";

describe("parseCodoc", () => {
  it("parses a full codoc with meta, data, and view", () => {
    const ast = parseCodoc(`
meta:
  title: Meeting Notes
  description: Weekly sync
data:
  title: Weekly Meeting
  content:
    $source: file
    path: ./notes.md
  summary:
    $ref: ./other.codoc#data.summary
view:
  type: stack
`);

    expect(ast.meta?.title).toBe("Meeting Notes");
    expect(ast.meta?.description).toBe("Weekly sync");

    expect(ast.data?.["title"]).toEqual({ kind: "static", value: "Weekly Meeting" });
    expect(ast.data?.["content"]).toEqual({
      kind: "source",
      source: "file",
      params: { path: "./notes.md" },
    });
    expect(ast.data?.["summary"]).toEqual({
      kind: "ref",
      $ref: "./other.codoc#data.summary",
    });

    expect(ast.view).toEqual({ type: "stack" });
  });

  it("parses codoc with only meta (no data, no view)", () => {
    const ast = parseCodoc("meta:\n  title: Hello");
    expect(ast.meta?.title).toBe("Hello");
    expect(ast.data).toBeUndefined();
    expect(ast.view).toBeUndefined();
  });

  it("returns empty AST for empty content", () => {
    expect(parseCodoc("")).toEqual({});
  });

  it("classifies plain objects as static", () => {
    const ast = parseCodoc(`
data:
  info:
    key: value
    nested: true
`);
    expect(ast.data?.["info"]).toEqual({
      kind: "static",
      value: { key: "value", nested: true },
    });
  });

  it("classifies arrays as static", () => {
    const ast = parseCodoc(`
data:
  tags:
    - alpha
    - beta
`);
    expect(ast.data?.["tags"]).toEqual({
      kind: "static",
      value: ["alpha", "beta"],
    });
  });

  it("normalises meta schema shorthand", () => {
    const ast = parseCodoc(`
meta:
  schema:
    title: string
    count:
      type: number
`);
    expect(ast.meta?.schema).toEqual({
      title: { type: "string" },
      count: { type: "number" },
    });
  });

  it("throws ParseError for YAML syntax error", () => {
    expect(() => parseCodoc("key: [unterminated")).toThrow(ParseError);
  });

  it("throws ParseError for non-mapping top level", () => {
    expect(() => parseCodoc("- list\n- item")).toThrow(ParseError);
    expect(() => parseCodoc("just a string")).toThrow(ParseError);
  });

  it("throws ParseError for structural error (meta is array)", () => {
    expect(() => parseCodoc("meta:\n  - bad")).toThrow(ParseError);
  });

  // -----------------------------------------------------------------------
  // MDX format (frontmatter)
  // -----------------------------------------------------------------------

  it("parses MDX format with frontmatter and body", () => {
    const ast = parseCodoc(`---
meta:
  title: RSS Feed
  tags: [rss]
data:
  articles:
    $source: rss-feed
    url: https://example.com/feed.xml
---

import { Timeline } from "@codoc/components"

<Timeline items={data.articles} />`);

    expect(ast.meta?.title).toBe("RSS Feed");
    expect(ast.meta?.tags).toEqual(["rss"]);
    expect(ast.data?.["articles"]).toEqual({
      kind: "source",
      source: "rss-feed",
      params: { url: "https://example.com/feed.xml" },
    });
    expect(ast.view).toEqual({
      type: "mdx",
      source: expect.stringContaining("<Timeline items={data.articles} />"),
    });
  });

  it("parses MDX format with $ref in data", () => {
    const ast = parseCodoc(`---
data:
  feedA:
    $ref: "./feed-a.codoc#data.articles"
  feedB:
    $ref: "./feed-b.codoc#data.articles"
---

# Merged Feed`);

    expect(ast.data?.["feedA"]).toEqual({
      kind: "ref",
      $ref: "./feed-a.codoc#data.articles",
    });
    expect(ast.data?.["feedB"]).toEqual({
      kind: "ref",
      $ref: "./feed-b.codoc#data.articles",
    });
    const view = ast.view as { type: string; source: string };
    expect(view.type).toBe("mdx");
    expect(view.source).toBe("# Merged Feed");
  });

  it("parses MDX format with empty frontmatter", () => {
    const ast = parseCodoc(`---
---
# Just markdown`);

    expect(ast.meta).toBeUndefined();
    expect(ast.data).toBeUndefined();
    const view = ast.view as { type: string; source: string };
    expect(view.type).toBe("mdx");
    expect(view.source).toBe("# Just markdown");
  });

  it("parses MDX format with only frontmatter (no body)", () => {
    const ast = parseCodoc(`---
meta:
  title: Empty
---`);

    expect(ast.meta?.title).toBe("Empty");
    expect(ast.view).toBeUndefined();
  });

  it("still parses legacy YAML format without frontmatter", () => {
    const ast = parseCodoc(`meta:
  title: Legacy
data:
  x: 42
view:
  type: stack`);

    expect(ast.meta?.title).toBe("Legacy");
    expect(ast.data?.["x"]).toEqual({ kind: "static", value: 42 });
    expect(ast.view).toEqual({ type: "stack" });
  });
});
