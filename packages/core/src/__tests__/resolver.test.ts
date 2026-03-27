import { describe, it, expect } from "vitest";
import { isExternalRef, parseExternalRef } from "../resolver.js";

describe("isExternalRef", () => {
  it("returns true for valid external refs", () => {
    expect(isExternalRef("[[B.codoc]]/title")).toBe(true);
    expect(isExternalRef("[[my-doc.codoc]]/data/name")).toBe(true);
    expect(isExternalRef("[[sub/path/doc.codoc]]/field")).toBe(true);
  });

  it("returns false for local refs", () => {
    expect(isExternalRef("/title")).toBe(false);
    expect(isExternalRef("/data/name")).toBe(false);
    expect(isExternalRef("title")).toBe(false);
  });

  it("returns false for malformed external refs", () => {
    expect(isExternalRef("[[B.codoc]]")).toBe(false);
    expect(isExternalRef("[B.codoc]/title")).toBe(false);
    expect(isExternalRef("B.codoc]]/title")).toBe(false);
  });
});

describe("parseExternalRef", () => {
  it("parses a simple external ref", () => {
    const result = parseExternalRef("[[B.codoc]]/title");
    expect(result).toEqual({ docRef: "B.codoc", fieldPath: "/title" });
  });

  it("parses nested field paths", () => {
    const result = parseExternalRef("[[B.codoc]]/data/user/name");
    expect(result).toEqual({ docRef: "B.codoc", fieldPath: "/data/user/name" });
  });

  it("parses doc refs with subdirectories", () => {
    const result = parseExternalRef("[[sub/path/doc.codoc]]/field");
    expect(result).toEqual({ docRef: "sub/path/doc.codoc", fieldPath: "/field" });
  });

  it("throws on non-external ref", () => {
    expect(() => parseExternalRef("/title")).toThrow("Invalid external ref");
  });

  it("throws on missing field path", () => {
    expect(() => parseExternalRef("[[B.codoc]]")).toThrow("missing field path");
  });

  it("throws on root-only field path", () => {
    expect(() => parseExternalRef("[[B.codoc]]/")).toThrow("missing field path");
  });
});
