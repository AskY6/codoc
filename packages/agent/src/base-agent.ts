import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChatEvent, ChatInput, CobookService } from "@cobook/service";
import type { CodocSummary, ParsedCodoc, WorkspaceSnapshot } from "@cobook/service";
import { stringify as stringifyYaml } from "yaml";

export interface BaseAgent {
  run(input: ChatInput, service: CobookService): AsyncIterable<ChatEvent>;
}

interface ProjectSummary {
  name: string;
  root: string;
  entryFilePath: string | null;
  entryCodocId: string | null;
  codocCount: number;
  codocs: Array<
    CodocSummary & {
      isEntry: boolean;
    }
  >;
  defaultContextCodocIds: string[];
}

interface ChatContextPlan {
  projectSummary: ProjectSummary;
  availableAgents: WorkspaceAgent[];
  requestedAgentId: string | null;
  activeAgent: WorkspaceAgent | null;
  agentPinnedCodocIds: string[];
  requestedPinnedCodocIds: string[];
  pinnedCodocIds: string[];
  ignoredPinnedCodocIds: string[];
  contextCodocIds: string[];
  pinnedCodocs: Array<{
    codocId: string;
    codoc: ParsedCodoc;
  }>;
}

interface WorkspaceAgent {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  pinnedCodocIds: string[];
  outputDir?: string;
}

type WriteAttemptResult =
  | {
      ok: true;
      result: {
        codocId: string;
        filePath: string;
        changed: boolean;
        build: {
          success: boolean;
          errors: Array<{
            code: string;
            message: string;
          }>;
          affectedNodes: string[];
        };
      };
    }
  | {
      ok: false;
      error: Error;
      recoveryFilePath: string | null;
      recoveryError: Error | null;
    };

export class RuleBasedBaseAgent implements BaseAgent {
  async *run(input: ChatInput, service: CobookService): AsyncIterable<ChatEvent> {
    yield {
      kind: "status",
      status: "thinking",
      message: "Interpreting chat request."
    };

    const message = input.message.trim();
    const lower = message.toLowerCase();

    if (isProjectSummaryRequest(lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Reading project summary."
      };
      const projectSummary = await buildProjectSummary(service);
      yield {
        kind: "message",
        content: JSON.stringify(projectSummary, null, 2)
      };
      yield doneEvent();
      return;
    }

    if (isListRequest(lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Listing codocs."
      };
      const codocs = await service.listCodocs();
      yield {
        kind: "message",
        content: JSON.stringify(codocs, null, 2)
      };
      yield doneEvent();
      return;
    }

    if (isListAgentsRequest(lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Listing configured agents."
      };
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);
      yield {
        kind: "message",
        content: JSON.stringify(
          {
            requestedAgentId: contextPlan.requestedAgentId,
            activeAgent: contextPlan.activeAgent,
            agents: contextPlan.availableAgents
          },
          null,
          2
        )
      };
      yield doneEvent();
      return;
    }

    const readMatch = message.match(/\bread\s+codoc\s+([a-z0-9._/-]+)\b/i);
    if (readMatch?.[1]) {
      const codocId = readMatch[1];
      yield {
        kind: "status",
        status: "reading",
        message: `Reading codoc "${codocId}".`
      };
      const codoc = await service.readCodoc(codocId);
      yield {
        kind: "message",
        content: JSON.stringify(codoc, null, 2)
      };
      yield doneEvent();
      return;
    }

    const resolveMatch = message.match(/\bresolve\s+([a-z0-9:_./-]+)\b/i);
    if (resolveMatch?.[1]) {
      const nodeKey = resolveMatch[1];
      yield {
        kind: "status",
        status: "reading",
        message: `Resolving "${nodeKey}".`
      };
      const resolved = await service.resolve(nodeKey);
      yield {
        kind: "message",
        content: JSON.stringify(resolved, null, 2)
      };
      yield doneEvent();
      return;
    }

