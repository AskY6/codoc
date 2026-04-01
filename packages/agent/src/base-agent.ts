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
  availableWorkflows: WorkspaceWorkflow[];
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

interface WorkspaceWorkflow {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  pinnedCodocIds: string[];
  dataRefs: Record<string, string>;
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

    if (isCapabilityRequest(message, lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Summarizing available capabilities."
      };
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);
      yield {
        kind: "message",
        content: formatCapabilitySummary(contextPlan)
      };
      yield doneEvent();
      return;
    }

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

    if (isListWorkflowsRequest(lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Listing configured workflows."
      };
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);
      yield {
        kind: "message",
        content: JSON.stringify(
          {
            requestedAgentId: contextPlan.requestedAgentId,
            activeAgent: contextPlan.activeAgent,
            workflows: contextPlan.availableWorkflows
          },
          null,
          2
        )
      };
      yield doneEvent();
      return;
    }

    if (isContextRequest(lower)) {
      yield {
        kind: "status",
        status: "reading",
        message: "Summarizing the current chat context."
      };
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds, input.agentId);
      yield {
        kind: "message",
        content: JSON.stringify(buildContextSnapshot(contextPlan), null, 2)
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

    const workflowRequest = extractWorkflowRequest(message);
    if (workflowRequest) {
      const workflow = await resolveConfiguredWorkflow(service, workflowRequest.workflowId);
      const contextPlan = await buildChatContextPlan(
        service,
        input.pinnedCodocIds,
        input.agentId ?? workflow.agentId,
        workflow.pinnedCodocIds
      );
      const workflowInputs = await resolveWorkflowInputs(service, workflow);
      const generated = await generateTemplateCodoc(
        service,
        {
          codocId: workflowRequest.codocId,
          ...(workflowRequest.filePath ? { filePath: workflowRequest.filePath } : {}),
          ...(workflowRequest.topic ?? workflow.description
            ? { topic: workflowRequest.topic ?? workflow.description }
            : {}),
          overwrite: workflowRequest.overwrite
        },
        contextPlan,
        {
          workflow,
          workflowInputs,
          ...(workflow.outputDir ? { outputDir: workflow.outputDir } : {})
        }
      );

      yield {
        kind: "status",
        status: "writing",
        message: `Running workflow "${workflow.id}" into "${generated.filePath}".`
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
          `Executed workflow "${workflow.id}" (${workflow.name}).`,
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
      content: formatFallbackSummary(contextPlan)
    };
    yield doneEvent();
  }
}

export class StubBaseAgent extends RuleBasedBaseAgent {}

function isProjectSummaryRequest(message: string): boolean {
  return /\b(workspace|project)\s+summary\b/.test(message);
}

function isCapabilityRequest(rawMessage: string, lowerMessage: string): boolean {
  return (
    /\b(what can you do|capabilities|help)\b/.test(lowerMessage) ||
    /(你能做什么|你会什么|能做什么|帮助|帮我做什么)/.test(rawMessage)
  );
}

function isListRequest(message: string): boolean {
  return /\b(list|show)\s+codocs\b/.test(message);
}

function isListAgentsRequest(message: string): boolean {
  return /\b(list|show)\s+agents\b/.test(message);
}

