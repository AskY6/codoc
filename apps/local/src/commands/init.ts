// codoc init — scaffold a new workspace.
//
// Creates:
//   ~/.codoc/<name>/              (workspace directory)
//   ~/.codoc/<name>/codoc.config.json (configuration)
//
// With --from <template>:
//   Also copies template codoc files and auto-installs components.
//   Validates each .codoc by evaluating its MDX body before writing,
//   so scope errors (undefined variables, bad expressions) surface
//   immediately instead of at render time.
//
// Idempotent: skips existing files/directories without overwriting.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { evaluate } from "@mdx-js/mdx";
import { parseCodoc } from "@cobook/parser";
import type { CodocAST } from "@cobook/core";
import type { Template, TemplateFile } from "../templates/index.js";
import { addComponent } from "./add.js";
import { BUILTIN_COMPONENT_META } from "../workspace/recognize.js";
import { allPlugins } from "../plugins/registry.js";

interface InitConfig {
  port: number;
  workspaceKind?: string;
  pluginConfig?: Record<string, unknown>;
  commands?: Array<{ name: string; description: string; prompt: string }>;
  quickActions?: Array<{ label: string; prompt: string }>;
  agentInstructions?: string;
}

/**
 * Find the plugin that owns a template, if any.
 * Returns the plugin id (= workspaceKind) or undefined.
 */
function findPluginForTemplate(template: Template): string | undefined {
  for (const plugin of allPlugins()) {
    if (plugin.template?.id === template.id) return plugin.id;
  }
  return undefined;
}

function buildConfig(template?: Template): InitConfig {
  const cfg: InitConfig = { port: 4321 };

  // Plugin binding: write workspaceKind when template belongs to a plugin.
  let pluginOwned = false;
  if (template) {
    const pluginId = findPluginForTemplate(template);
    if (pluginId && pluginId !== "default") {
      cfg.workspaceKind = pluginId;
      pluginOwned = true;
    }
  }

  // Legacy interaction hints (kept for backward compat).
  if (template?.commands && template.commands.length > 0) {
    cfg.commands = template.commands.map((c) => ({ name: c.name, description: c.description, prompt: c.prompt }));
  }
  if (template?.quickActions && template.quickActions.length > 0) {
    cfg.quickActions = template.quickActions.map((a) => ({ label: a.label, prompt: a.prompt }));
  }
  // For plugin-owned templates, agentInstructions is contributed at runtime by
  // plugin.getAgentInstructions() — do not duplicate it into the seeded config
  // (the config field is reserved for user overrides).
  if (template?.agentInstructions && !pluginOwned) {
    cfg.agentInstructions = template.agentInstructions;
  }
  return cfg;
}

export interface InitOptions {
  template?: Template | undefined;
}