    const refactorMatch = message.match(/\brefactor\s+codoc\s+([a-z0-9._/-]+)\b/i);
    if (refactorMatch?.[1]) {
      const codocId = refactorMatch[1];
      const existingCodoc = await service.readCodoc(codocId);
      const content = serializeParsedCodoc(existingCodoc);

      yield {
        kind: "status",
        status: "writing",
        message: `Refactoring "${existingCodoc.filePath}".`
      };
      const writeAttempt = await attemptWriteCodoc(service, {
        codocId: existingCodoc.id,
        filePath: existingCodoc.filePath,
        content,
        overwrite: true
      });
      if (!writeAttempt.ok) {
        if (writeAttempt.recoveryFilePath) {
          yield {
            kind: "artifact",
            filePath: writeAttempt.recoveryFilePath
          };
        }
        yield {
          kind: "message",
          content: formatWriteFailure(existingCodoc.filePath, writeAttempt)
        };
        yield doneEvent();
        return;
      }
      const written = writeAttempt.result;
      yield {
        kind: "artifact",
        filePath: written.filePath
      };
      yield {
        kind: "message",
        content: [
          `Refactored codoc "${existingCodoc.id}" to the canonical workspace format.`,
          formatWriteResult(written)
        ].join("\n")
      };
      yield doneEvent();
      return;
    }

    const codocBlock = extractCodocBlock(message);
    if (codocBlock) {
      const existingCodoc = await tryReadCodoc(service, codocBlock.codocId);
      const overwrite = /\b(update|overwrite|replace)\b/i.test(message) || existingCodoc !== null;
      const filePath = extractTargetFilePath(message, codocBlock.codocId, existingCodoc?.filePath);

      yield {
        kind: "status",
        status: "writing",
        message: `Writing "${filePath}".`
      };
      const writeAttempt = await attemptWriteCodoc(service, {
        codocId: codocBlock.codocId,
        filePath,
        content: codocBlock.content,
        overwrite
      });
      if (!writeAttempt.ok) {
        if (writeAttempt.recoveryFilePath) {
          yield {
            kind: "artifact",
            filePath: writeAttempt.recoveryFilePath
          };
        }
        yield {
          kind: "message",
          content: formatWriteFailure(filePath, writeAttempt)
        };
        yield doneEvent();
        return;
      }
      const written = writeAttempt.result;
      yield {
        kind: "artifact",
        filePath: written.filePath
      };
      yield {
        kind: "message",
        content: formatWriteResult(written)
      };
      yield doneEvent();
      return;
    }

    const generatedRequest = extractGeneratedCodocRequest(message);
    if (generatedRequest) {
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);
      const generated = await generateTemplateCodoc(
        service,
        generatedRequest,
        contextPlan
      );

      yield {
        kind: "status",
        status: "writing",
        message: contextPlan.activeAgent
          ? `Generating "${generated.filePath}" with agent "${contextPlan.activeAgent.id}".`
          : `Generating "${generated.filePath}".`
      };
      const writeAttempt = await attemptWriteCodoc(service, {
        codocId: generated.codocId,
        filePath: generated.filePath,
        content: generated.content,
        overwrite: generated.overwrite
      });
      if (!writeAttempt.ok) {
        if (writeAttempt.recoveryFilePath) {
          yield {
            kind: "artifact",
            filePath: writeAttempt.recoveryFilePath
          };
        }
        yield {
          kind: "message",
          content: formatWriteFailure(generated.filePath, writeAttempt)
        };
        yield doneEvent();
        return;
      }
      const written = writeAttempt.result;
      yield {
        kind: "artifact",
        filePath: written.filePath
      };
      yield {
        kind: "message",
        content: [
          contextPlan.activeAgent
            ? `Used configured agent "${contextPlan.activeAgent.id}" (${contextPlan.activeAgent.name}).`
            : null,
          formatWriteResult(written)
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      };
      yield doneEvent();
      return;
    }

    yield {
      kind: "status",
      status: "reading",
      message: "Reading project summary, configured agents, and pinned codocs."
    };

