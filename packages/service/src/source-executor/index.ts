import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseFileSourceContent, type DataSpec, type NodeKey } from "@cobook/core";

export interface SourceExecutionContext {
  workspaceRoot: string;
  node: NodeKey;
  codocFilePath: string;
}

export interface SourceExecutor {
  resolve(spec: DataSpec, context: SourceExecutionContext): Promise<unknown>;
}

export function createLocalSourceExecutor(): SourceExecutor {
  return {
    async resolve(spec, context) {
      switch (spec.kind) {
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
        case "codoc":
        case "object":
          throw new Error(
            `Source executor cannot directly resolve "${spec.kind}" for node "${context.node}".`
          );
      }
    }
  };
}
