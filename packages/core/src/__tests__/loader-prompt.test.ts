import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promptLoader, setLLMClient, extractTemplateVars } from "../loader/prompt.js";
import type { CodataField, ForceContext, LLMClient } from "../types.js";

function makePromptField(
  template: string,
  model?: string,
  schema?: Record<string, unknown>,
): CodataField {
  return {
    path: "/summary",
    meta: {
      schema,
      loader: {
        type: "prompt" as const,
        $prompt: { template, model },
      },
    },
    state: { status: "idle" },
  };
}

describe("extractTemplateVars", () => {
  it("extracts simple vars", () => {
    expect(extractTemplateVars("Hello {name}, you have {count} items")).toEqual([
      "name",
      "count",
    ]);
  });

  it("returns empty for no vars", () => {
    expect(extractTemplateVars("Hello world")).toEqual([]);
  });

  it("handles duplicate vars", () => {
    expect(extractTemplateVars("{a} and {a}")).toEqual(["a", "a"]);
  });

  it("extracts dot-separated nested paths", () => {
    expect(extractTemplateVars("From {origin.region} at {origin.altitude}")).toEqual([
      "origin.region",
      "origin.altitude",
    ]);
  });
});

describe("promptLoader", () => {
  let mockClient: LLMClient;

  beforeEach(() => {
    mockClient = {
      generate: vi.fn().mockResolvedValue("Generated summary"),
    };
    setLLMClient(mockClient);
  });

  afterEach(() => {
    setLLMClient(null as unknown as LLMClient);
  });

  it("calls LLM with interpolated template", async () => {
    const field = makePromptField("Summarize: {title}");
    const context: ForceContext = {
      force: vi.fn().mockResolvedValue("Hello CoDoc"),
      forceStack: new Set(),
    };

    const result = await promptLoader(field, context);

    expect(result).toBe("Generated summary");
    expect(context.force).toHaveBeenCalledWith("/title");
    expect(mockClient.generate).toHaveBeenCalledWith({
      model: "claude-sonnet-4-20250514",
      prompt: "Summarize: Hello CoDoc",
      schema: {},
    });
  });

  it("uses custom model", async () => {
    const field = makePromptField("Tell me about {topic}", "claude-opus-4-20250514");
    const context: ForceContext = {
      force: vi.fn().mockResolvedValue("weather"),
      forceStack: new Set(),
    };

    await promptLoader(field, context);

    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-20250514" }),
    );
  });

  it("passes schema to LLM", async () => {
    const schema = { type: "object", properties: { text: { type: "string" } } };
    const field = makePromptField("Summarize: {data}", undefined, schema);
    const context: ForceContext = {
      force: vi.fn().mockResolvedValue("some data"),
      forceStack: new Set(),
    };

    await promptLoader(field, context);

    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({ schema }),
    );
  });

  it("resolves multiple template vars", async () => {
    const field = makePromptField("Compare {a} with {b}");
    const forceImpl = vi.fn().mockImplementation((path: string) => {
      if (path === "/a") return Promise.resolve("apple");
      if (path === "/b") return Promise.resolve("banana");
      return Promise.reject(new Error("unknown"));
    });
    const context: ForceContext = { force: forceImpl, forceStack: new Set() };

    await promptLoader(field, context);

    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Compare apple with banana" }),
    );
  });

  it("resolves dot-separated nested paths", async () => {
    const field = makePromptField("Coffee from {origin.region} at {origin.altitude}");
    const forceImpl = vi.fn().mockImplementation((path: string) => {
      if (path === "/origin/region") return Promise.resolve("Yirgacheffe, Sidamo");
      if (path === "/origin/altitude") return Promise.resolve("1,700 – 2,200m");
      return Promise.reject(new Error("unknown"));
    });
    const context: ForceContext = { force: forceImpl, forceStack: new Set() };

    await promptLoader(field, context);

    expect(forceImpl).toHaveBeenCalledWith("/origin/region");
    expect(forceImpl).toHaveBeenCalledWith("/origin/altitude");
    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Coffee from Yirgacheffe, Sidamo at 1,700 – 2,200m",
      }),
    );
  });

  it("throws if no LLM client configured", async () => {
    setLLMClient(null as unknown as LLMClient);
    const field = makePromptField("Hello {x}");
    const context: ForceContext = {
      force: vi.fn(),
      forceStack: new Set(),
    };

    await expect(promptLoader(field, context)).rejects.toMatchObject({
      kind: "prompt",
      retryable: false,
    });
  });

  it("wraps LLM errors as retryable", async () => {
    (mockClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("API rate limit"),
    );
    const field = makePromptField("Hello");
    const context: ForceContext = {
      force: vi.fn(),
      forceStack: new Set(),
    };

    await expect(promptLoader(field, context)).rejects.toMatchObject({
      kind: "prompt",
      retryable: true,
      message: expect.stringContaining("API rate limit"),
    });
  });

  it("throws if called on non-prompt field", async () => {
    const field: CodataField = {
      path: "/x",
      meta: { loader: { type: "literal", value: 1 } },
      state: { status: "idle" },
    };
    const context: ForceContext = { force: vi.fn(), forceStack: new Set() };

    await expect(promptLoader(field, context)).rejects.toThrow("non-prompt");
  });
});