    const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);

    yield {
      kind: "message",
      content: JSON.stringify(
        {
          message:
            "The base agent currently supports: project summary, list codocs, list agents, read codoc <id>, resolve <node>, refactor codoc <id>, or write/update a codoc via a fenced code block.",
          requestedAgentId: contextPlan.requestedAgentId,
          activeAgent: contextPlan.activeAgent,
          ...(contextPlan.availableAgents.length > 0
            ? { availableAgents: contextPlan.availableAgents }
            : {}),
          projectSummary: contextPlan.projectSummary,
          context: {
            agentPinnedCodocIds: contextPlan.agentPinnedCodocIds,
            requestedPinnedCodocIds: contextPlan.requestedPinnedCodocIds,
            pinnedCodocIds: contextPlan.pinnedCodocIds,
            ignoredPinnedCodocIds: contextPlan.ignoredPinnedCodocIds,
            contextCodocIds: contextPlan.contextCodocIds
          },
          ...(contextPlan.pinnedCodocs.length > 0 ? { pinned: contextPlan.pinnedCodocs } : {})
        },
        null,
        2
      )
    };
    yield doneEvent();
  }
}

export class StubBaseAgent extends RuleBasedBaseAgent {}

function isProjectSummaryRequest(message: string): boolean {
  return /\b(workspace|project)\s+summary\b/.test(message);
}

function isListRequest(message: string): boolean {
  return /\b(list|show)\s+codocs\b/.test(message);
}

function isListAgentsRequest(message: string): boolean {
  return /\b(list|show)\s+agents\b/.test(message);
}

