import type { ConnectorDefinition, ConnectorMeta } from "../../connector-types.js";
import { loadLocalDirectory } from "./loader.js";

export const localDirectoryMeta: ConnectorMeta = {
  name: "local-directory",
  displayName: "Local Directory",
  description: "Scan a local directory and return file entries, optionally filtered by extension.",
  configSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the directory" },
      extension: { type: "string", description: "Filter by file extension, e.g. '.jsonl'" },
    },
    required: ["path"],
  },
  authSchema: {},
  exampleYaml: `$source:
  connector: local-directory
  path: /path/to/directory
  extension: .jsonl`,
};

export const localDirectoryConnector = async (
  config: Record<string, unknown>,
): Promise<unknown> => {
  return loadLocalDirectory({
    path: config.path as string,
    extension: config.extension as string | undefined,
  });
};

export const connector: ConnectorDefinition = {
  meta: localDirectoryMeta,
  fn: localDirectoryConnector,
};
