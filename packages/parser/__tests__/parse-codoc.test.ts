import { describe, expect, it } from "vitest";
import { parseCodoc } from "../src/parse-codoc.js";
import { FieldName as mkFieldName } from "@cobook/core";

describe("parseCodoc", () => {
  it("returns empty AST for blank content", () => {
    const r = parseCodoc("");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.title).toBeNull();
    expect(r.value.data.size).toBe(0);
    expect(r.value.view.kind).toBe("empty");
  });

  it("returns empty AST for whitespace-only content", () => {
    const r = parseCodoc("   \n  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.view.kind).toBe("empty");
  });

  it("treats content without frontmatter as MDX body", () => {
    const r = parseCodoc("<ScoreCard score={4} />");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.title).toBeNull();
    expect(r.value.data.size).toBe(0);
    expect(r.value.view).toEqual({ kind: "mdx", source: "<ScoreCard score={4} />" });
  });

  it("parses meta fields from frontmatter", () => {
    const content = `---
title: "Review: Alice"
description: "Q1 review"
tags: [review, q1]
---
# Hello`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.title).toBe("Review: Alice");
    expect(r.value.meta.description).toBe("Q1 review");
    expect(r.value.meta.tags).toEqual(["review", "q1"]);
    expect(r.value.view).toEqual({ kind: "mdx", source: "# Hello" });
  });

  it("parses schema declarations", () => {
    const content = `---
schema:
  score: number
  name: string
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.schema.get(mkFieldName("score"))).toEqual({ type: "number" });
    expect(r.value.meta.schema.get(mkFieldName("name"))).toEqual({ type: "string" });
  });

  it("parses static data fields", () => {
    const content = `---
data:
  score_business: 4
  name: Alice
  tags_list:
    - a
    - b
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.get(mkFieldName("score_business"))).toEqual({
      kind: "static",
      value: 4,
    });
    expect(r.value.data.get(mkFieldName("name"))).toEqual({
      kind: "static",
      value: "Alice",
    });
    expect(r.value.data.get(mkFieldName("tags_list"))).toEqual({
      kind: "static",
      value: ["a", "b"],
    });
  });

  it("parses $ref data fields into structured refs", () => {
    const content = `---
data:
  source:
    $ref: "./alice-q1.codoc#data.achievements"
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const field = r.value.data.get(mkFieldName("source"));
    expect(field).toBeDefined();
    expect(field!.kind).toBe("ref");
    if (field!.kind !== "ref") return;
    expect(field!.ref.target).toEqual({ kind: "relative", path: "./alice-q1.codoc" });
    expect(field!.ref.field).toBe("achievements");
  });

  it("parses $source data fields", () => {
    const content = `---
data:
  feed:
    $source: rss
    url: "https://example.com/feed.xml"
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const field = r.value.data.get(mkFieldName("feed"));
    expect(field).toBeDefined();
    expect(field!.kind).toBe("source");
    if (field!.kind !== "source") return;
    expect(field!.source).toBe("rss");
    expect(field!.params).toEqual({ url: "https://example.com/feed.xml" });
  });

  it("returns error for invalid $ref", () => {
    const content = `---
data:
  bad:
    $ref: "no-hash-here"
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid-ref");
  });

  it("returns error for malformed YAML", () => {
    const content = `---
title: [unterminated
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid-yaml");
  });

  it("returns error when frontmatter is a scalar", () => {
    const content = `---
just a string
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("frontmatter-not-mapping");
  });

  it("handles empty frontmatter with MDX body", () => {
    const content = `---
---
<Component />`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.title).toBeNull();
    expect(r.value.view).toEqual({ kind: "mdx", source: "<Component />" });
  });

  it("handles frontmatter-only (no MDX body)", () => {
    const content = `---
title: "Data only"
data:
  x: 42
---`;
    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.title).toBe("Data only");
    expect(r.value.data.get(mkFieldName("x"))).toEqual({ kind: "static", value: 42 });
    expect(r.value.view.kind).toBe("empty");
  });

  it("parses a full perf-review codoc", () => {
    const content = `---
title: "Review: Alice — Q1 2026"
tags: [review, q1-2026, alice]
schema:
  score_business: number
  score_technical: number
  weighted_total: number
data:
  source:
    $ref: "./alice-q1-2026.codoc#data.achievements"
  score_business: 4
  score_technical: 3
  weighted_total: 3.95
---

<ReviewHeader subject="Alice" period="Q1 2026" total={data.weighted_total} />

<ScoreCard dimension="业务成果" weight={0.3} score={data.score_business}>
  <Highlight>主导 X 项目上线</Highlight>
</ScoreCard>`;

    const r = parseCodoc(content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.meta.title).toBe("Review: Alice — Q1 2026");
    expect(r.value.meta.tags).toEqual(["review", "q1-2026", "alice"]);
    expect(r.value.meta.schema.size).toBe(3);

    expect(r.value.data.size).toBe(4);
    const source = r.value.data.get(mkFieldName("source"));
    expect(source?.kind).toBe("ref");

    const scoreBiz = r.value.data.get(mkFieldName("score_business"));
    expect(scoreBiz).toEqual({ kind: "static", value: 4 });

    expect(r.value.view.kind).toBe("mdx");
    if (r.value.view.kind !== "mdx") return;
    expect(r.value.view.source).toContain("<ReviewHeader");
    expect(r.value.view.source).toContain("<ScoreCard");
  });
});