function isListWorkflowsRequest(message: string): boolean {
  return /\b(list|show)\s+workflows\b/.test(message);
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

function extractWorkflowRequest(message: string): {
  workflowId: string;
  codocId: string;
  filePath?: string;
  topic?: string;
  overwrite: boolean;
} | null {
  const workflowMatch = message.match(
    /\b(run|execute|update)\s+workflow\s+([a-z0-9._/-]+)(?:\s+as\s+([a-z0-9._/-]+))?(?:\s+(?:at|to|into)\s+([^\s]+\.codoc))?(?:\s+about\s+([\s\S]+))?/i
  );
  if (!workflowMatch?.[2]) {
    return null;
  }

  return {
    workflowId: workflowMatch[2],
    codocId: workflowMatch[3] ?? workflowMatch[2],
    ...(workflowMatch[4] ? { filePath: workflowMatch[4] } : {}),
    ...(workflowMatch[5]?.trim() ? { topic: workflowMatch[5].trim() } : {}),
    overwrite: workflowMatch[1]?.toLowerCase() === "update"
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
  contextPlan: ChatContextPlan,
  options: {
    workflow?: WorkspaceWorkflow | null;
    workflowInputs?: Record<string, unknown>;
    outputDir?: string;
  } = {}
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
  const workflowInputs =
    options.workflowInputs && Object.keys(options.workflowInputs).length > 0
      ? options.workflowInputs
      : null;
  const meta = buildGeneratedMeta(contextPlan.activeAgent, options.workflow ?? null);
  const content = stringifyYaml(
    {
      codoc: "0.1",
      id: request.codocId,
      ...(meta ? { meta } : {}),
      data: {
        title,
        summary,
        ...(relatedCodocs.length > 0 ? { relatedCodocs } : {}),
        ...(workflowInputs ? { workflowInputs } : {})
      },
      view: "# {data.title}\n\n{data.summary}"
    },
    {
      lineWidth: 0
    }
  );

  return {
    codocId: request.codocId,
    filePath:
      request.filePath ??
      existingCodoc?.filePath ??
      buildGeneratedCodocFilePath(
        request.codocId,
        options.outputDir ?? options.workflow?.outputDir,
        contextPlan.activeAgent
      ),
    content,
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
  requestedAgentId: string | undefined,
  extraPinnedCodocIds: string[] = []
): Promise<ChatContextPlan> {
  const workspace = await service.getWorkspace();
  const projectSummary = buildProjectSummaryFromWorkspace(workspace);
  const codocOrder = new Map(projectSummary.codocs.map((codoc, index) => [codoc.id, index]));
  const availableAgents = listWorkspaceAgents(workspace);
  const availableWorkflows = listWorkspaceWorkflows(workspace);
  const activeAgent = resolveWorkspaceAgent(availableAgents, requestedAgentId);
  const agentPinnedCodocIds = uniqueStrings(activeAgent?.pinnedCodocIds ?? []);
  const requestedPinnedCodocIds = rawPinnedCodocIds ?? [];
  const uniqueRequestedPinnedCodocIds = uniqueStrings([
    ...extraPinnedCodocIds,
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
    availableWorkflows,
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

function listWorkspaceWorkflows(workspace: WorkspaceSnapshot): WorkspaceWorkflow[] {
  return Object.entries(workspace.config.workflows ?? {}).map(([id, spec]) => ({
    id,
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.agent ? { agentId: spec.agent } : {}),
    pinnedCodocIds: spec.pinnedCodocIds ?? [],
    dataRefs: spec.dataRefs ?? {},
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

async function resolveConfiguredWorkflow(
  service: CobookService,
  workflowId: string
): Promise<WorkspaceWorkflow> {
  const workspace = await service.getWorkspace();
  const workflow = listWorkspaceWorkflows(workspace).find((entry) => entry.id === workflowId);

  if (!workflow) {
    throw new Error(`Configured workflow "${workflowId}" was not found in this workspace.`);
  }

  return workflow;
}

async function resolveWorkflowInputs(
  service: CobookService,
  workflow: WorkspaceWorkflow
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(workflow.dataRefs).map(async ([key, node]) => [key, (await service.resolve(node)).value])
  );

  return Object.fromEntries(entries);
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

function buildGeneratedCodocFilePath(
  codocId: string,
  outputDirOverride: string | undefined,
  activeAgent: WorkspaceAgent | null
): string {
  const outputDir = normalizeOutputDir(outputDirOverride ?? activeAgent?.outputDir);
  return outputDir ? `${outputDir}/${codocId}.codoc` : `${codocId}.codoc`;
}

function buildGeneratedMeta(
  activeAgent: WorkspaceAgent | null,
  workflow: WorkspaceWorkflow | null
): Record<string, unknown> | null {
  const meta = {
    ...(activeAgent
      ? {
          agent: {
            id: activeAgent.id,
            name: activeAgent.name
          }
        }
      : {}),
    ...(workflow
      ? {
          workflow: {
            id: workflow.id,
            name: workflow.name
          }
        }
      : {})
  };

  return Object.keys(meta).length > 0 ? meta : null;
}

function normalizeOutputDir(outputDir: string | undefined): string | null {
  if (!outputDir) {
    return null;
  }

  const normalized = outputDir.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function isContextRequest(lower: string): boolean {
  return /(^|\b)(show|list|print)\s+me\s+the\s+current\s+context\b/.test(lower) ||
    /\bcurrent\s+context\b/.test(lower);
}

function buildContextSnapshot(contextPlan: ChatContextPlan) {
  return {
    requestedAgentId: contextPlan.requestedAgentId,
    activeAgent: contextPlan.activeAgent,
    context: {
      agentPinnedCodocIds: contextPlan.agentPinnedCodocIds,
      requestedPinnedCodocIds: contextPlan.requestedPinnedCodocIds,
      pinnedCodocIds: contextPlan.pinnedCodocIds,
      ignoredPinnedCodocIds: contextPlan.ignoredPinnedCodocIds,
      contextCodocIds: contextPlan.contextCodocIds
    },
    pinned: contextPlan.pinnedCodocs.map((entry) => ({
      codocId: entry.codocId,
      filePath: entry.codoc.filePath
    }))
  };
}

function formatCapabilitySummary(contextPlan: ChatContextPlan): string {
  return [
    "我现在可以帮助你：",
    "1. 概览当前 workspace / project",
    "2. 列出 codoc、agent、workflow",
    "3. 读取 codoc 或 resolve 某个节点",
    "4. 创建、更新、重构 codoc",
    contextPlan.availableAgents.length > 0 ? "" : null,
    contextPlan.availableAgents.length > 0 ? "当前可用的场景 agent：" : null,
    ...contextPlan.availableAgents.map((agent) =>
      `- ${agent.name}${agent.description ? `：${agent.description}` : ""}`
    )
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatFallbackSummary(contextPlan: ChatContextPlan): string {
  return [
    "我先按通用 agent 理解你的请求。",
    "如果你是要操作 codoc，可以直接用这些表达：",
    "- `list codocs`",
    "- `read codoc <id>`",
    "- `resolve <node>`",
    "- `create note codoc <id> about <topic>`",
    "- `update codoc <id>` 并附上 fenced code block",
    contextPlan.availableAgents.length > 0 ? "" : null,
    contextPlan.availableAgents.length > 0 ? "当前也有可分发的场景 agent：" : null,
    ...contextPlan.availableAgents.map((agent) => `- ${agent.id}: ${agent.name}`),
    "" ,
    `当前 workspace 里共有 ${contextPlan.projectSummary.codocCount} 个 codoc。`
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
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
    case "preset":
      return {
        $source: "preset",
        name: spec.name
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
