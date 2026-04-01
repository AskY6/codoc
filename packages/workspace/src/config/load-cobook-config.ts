import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { CobookConfig } from "./types.js";

export async function loadCobookConfig(root: string): Promise<CobookConfig> {
  const configPath = join(root, "cobook.yaml");
  const raw = await readFile(configPath, "utf8");
  const parsed = parseYaml(raw);

  if (!isRecord(parsed)) {
    throw new Error(`Config at "${configPath}" must parse to an object.`);
  }

  return {
    cobook: expectString(parsed.cobook, `${configPath}: "cobook" must be a string.`),
    name: expectString(parsed.name, `${configPath}: "name" must be a string.`),
    ...(typeof parsed.entry === "string" ? { entry: parsed.entry } : {}),
    ...(isStringArray(parsed.include) ? { include: parsed.include } : {}),
    ...(isStringArray(parsed.exclude) ? { exclude: parsed.exclude } : {}),
    ...(isRecord(parsed.schemas) && typeof parsed.schemas.$ref === "string"
      ? { schemas: { $ref: parsed.schemas.$ref } }
      : {}),
    ...(isRecord(parsed.components) && typeof parsed.components.$ref === "string"
      ? { components: { $ref: parsed.components.$ref } }
      : {}),
    ...(isRecord(parsed.agents) ? { agents: parsed.agents } : {}),
    ...(Array.isArray(parsed.sources) ? { sources: parsed.sources } : {}),
    ...(isRecord(parsed.build) ? { build: parsed.build } : {})
  };
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }

  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
