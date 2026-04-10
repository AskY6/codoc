import { describe, expect, it } from "vitest";
import { parseRef, normalizeRef } from "../src/index.js";
import { RefError } from "../src/index.js";

describe("parseRef", () => {
  it("parses a valid ref string", () => {
    expect(parseRef("./other.codoc#data.field")).toEqual({
      path: "./other.codoc",
      field: "data.field",
    });
  });

  it("parses ref with deeper path", () => {
    expect(parseRef("../utils/helper.codoc#data.items")).toEqual({
      path: "../utils/helper.codoc",
      field: "data.items",
    });
  });

  it("throws RefError when # is missing", () => {
    expect(() => parseRef("./other.codoc")).toThrow(RefError);
  });

  it("throws RefError when path is empty", () => {
    expect(() => parseRef("#data.field")).toThrow(RefError);
  });

  it("throws RefError when field is empty", () => {
    expect(() => parseRef("./other.codoc#")).toThrow(RefError);
  });
});

describe("normalizeRef", () => {
  it("resolves ./ relative to base directory", () => {
    const ref = { path: "./other.codoc", field: "data.field" };
    expect(normalizeRef(ref, "notes/meeting.codoc")).toBe(
      "notes/other.codoc#data.field",
    );
  });

  it("resolves ../ to parent directory", () => {
    const ref = { path: "../helper.codoc", field: "data.x" };
    expect(normalizeRef(ref, "notes/sub/meeting.codoc")).toBe(
      "notes/helper.codoc#data.x",
    );
  });

  it("resolves bare filename relative to base directory", () => {
    const ref = { path: "sibling.codoc", field: "data.y" };
    expect(normalizeRef(ref, "notes/meeting.codoc")).toBe(
      "notes/sibling.codoc#data.y",
    );
  });

  it("resolves from root-level codoc", () => {
    const ref = { path: "./other.codoc", field: "data.z" };
    expect(normalizeRef(ref, "root.codoc")).toBe("other.codoc#data.z");
  });
});
