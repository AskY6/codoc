import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { CobookAgentConfig, CobookConfig, CobookWorkflowConfig } from "./types.js";

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
    ...(parsed.agents !== undefined ? { agents: parseAgents(parsed.agents, configPath) } : {}),
    ...(parsed.workflows !== undefined
      ? { workflows: parseWorkflows(parsed.workflows, configPath) }
      : {}),
    ...(Array.isArray(parsed.sources) ? { sources: parsed.sources } : {}),
    ...(isRecord(parsed.build) ? { build: parsed.build } : {})
  };
}

function parseAgents(value: unknown, configPath: string): Record<string, CobookAgentConfig> {
  if (!isRecord(value)) {
    throw new Error(`${configPath}: "agents" must be an object if provided.`);
  }

  const agents: Record<string, CobookAgentConfig> = {};

  for (const [id, rawSpec] of Object.entries(value)) {
    if (!isRecord(rawSpec)) {
      throw new Error(`${configPath}: agent "${id}" must be an object.`);
    }

    if ("name" in rawSpec && typeof rawSpec.name !== "string") {
      throw new Error(`${configPath}: agent "${id}" field "name" must be a string.`);
    }

    if ("description" in rawSpec && typeof rawSpec.description !== "string") {
      throw new Error(`${configPath}: agent "${id}" field "description" must be a string.`);
    }

    if ("prompt" in rawSpec && typeof rawSpec.prompt !== "string") {
      throw new Error(`${configPath}: agent "${id}" field "prompt" must be a string.`);
    }

    if ("outputDir" in rawSpec && typeof rawSpec.outputDir !== "string") {
      throw new Error(`${configPath}: agent "${id}" field "outputDir" must be a string.`);
    }

    if ("pinnedCodocIds" in rawSpec && !isStringArray(rawSpec.pinnedCodocIds)) {
      throw new Error(
        `${configPath}: agent "${id}" field "pinnedCodocIds" must be an array of strings.`
      );
    }

    agents[id] = {
      name: typeof rawSpec.name === "string" ? rawSpec.name : toTitleCase(id),
      ...(typeof rawSpec.description === "string" ? { description: rawSpec.description } : {}),
      ...(typeof rawSpec.prompt === "string" ? { prompt: rawSpec.prompt } : {}),
      ...(isStringArray(rawSpec.pinnedCodocIds)
        ? { pinnedCodocIds: rawSpec.pinnedCodocIds }
        : {}),
      ...(typeof rawSpec.outputDir === "string" ? { outputDir: rawSpec.outputDir } : {})
    };
  }

  return agents;
}

function parseWorkflows(value: unknown, configPath: string): Record<string, CobookWorkflowConfig> {
  if (!isRecord(value)) {
    throw new Error(`${configPath}: "workflows" must be an object if provided.`);
  }

  const workflows: Record<string, CobookWorkflowConfig> = {};

  for (const [id, rawSpec] of Object.entries(value)) {
    if (!isRecord(rawSpec)) {
      throw new Error(`${configPath}: workflow "${id}" must be an object.`);
    }

    if ("name" in rawSpec && typeof rawSpec.name !== "string") {
      throw new Error(`${configPath}: workflow "${id}" field "name" must be a string.`);
    }

    if ("description" in rawSpec && typeof rawSpec.description !== "string") {
      throw new Error(`${configPath}: workflow "${id}" field "description" must be a string.`);
    }

    if ("agent" in rawSpec && typeof rawSpec.agent !== "string") {
      throw new Error(`${configPath}: workflow "${id}" field "agent" must be a string.`);
    }

    if ("outputDir" in rawSpec && typeof rawSpec.outputDir !== "string") {
      throw new Error(`${configPath}: workflow "${id}" field "outputDir" must be a string.`);
    }

    if ("pinnedCodocIds" in rawSpec && !isStringArray(rawSpec.pinnedCodocIds)) {
      throw new Error(
        `${configPath}: workflow "${id}" field "pinnedCodocIds" must be an array of strings.`
      );
    }

    if ("dataRefs" in rawSpec && !isStringRecord(rawSpec.dataRefs)) {
      throw new Error(
        `${configPath}: workflow "${id}" field "dataRefs" must be an object of string refs.`
      );
    }

    workflows[id] = {
      name: typeof rawSpec.name === "string" ? rawSpec.name : toTitleCase(id),
      ...(typeof rawSpec.description === "string" ? { description: rawSpec.description } : {}),
      ...(typeof rawSpec.agent === "string" ? { agent: rawSpec.agent } : {}),
      ...(isStringArray(rawSpec.pinnedCodocIds)
        ? { pinnedCodocIds: rawSpec.pinnedCodocIds }
        : {}),
      ...(isStringRecord(rawSpec.dataRefs) ? { dataRefs: rawSpec.dataRefs } : {}),
      ...(typeof rawSpec.outputDir === "string" ? { outputDir: rawSpec.outputDir } : {})
    };
  }

  return workflows;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function toTitleCase(value: string): string {
  return value
    .replace(/[._/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
