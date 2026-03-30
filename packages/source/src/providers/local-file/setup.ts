import type { ConnectorDefinition, ConnectorMeta } from "../../connector-types.js";
import { loadLocalFile } from "./loader.js";

export const localFileMeta: ConnectorMeta = {
  name: "local-file",
  displayName: "Local File",
  description: "Read a local file and parse its contents (JSON, JSONL, or text).",
  configSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file" },
      parser: { type: "string", enum: ["json", "jsonl", "text"], description: "Parser to use (defaults to extension-based detection)" },
    },
    required: ["path"],
  },
  authSchema: {},
  exampleYaml: `$source:
  connector: local-file
  path: /path/to/file.jsonl
  parser: jsonl`,
};

export const localFileConnector = async (
  config: Record<string, unknown>,
): Promise<unknown> => {
  return loadLocalFile({
    path: config.path as string,
    parser: config.parser as "json" | "jsonl" | "text" | undefined,
  });
};

export const connector: ConnectorDefinition = {
  meta: localFileMeta,
  fn: localFileConnector,
};
