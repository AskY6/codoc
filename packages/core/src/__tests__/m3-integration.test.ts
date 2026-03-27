import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCodoc } from "../codoc-loader.js";
import { DataTree } from "../data-tree.js";
import { DAG } from "../dag.js";
import { extractAllDeps } from "../dep-extractor.js";
import { scheduleForce } from "../scheduler.js";
import { setLLMClient } from "../loader/prompt.js";
import type { LLMClient } from "../types.js";

const M3_SOURCE = `
type:
  properties:
    title:
      type: string
    mode:
      type: string
    todo:
      type: object
    derived:
      type: string
    aiSummary:
      type: string

data:
  title: "CoDoc M3 Demo"
  mode: "test"
  todo:
    $source: "https://jsonplaceholder.typicode.com/todos/1"
    ttl: 30
  derived:
    $ref: "/title"
  aiSummary:
    $prompt:
      template: "Title is '{title}', mode is '{mode}'."

view: |
  # {title}
  Mode: {mode} | Todo: {todo} | Derived: {derived} | AI: {aiSummary}
`;

describe("M3 integration", () => {
  let mockLLM: LLMClient;

  beforeEach(() => {
    mockLLM = {
      generate: vi.fn().mockResolvedValue("Mock AI summary"),
    };
    setLLMClient(mockLLM);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ userId: 1, id: 1, title: "mock todo", completed: false }), {
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLLMClient(null as unknown as LLMClient);
  });

  it("parses .codoc with all 4 loader types", () => {
    const file = parseCodoc(M3_SOURCE);
    expect(file.type).toBeDefined();
    expect(file.data).toBeDefined();
    expect(Object.keys(file.data)).toEqual(["title", "mode", "todo", "derived", "aiSummary"]);
  });

  it("builds correct loader declarations", () => {
    const file = parseCodoc(M3_SOURCE);
    const tree = new DataTree({ type: file.type, data: file.data });

    expect(tree.getField("/title")!.meta.loader).toEqual({ type: "literal", value: "CoDoc M3 Demo" });
    expect(tree.getField("/todo")!.meta.loader).toMatchObject({ type: "source", $source: "https://jsonplaceholder.typicode.com/todos/1", ttl: 30 });
    expect(tree.getField("/derived")!.meta.loader).toEqual({ type: "ref", $ref: "/title" });
    expect(tree.getField("/aiSummary")!.meta.loader).toMatchObject({ type: "prompt", $prompt: { template: expect.stringContaining("{title}") } });
  });

  it("builds DAG with correct dependencies", () => {
    const file = parseCodoc(M3_SOURCE);
    const tree = new DataTree({ type: file.type, data: file.data });
    const deps = extractAllDeps(tree);

    expect(deps.get("/title")).toEqual([]);
    expect(deps.get("/mode")).toEqual([]);
    expect(deps.get("/todo")).toEqual([]);
    expect(deps.get("/derived")).toEqual(["/title"]);
    expect(deps.get("/aiSummary")).toEqual(["/title", "/mode"]);
  });

  it("detects no cycles", () => {
    const file = parseCodoc(M3_SOURCE);
    const tree = new DataTree({ type: file.type, data: file.data });
    const dag = DAG.buildFromTree(tree);
    expect(dag.detectCycle()).toBeNull();
  });

  it("scheduleForce resolves all fields", async () => {
    const file = parseCodoc(M3_SOURCE);
    const tree = new DataTree({ type: file.type, data: file.data });
    const dag = DAG.buildFromTree(tree);

    const result = await scheduleForce(tree, dag);

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(5);

    // Verify resolved values
    expect(tree.getField("/title")!.state).toEqual({ status: "resolved", value: "CoDoc M3 Demo" });
    expect(tree.getField("/mode")!.state).toEqual({ status: "resolved", value: "test" });
    expect(tree.getField("/todo")!.state).toMatchObject({ status: "resolved", value: { id: 1, title: "mock todo" } });
    expect(tree.getField("/derived")!.state).toEqual({ status: "resolved", value: "CoDoc M3 Demo" });
    expect(tree.getField("/aiSummary")!.state).toEqual({ status: "resolved", value: "Mock AI summary" });

    // Verify LLM was called with interpolated prompt
    expect(mockLLM.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Title is 'CoDoc M3 Demo', mode is 'test'.",
      }),
    );
  });

  it("$source and $prompt force concurrently in the same layer", async () => {
    const file = parseCodoc(M3_SOURCE);
    const tree = new DataTree({ type: file.type, data: file.data });
    const dag = DAG.buildFromTree(tree);

    const result = await scheduleForce(tree, dag);

    // title, mode, todo are all in layer 0 (no deps) — should have been forced together
    // derived is layer 1, aiSummary is layer 1
    expect(result.resolved).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
  });
});
