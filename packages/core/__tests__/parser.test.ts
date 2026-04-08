import { describe, expect, it } from "vitest";
import { parseCodoc } from "../src/index.js";
import { ParseError } from "../src/index.js";

describe("parseCodoc", () => {
  it("parses a full codoc with meta, data, and MDX view", () => {
    const ast = parseCodoc(`---
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
---

# Notes

<Stack>{data.title}</Stack>`);

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

    const view = ast.view as { type: string; source: string };
    expect(view.type).toBe("mdx");
    expect(view.source).toContain("<Stack>");
  });

  it("parses codoc with only meta (no data, no view)", () => {
    const ast = parseCodoc(`---
meta:
  title: Hello
---`);
    expect(ast.meta?.title).toBe("Hello");
    expect(ast.data).toBeUndefined();
    expect(ast.view).toBeUndefined();
  });

  it("returns empty AST for empty content", () => {
    expect(parseCodoc("")).toEqual({});
  });

  it("classifies plain objects as static", () => {
    const ast = parseCodoc(`---
data:
  info:
    key: value
    nested: true
---`);
    expect(ast.data?.["info"]).toEqual({
      kind: "static",
      value: { key: "value", nested: true },
    });
  });

  it("classifies arrays as static", () => {
    const ast = parseCodoc(`---
data:
  tags:
    - alpha
    - beta
---`);
    expect(ast.data?.["tags"]).toEqual({
      kind: "static",
      value: ["alpha", "beta"],
    });
  });

  it("normalises meta schema shorthand", () => {
    const ast = parseCodoc(`---
meta:
  schema:
    title: string
    count:
      type: number
---`);
    expect(ast.meta?.schema).toEqual({
      title: { type: "string" },
      count: { type: "number" },
    });
  });

  it("throws ParseError for YAML syntax error in frontmatter", () => {
    expect(() => parseCodoc("---\nkey: [unterminated\n---")).toThrow(ParseError);
  });

  it("throws ParseError for non-mapping frontmatter", () => {
    expect(() => parseCodoc("---\n- list\n- item\n---")).toThrow(ParseError);
  });

  it("throws ParseError for structural error in frontmatter", () => {
    expect(() => parseCodoc("---\nmeta:\n  - bad\n---")).toThrow(ParseError);
  });

  it("rejects plain YAML without frontmatter delimiters", () => {
    expect(() =>
      parseCodoc(`meta:
  title: Legacy
data:
  x: 42
view:
  type: stack`),
    ).toThrow(ParseError);

    expect(() => parseCodoc("key: value")).toThrow(ParseError);
    expect(() => parseCodoc("- list\n- item")).toThrow(ParseError);
    expect(() => parseCodoc("just a string")).toThrow(ParseError);
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
});
