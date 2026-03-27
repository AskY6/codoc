import { describe, it, expect } from "vitest";
import { parseCodoc } from "../codoc-loader.js";

describe("parseCodoc", () => {
  it("parses a valid .codoc YAML string", () => {
    const source = `
type:
  properties:
    title: { type: string }
    count: { type: number }

data:
  title: "Hello CoDoc"
  count: 42

view: |
  # {title}
  Count is **{count}**
`;
    const result = parseCodoc(source);
    expect(result.type).toEqual({
      properties: { title: { type: "string" }, count: { type: "number" } },
    });
    expect(result.data).toEqual({ title: "Hello CoDoc", count: 42 });
    expect(result.view).toContain("{title}");
    expect(result.view).toContain("{count}");
  });

  it("parses data with $ref declarations", () => {
    const source = `
type:
  properties:
    title: { type: string }
    summary: { type: string }

data:
  title: "Hello"
  summary:
    $ref: "/data/title"

view: |
  {title} - {summary}
`;
    const result = parseCodoc(source);
    expect(result.data.summary).toEqual({ $ref: "/data/title" });
  });

  it("throws on missing type section", () => {
    const source = `
data:
  title: "Hello"
view: "# hi"
`;
    expect(() => parseCodoc(source)).toThrow("missing 'type'");
  });

  it("throws on missing data section", () => {
    const source = `
type:
  properties:
    title: { type: string }
view: "# hi"
`;
    expect(() => parseCodoc(source)).toThrow("missing 'data'");
  });

  it("throws on missing view section", () => {
    const source = `
type:
  properties:
    title: { type: string }
data:
  title: "Hello"
`;
    expect(() => parseCodoc(source)).toThrow("missing 'view'");
  });

  it("throws on invalid YAML", () => {
    expect(() => parseCodoc("")).toThrow();
  });
});
