import { describe, it, expect } from "vitest";
import { diagnoseCodoc } from "./diagnose.js";
import type { DiagnoseContext } from "./diagnose.js";
import { parseCodoc } from "@cobook/parser";

const NO_COMPONENTS: DiagnoseContext = { customComponentNames: new Set() };

function parse(source: string) {
  const result = parseCodoc(source);
  if (!result.ok) throw new Error(`parse failed: ${result.error.kind}`);
  return result.value;
}

describe("diagnoseCodoc", () => {
  it("returns empty for valid MDX with no components", () => {
    const ast = parse(`---\ntitle: test\n---\n\n# Hello world\n`);
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("returns empty when component is imported", () => {
    const ast = parse(
      `---\ntitle: test\n---\n\nimport Chart from "./Chart"\n\n<Chart data={[1,2]} />\n`,
    );
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("reports error for unknown component", () => {
    const ast = parse(`---\ntitle: test\n---\n\n<ScoreCard value={42} />\n`);
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toContain("ScoreCard");
    expect(diags[0]!.message).toContain("not imported");
  });

  it("allows custom components from context", () => {
    const ast = parse(`---\ntitle: test\n---\n\n<ScoreCard value={42} />\n`);
    const ctx: DiagnoseContext = { customComponentNames: new Set(["ScoreCard"]) };
    expect(diagnoseCodoc(ast, ctx)).toEqual([]);
  });

  it("allows HTML builtins (lowercase tags)", () => {
    const ast = parse(`---\ntitle: test\n---\n\n<div><span>hi</span></div>\n`);
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("reports warning for unknown data field", () => {
    const ast = parse(
      `---\ntitle: test\ndata:\n  score: 42\n---\n\n{data.nonexistent}\n`,
    );
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[0]!.message).toContain("nonexistent");
  });

  it("passes for known data field", () => {
    const ast = parse(
      `---\ntitle: test\ndata:\n  score: 42\n---\n\n{data.score}\n`,
    );
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("detects data refs inside JSX attribute expressions", () => {
    const ast = parse(
      `---\ntitle: test\ndata:\n  score: 42\n---\n\nimport Chart from "./Chart"\n\n<Chart value={data.missing} />\n`,
    );
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[0]!.message).toContain("missing");
  });

  it("reports MDX syntax error", () => {
    const ast = parse(`---\ntitle: test\n---\n\n<Unclosed\n`);
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags.some((d) => d.severity === "error")).toBe(true);
  });

  it("handles namespace components (ns.Comp)", () => {
    const ast = parse(
      `---\ntitle: test\n---\n\nimport ns from "./ns"\n\n<ns.Comp />\n`,
    );
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("reports namespace component when root is not imported", () => {
    const ast = parse(`---\ntitle: test\n---\n\n<ns.Comp />\n`);
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toContain("ns.Comp");
  });

  it("returns empty for codoc with no view", () => {
    const ast = parse(`---\ntitle: data-only\ndata:\n  x: 1\n---\n`);
    expect(diagnoseCodoc(ast, NO_COMPONENTS)).toEqual([]);
  });

  it("reports multiple issues at once", () => {
    const ast = parse(
      `---\ntitle: test\ndata:\n  score: 1\n---\n\n<Unknown />\n\n{data.bogus}\n`,
    );
    const diags = diagnoseCodoc(ast, NO_COMPONENTS);
    expect(diags).toHaveLength(2);
    expect(diags.filter((d) => d.severity === "error")).toHaveLength(1);
    expect(diags.filter((d) => d.severity === "warning")).toHaveLength(1);
  });
});