function extractCodocBlock(
  message: string
): {
  codocId: string;
  content: string;
} | null {
  const match = message.match(/```(?:yaml|yml|codoc)?\n([\s\S]*?)```/i);
  if (!match?.[1]) {
    return null;
  }

  const content = match[1].trim();
  if (content.length === 0) {
    return null;
  }

  const idMatch = content.match(/^\s*id\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
  const codocId = idMatch?.[1]?.trim();
  if (!codocId) {
    return null;
  }

  return {
    codocId,
    content: `${content}\n`
  };
}

function extractTargetFilePath(
  message: string,
  codocId: string,
  fallbackFilePath?: string
): string {
  const pathMatch = message.match(/(?:to|at|into)\s+([^\s]+\.codoc)\b/i);
  return pathMatch?.[1] ?? fallbackFilePath ?? `${codocId}.codoc`;
}

async function tryReadCodoc(service: CobookService, codocId: string) {
  try {
    return await service.readCodoc(codocId);
  } catch {
    return null;
  }
}

function extractGeneratedCodocRequest(message: string): {
  codocId: string;
  filePath?: string;
  topic?: string;
  overwrite: boolean;
} | null {
  const createMatch = message.match(
    /\b(create|draft|generate|update)\s+(?:a\s+)?(?:note|summary|task)?\s*codoc\s+([a-z0-9._/-]+)(?:\s+(?:at|to|into)\s+([^\s]+\.codoc))?(?:\s+about\s+([\s\S]+))?/i
  );
  if (!createMatch?.[2]) {
    return null;
  }

  return {
    codocId: createMatch[2],
    ...(createMatch[3] ? { filePath: createMatch[3] } : {}),
    ...(createMatch[4]?.trim() ? { topic: createMatch[4].trim() } : {}),
    overwrite: createMatch[1]?.toLowerCase() === "update"
  };
}

async function generateTemplateCodoc(
  service: CobookService,
  request: {
    codocId: string;
    filePath?: string;
    topic?: string;
    overwrite: boolean;
  },
  contextPlan: ChatContextPlan
): Promise<{
  codocId: string;
  filePath: string;
  content: string;
  overwrite: boolean;
}> {
  const existingCodoc = await tryReadCodoc(service, request.codocId);
  const relatedCodocs = contextPlan.contextCodocIds.filter((codocId) => codocId !== request.codocId);
  const title = toTitleCase(request.codocId.replace(/[._/-]+/g, " "));
  const summary = request.topic ?? "Fill in the key point you want this codoc to capture.";
  const contentLines = ['codoc: "0.1"', `id: ${JSON.stringify(request.codocId)}`];

  if (contextPlan.activeAgent) {
    contentLines.push(
      "",
      "meta:",
      "  agent:",
      `    id: ${JSON.stringify(contextPlan.activeAgent.id)}`,
      `    name: ${JSON.stringify(contextPlan.activeAgent.name)}`
    );
  }

  contentLines.push("", "data:", `  title: ${JSON.stringify(title)}`, `  summary: ${JSON.stringify(summary)}`);

  if (relatedCodocs && relatedCodocs.length > 0) {
    contentLines.push("  relatedCodocs:");
    for (const codocId of relatedCodocs) {
      contentLines.push(`    - ${JSON.stringify(codocId)}`);
    }
  }

  contentLines.push(
    "",
    "view: |",
    "  # {data.title}",
    "",
    "  {data.summary}"
  );

  return {
    codocId: request.codocId,
    filePath:
      request.filePath ??
      existingCodoc?.filePath ??
      buildGeneratedCodocFilePath(request.codocId, contextPlan.activeAgent),
    content: `${contentLines.join("\n")}\n`,
    overwrite: request.overwrite || existingCodoc !== null
  };
}

async function buildProjectSummary(service: CobookService): Promise<ProjectSummary> {
  const workspace = await service.getWorkspace();
  return buildProjectSummaryFromWorkspace(workspace);
}

function buildProjectSummaryFromWorkspace(workspace: WorkspaceSnapshot): ProjectSummary {
  const entryFilePath = normalizeEntryPath(workspace);
  const codocs = workspace.codocs.map((codoc) => ({
    ...codoc,
    isEntry: codoc.filePath === entryFilePath
  }));
  const entryCodocId = codocs.find((codoc) => codoc.isEntry)?.id ?? null;
  const defaultContextCodocIds = [
    ...(entryCodocId ? [entryCodocId] : []),
    ...codocs.filter((codoc) => codoc.id !== entryCodocId).map((codoc) => codoc.id)
  ].slice(0, 4);

  return {
    name: workspace.config.name,
    root: workspace.root,
    entryFilePath,
    entryCodocId,
    codocCount: codocs.length,
    codocs,
    defaultContextCodocIds
  };
}

async function buildChatContextPlan(
  service: CobookService,
  rawPinnedCodocIds: string[] | undefined,
  requestedAgentId: string | undefined
): Promise<ChatContextPlan> {
  const workspace = await service.getWorkspace();
  const projectSummary = buildProjectSummaryFromWorkspace(workspace);
  const codocOrder = new Map(projectSummary.codocs.map((codoc, index) => [codoc.id, index]));
  const availableAgents = listWorkspaceAgents(workspace);
  const activeAgent = resolveWorkspaceAgent(availableAgents, requestedAgentId);
  const agentPinnedCodocIds = uniqueStrings(activeAgent?.pinnedCodocIds ?? []);
  const requestedPinnedCodocIds = rawPinnedCodocIds ?? [];
  const uniqueRequestedPinnedCodocIds = uniqueStrings([
    ...agentPinnedCodocIds,
    ...requestedPinnedCodocIds
  ]);
  const pinnedIds = uniqueRequestedPinnedCodocIds.filter((codocId) => codocOrder.has(codocId));
  const pinnedCodocIds = sortCodocIdsByProjectOrder(pinnedIds, codocOrder);
  const ignoredPinnedCodocIds = uniqueRequestedPinnedCodocIds.filter(
    (codocId) => !codocOrder.has(codocId)
  );
  const contextLimit = Math.max(pinnedCodocIds.length, projectSummary.defaultContextCodocIds.length);
  const contextCodocIds = [
    ...pinnedCodocIds,
    ...projectSummary.defaultContextCodocIds.filter((codocId) => !pinnedCodocIds.includes(codocId))
  ].slice(0, contextLimit);
  const pinnedCodocs = await Promise.all(
    pinnedCodocIds.map(async (codocId) => ({
      codocId,
      codoc: await service.readCodoc(codocId)
    }))
  );

  return {
    projectSummary,
    availableAgents,
    requestedAgentId: requestedAgentId ?? null,
    activeAgent,
    agentPinnedCodocIds,
    requestedPinnedCodocIds,
    pinnedCodocIds,
    ignoredPinnedCodocIds,
    contextCodocIds,
    pinnedCodocs
  };
}

function listWorkspaceAgents(workspace: WorkspaceSnapshot): WorkspaceAgent[] {
  return Object.entries(workspace.config.agents ?? {}).map(([id, spec]) => ({
    id,
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.prompt ? { prompt: spec.prompt } : {}),
    pinnedCodocIds: spec.pinnedCodocIds ?? [],
    ...(spec.outputDir ? { outputDir: spec.outputDir } : {})
  }));
}

