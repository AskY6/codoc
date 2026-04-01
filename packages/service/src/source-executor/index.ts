import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseFileSourceContent, parseRssSourceContent, type DataSpec, type NodeKey } from "@cobook/core";

export interface SourceExecutionContext {
  workspaceRoot: string;
  node: NodeKey;
  codocFilePath: string;
}

export interface SourceExecutor {
  resolve(spec: DataSpec, context: SourceExecutionContext): Promise<unknown>;
}

type SourcePresetSpec = Extract<DataSpec, { kind: "static" | "file" | "http" | "rss" | "preset" }>;

export function createLocalSourceExecutor(
  presets: Record<string, SourcePresetSpec> = {}
): SourceExecutor {
  return {
    async resolve(spec, context) {
      return resolveSourceSpec(spec, context, presets, []);
    }
  };
}

async function resolveSourceSpec(
  spec: DataSpec,
  context: SourceExecutionContext,
  presets: Record<string, SourcePresetSpec>,
  presetStack: string[]
): Promise<unknown> {
  switch (spec.kind) {
    case "preset": {
      const preset = presets[spec.name];
      if (!preset) {
        throw new Error(`Source preset "${spec.name}" was not found for node "${context.node}".`);
      }

      if (presetStack.includes(spec.name)) {
        throw new Error(
          `Source preset cycle detected for node "${context.node}": ${[...presetStack, spec.name].join(" -> ")}.`
        );
      }

      return resolveSourceSpec(preset, context, presets, [...presetStack, spec.name]);
    }
    case "static":
      return spec.value;
    case "file": {
      const absolutePath = join(
        context.workspaceRoot,
        dirname(context.codocFilePath),
        spec.path
      );
      const raw = await readFile(absolutePath, "utf8");
      return parseFileSourceContent(spec.format, raw);
    }
    case "http": {
      const response = await fetch(spec.url, {
        method: spec.method,
        ...(spec.headers ? { headers: spec.headers } : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {})
      });

      if (!response.ok) {
        throw new Error(
          `HTTP source "${spec.url}" failed with ${response.status} ${response.statusText}.`
        );
      }

      const raw = await response.text();
      return parseFileSourceContent(spec.format, raw);
    }
    case "rss": {
      const response = await fetch(spec.url, {
        method: "GET",
        ...(spec.headers ? { headers: spec.headers } : {})
      });

      if (!response.ok) {
        throw new Error(
          `RSS source "${spec.url}" failed with ${response.status} ${response.statusText}.`
        );
      }

      const raw = await response.text();
      return parseRssSourceContent(raw, spec.limit);
    }
    case "codoc":
    case "object":
      throw new Error(
        `Source executor cannot directly resolve "${spec.kind}" for node "${context.node}".`
      );
  }
}
