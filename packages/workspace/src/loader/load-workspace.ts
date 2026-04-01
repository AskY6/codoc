import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseCodocText,
  parseComponentRegistryText,
  type ComponentSpec,
  type ParsedCodoc
} from "@cobook/core";

import { loadCobookConfig } from "../config/load-cobook-config.js";
import { scanCodocFiles } from "../scanner/scan-codoc-files.js";

import type { LoadedWorkspace, CodocSummary, WorkspaceSnapshot } from "./types.js";

export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const config = await loadCobookConfig(root);
  const codocPaths = await scanCodocFiles(root, config);
  const codocs = new Map<string, ParsedCodoc>();
  const componentRegistry = await loadComponentRegistry(root, config);

  for (const relativePath of codocPaths) {
    const raw = await readFile(join(root, relativePath), "utf8");
    const codoc = parseCodocText(relativePath, raw);

    if (codocs.has(codoc.id)) {
      throw new Error(`Duplicate codoc id "${codoc.id}" found in workspace.`);
    }

    codocs.set(codoc.id, codoc);
  }

  return {
    root,
    config,
    codocs,
    componentRegistry
  };
}

export function summarizeCodoc(codoc: ParsedCodoc): CodocSummary {
  return {
    id: codoc.id,
    filePath: codoc.filePath,
    hasData: codoc.data !== undefined,
    hasView: codoc.view !== undefined,
    hasComponents: codoc.component !== undefined
  };
}

export function toWorkspaceSnapshot(workspace: LoadedWorkspace): WorkspaceSnapshot {
  return {
    root: workspace.root,
    config: workspace.config,
    codocs: Array.from(workspace.codocs.values()).map(summarizeCodoc),
    componentRegistry: workspace.componentRegistry
  };
}

async function loadComponentRegistry(
  root: string,
  config: LoadedWorkspace["config"]
): Promise<Record<string, ComponentSpec>> {
  if (!config.components?.$ref) {
    return {};
  }

  const filePath = config.components.$ref.replace(/^\.\//, "");
  const raw = await readFile(join(root, filePath), "utf8");
  return parseComponentRegistryText(filePath, raw);
}