function resolveWorkspaceAgent(
  availableAgents: WorkspaceAgent[],
  requestedAgentId: string | undefined
): WorkspaceAgent | null {
  if (!requestedAgentId) {
    return null;
  }

  const activeAgent = availableAgents.find((agent) => agent.id === requestedAgentId);
  if (!activeAgent) {
    throw new Error(`Configured agent "${requestedAgentId}" was not found in this workspace.`);
  }

  return activeAgent;
}

function normalizeEntryPath(workspace: WorkspaceSnapshot): string | null {
  if (!workspace.config.entry) {
    return null;
  }

  return workspace.config.entry.replace(/^\.\//, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sortCodocIdsByProjectOrder(
  codocIds: string[],
  codocOrder: Map<string, number>
): string[] {
  return [...codocIds].sort((left, right) => {
    return (codocOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (codocOrder.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
}

function buildGeneratedCodocFilePath(codocId: string, activeAgent: WorkspaceAgent | null): string {
  const outputDir = normalizeOutputDir(activeAgent?.outputDir);
  return outputDir ? `${outputDir}/${codocId}.codoc` : `${codocId}.codoc`;
}

function normalizeOutputDir(outputDir: string | undefined): string | null {
  if (!outputDir) {
    return null;
  }

  const normalized = outputDir.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

async function attemptWriteCodoc(
  service: CobookService,
  input: {
    codocId: string;
    filePath: string;
    content: string;
    overwrite?: boolean;
  }
): Promise<WriteAttemptResult> {
  try {
    return {
      ok: true,
      result: await service.writeCodoc(input)
    };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      return {
        ok: false,
        error: normalizedError,
        recoveryFilePath: await persistRecoveryDraft(service, input.filePath, input.content),
        recoveryError: null
      };
    } catch (recoveryError) {
      return {
        ok: false,
        error: normalizedError,
        recoveryFilePath: null,
        recoveryError:
          recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError))
      };
    }
  }
}

async function persistRecoveryDraft(
  service: CobookService,
  filePath: string,
  content: string
): Promise<string> {
  const workspace = await service.getWorkspace();
  const recoveryFilePath = join(
    ".cobook",
    "recovery",
    `${createRecoveryTimestamp()}-${sanitizeRecoveryName(filePath)}.txt`
  );
  const absolutePath = join(workspace.root, recoveryFilePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");

  return recoveryFilePath;
}

function createRecoveryTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeRecoveryName(value: string): string {
  const sanitized = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized : "codoc";
}

function formatWriteFailure(
  filePath: string,
  result: Extract<WriteAttemptResult, { ok: false }>
): string {
  const lines = [
    `Failed to write "${filePath}". Workspace changes were rolled back.`,
    result.error.message
  ];

  if (result.recoveryFilePath) {
    lines.push(`Recovery draft saved to "${result.recoveryFilePath}".`);
  } else if (result.recoveryError) {
    lines.push(`Failed to save a recovery draft: ${result.recoveryError.message}`);
  }

  return lines.join("\n");
}

function serializeParsedCodoc(codoc: ParsedCodoc): string {
  const document = {
    codoc: codoc.codoc,
    id: codoc.id,
    ...(codoc.meta ? { meta: codoc.meta } : {}),
    ...(codoc.data ? { data: serializeDataSection(codoc.data) } : {}),
    ...(codoc.component ? { component: serializeComponentSection(codoc.component) } : {}),
    ...(codoc.view ? { view: serializeViewSpec(codoc.view) } : {})
  };

  return stringifyYaml(document, {
    lineWidth: 0
  });
}

function serializeDataSection(data: ParsedCodoc["data"]): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(data ?? {})) {
    serialized[key] = serializeDataSpec(spec);
  }

  return serialized;
}

function serializeDataSpec(spec: unknown): unknown {
  if (!isRecord(spec) || typeof spec.kind !== "string") {
    return spec;
  }

  switch (spec.kind) {
    case "static":
      return {
        $source: "static",
        value: spec.value
      };
    case "file":
      return {
        $source: "file",
        path: spec.path,
        format: spec.format
      };
    case "http":
      return {
        $source: "http",
        url: spec.url,
        ...(spec.method !== undefined ? { method: spec.method } : {}),
        ...(spec.headers !== undefined ? { headers: spec.headers } : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        format: spec.format
      };
    case "rss":
      return {
        $source: "rss",
        url: spec.url,
        ...(spec.headers !== undefined ? { headers: spec.headers } : {}),
        ...(spec.limit !== undefined ? { limit: spec.limit } : {})
      };
    case "codoc":
      return {
        $source: "codoc",
        ...(isRecord(spec.ref) && typeof spec.ref.raw === "string" ? { $ref: spec.ref.raw } : {}),
        ...(spec.defaultValue !== undefined ? { $default: spec.defaultValue } : {})
      };
    case "object": {
      const fields = isRecord(spec.fields) ? spec.fields : {};
      const serializedFields: Record<string, unknown> = {};

      for (const [key, fieldSpec] of Object.entries(fields)) {
        serializedFields[key] = serializeDataSpec(fieldSpec);
      }

      return serializedFields;
    }
    default:
      return spec;
  }
}

function serializeComponentSection(component: ParsedCodoc["component"]): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(component ?? {})) {
    serialized[key] = serializeComponentSpec(spec);
  }

  return serialized;
}

function serializeComponentSpec(spec: unknown): unknown {
  if (!isRecord(spec) || typeof spec.kind !== "string") {
    return spec;
  }

  switch (spec.kind) {
    case "local":
      return {
        $source: "local",
        path: spec.path
      };
    case "inline":
      return {
        $source: "inline",
        code: spec.code
      };
    case "codoc":
      return {
        $source: "codoc",
        $ref: spec.ref
      };
    case "builtin":
      return {
        $source: "builtin",
        name: spec.name
      };
    case "remote":
      return {
        $source: "remote",
        ...(spec.package !== undefined ? { package: spec.package } : {}),
        ...(spec.url !== undefined ? { url: spec.url } : {}),
        ...(spec.export !== undefined ? { export: spec.export } : {})
      };
    default:
      return spec;
  }
}

function serializeViewSpec(view: ParsedCodoc["view"]): unknown {
  if (typeof view === "string") {
    return view;
  }

  if (isFileViewSpec(view)) {
    return {
      $source: "file",
      path: view.path
    };
  }

  return view;
}

function isFileViewSpec(value: ParsedCodoc["view"]): value is Extract<ParsedCodoc["view"], { kind: "file" }> {
  return (
    isRecord(value) &&
    value.kind === "file" &&
    typeof value.path === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatWriteResult(result: {
  codocId: string;
  filePath: string;
  build: {
    success: boolean;
    errors: Array<{
      code: string;
      message: string;
    }>;
    affectedNodes: string[];
  };
}): string {
  if (result.build.success) {
    return [
      `Wrote codoc "${result.codocId}" to "${result.filePath}".`,
      `Build succeeded. Affected nodes: ${result.build.affectedNodes.join(", ") || "(none)"}.`
    ].join("\n");
  }

  const errors = result.build.errors
    .map((error) => `- [${error.code}] ${error.message}`)
    .join("\n");

  return [
    `Wrote codoc "${result.codocId}" to "${result.filePath}", but the workspace build failed.`,
    errors
  ].join("\n");
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function doneEvent(): ChatEvent {
  return {
    kind: "status",
    status: "done"
  };
}