export async function initWorkspace(
  workspaceDir: string,
  options: InitOptions = {},
): Promise<void> {
  const name = basename(workspaceDir);

  // Create workspace directory
  const dirCreated = await mkdirIfMissing(workspaceDir);
  if (dirCreated) {
    console.log(`[codoc] created workspace ${name}/`);
  } else {
    console.log(`[codoc] workspace ${name}/ already exists`);
  }

  // Create codoc.config.json (includes template interaction metadata if present)
  const configPath = join(workspaceDir, "codoc.config.json");
  const config = buildConfig(options.template);
  const configCreated = await writeIfMissing(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
  );
  if (configCreated) {
    console.log("[codoc] created codoc.config.json");
  } else {
    console.log("[codoc] codoc.config.json already exists");
  }

  // Apply template if provided
  if (options.template) {
    const tmpl = options.template;
    console.log(`[codoc] applying template: ${tmpl.name}`);

    const files = tmpl.files();

    // Validate .codoc content before writing — catch scope/syntax errors early.
    await validateTemplateContent(tmpl, files);

    for (const file of files) {
      const filePath = join(workspaceDir, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      const created = await writeIfMissing(filePath, file.content);
      if (created) {
        console.log(`  added ${file.path}`);
      } else {
        console.log(`  skip  ${file.path} (already exists)`);
      }
    }

    // Auto-install components
    if (tmpl.components.length > 0) {
      const componentsDir = join(workspaceDir, "components");
      for (const componentName of tmpl.components) {
        await addComponent(componentName, componentsDir);
      }
    }

    console.log(`[codoc] template applied: ${files.length} codoc(s), ${tmpl.components.length} component(s)`);
  }

  console.log("[codoc] workspace initialized at", workspaceDir);
}

// ---------------------------------------------------------------------------
// Template validation — evaluate each .codoc's MDX body in the same scope
// that Preview uses at render time (data injected, meta NOT in scope).
// This catches undefined-variable errors before files hit disk.
// ---------------------------------------------------------------------------

async function validateTemplateContent(
  tmpl: Template,
  files: readonly TemplateFile[],
): Promise<void> {
  const codocFiles = files.filter((f) => f.path.endsWith(".codoc"));
  if (codocFiles.length === 0) return;

  // Collect all component names: platform builtins + template installs + custom .tsx files
  const componentNames = new Set(BUILTIN_COMPONENT_META.map((c) => c.name));
  for (const name of tmpl.components) componentNames.add(name);
  for (const f of files) {
    if (f.path.startsWith("components/") && f.path.endsWith(".tsx")) {
      componentNames.add(basename(f.path, ".tsx"));
    }
  }

  let errorCount = 0;

  for (const file of codocFiles) {
    const errors = await validateCodocBody(file.content, componentNames);
    for (const err of errors) {
      console.error(`[codoc] \u2717 ${file.path}: ${err}`);
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.error(
      `[codoc] template validation: ${errorCount} error(s) — workspace will still be created`,
    );
  }
}

/**
 * Parse a .codoc string, inject `data` into scope (same as Preview),
 * evaluate the MDX, then call the resulting component to trigger all
 * expression evaluation. Returns an empty array if everything is clean.
 */
async function validateCodocBody(
  content: string,
  componentNames: ReadonlySet<string>,
): Promise<string[]> {
  // 1. Parse
  const result = parseCodoc(content);
  if (!result.ok) {
    return [`parse error: ${result.error.kind}`];
  }

  const ast = result.value;
  if (ast.view.kind !== "mdx" || !ast.view.source) return [];

  // 2. Build data object (static values only; refs/sources → null)
  const dataObj: Record<string, unknown> = {};
  for (const [key, field] of ast.data) {
    dataObj[key] = field.kind === "static" ? field.value : null;
  }

  // 3. Evaluate MDX — same scope as Preview.tsx
  try {
    const mdxSource = `export const data = ${JSON.stringify(dataObj)}\n\n${ast.view.source}`;
    const mod = await evaluate(mdxSource, { jsx, jsxs, Fragment } as Parameters<
      typeof evaluate
    >[1]);

    // 4. Render the component tree — this triggers JSX expression evaluation.
    //    Build an explicit stub map from known component names. Each stub
    //    accepts any props and returns null (no real rendering).
    const stubs: Record<string, () => null> = {};
    for (const name of componentNames) {
      stubs[name] = () => null;
    }
    const el = (mod.default as (props: { components: unknown }) => unknown)({
      components: stubs,
    });
    deepEvalElement(el);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }

  return [];
}

/**
 * Recursively walk a React element tree, calling any function components
 * to force evaluation of their JSX expressions. This is a lightweight
 * alternative to renderToString that catches undefined-variable errors
 * without needing react-dom/server.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepEvalElement(el: any): void {
  if (!el || typeof el !== "object") return;
  // Call function components to evaluate their bodies
  if (typeof el.type === "function") {
    const child = el.type(el.props ?? {});
    deepEvalElement(child);
  }
  // Walk children
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) deepEvalElement(child);
  } else if (children) {
    deepEvalElement(children);
  }
}

async function mkdirIfMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    await mkdir(path, { recursive: true });
    return true;
  }
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    await writeFile(path, content, "utf-8");
    return true;
  }
}
