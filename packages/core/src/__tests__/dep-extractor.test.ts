import { describe, it, expect } from "vitest";
import { extractDeps, extractAllDeps } from "../dep-extractor.js";
import { DataTree } from "../data-tree.js";
import type { CodataField } from "../types.js";

describe("extractDeps", () => {
  it("returns empty array for literal fields", () => {
    const field: CodataField = {
      path: "/title",
      meta: { loader: { type: "literal", value: "Hello" } },
      state: { status: "idle" },
    };
    expect(extractDeps(field)).toEqual([]);
  });

  it("returns target path for $ref fields", () => {
    const field: CodataField = {
      path: "/summary",
      meta: { loader: { type: "ref", $ref: "/title" } },
      state: { status: "idle" },
    };
    expect(extractDeps(field)).toEqual(["/title"]);
  });
});

describe("extractAllDeps", () => {
  it("extracts deps from a tree with mixed literal and $ref fields", () => {
    const tree = new DataTree({
      type: {
        properties: {
          title: { type: "string" },
          count: { type: "number" },
          summary: { type: "string" },
        },
      },
      data: {
        title: "Hello",
        count: 42,
        summary: { $ref: "/title" },
      },
    });
    const deps = extractAllDeps(tree);
    expect(deps.get("/title")).toEqual([]);
    expect(deps.get("/count")).toEqual([]);
    expect(deps.get("/summary")).toEqual(["/title"]);
  });

  it("extracts deps from nested tree with cross-references", () => {
    const tree = new DataTree({
      type: {
        properties: {
          user: {
            type: "object",
            properties: { name: { type: "string" } },
          },
          greeting: { type: "string" },
        },
      },
      data: {
        user: { name: "Alice" },
        greeting: { $ref: "/user/name" },
      },
    });
    const deps = extractAllDeps(tree);
    expect(deps.get("/greeting")).toEqual(["/user/name"]);
    expect(deps.get("/user/name")).toEqual([]);
  });

  it("extracts chained dependencies", () => {
    const tree = new DataTree({
      type: {
        properties: {
          a: { type: "string" },
          b: { type: "string" },
          c: { type: "string" },
        },
      },
      data: {
        a: "origin",
        b: { $ref: "/a" },
        c: { $ref: "/b" },
      },
    });
    const deps = extractAllDeps(tree);
    expect(deps.get("/a")).toEqual([]);
    expect(deps.get("/b")).toEqual(["/a"]);
    expect(deps.get("/c")).toEqual(["/b"]);
  });
});
