import type { ChatEvent, ChatInput, CobookService } from "@cobook/service";
import type { CodocSummary, ParsedCodoc, WorkspaceSnapshot } from "@cobook/service";

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
  requestedPinnedCodocIds: string[];
  pinnedCodocIds: string[];
  ignoredPinnedCodocIds: string[];
  contextCodocIds: string[];
  pinnedCodocs: Array<{
    codocId: string;
    codoc: ParsedCodoc;
  }>;
}

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
      const written = await service.writeCodoc({
        codocId: codocBlock.codocId,
        filePath,
        content: codocBlock.content,
        overwrite
      });
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
      const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds);
      const generated = await generateTemplateCodoc(
        service,
        generatedRequest,
        contextPlan
      );

      yield {
        kind: "status",
        status: "writing",
        message: `Generating "${generated.filePath}".`
      };
      const written = await service.writeCodoc({
        codocId: generated.codocId,
        filePath: generated.filePath,
        content: generated.content,
        overwrite: generated.overwrite
      });
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

    yield {
      kind: "status",
      status: "reading",
      message: "Reading project summary and pinned codocs."
    };

    const contextPlan = await buildChatContextPlan(service, input.pinnedCodocIds);

    yield {
      kind: "message",
      content: JSON.stringify(
        {
          message:
            "The base agent currently supports: project summary, list codocs, read codoc <id>, resolve <node>, or write/update a codoc via a fenced code block.",
          projectSummary: contextPlan.projectSummary,
          context: {
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
  const contentLines = [
    'codoc: "0.1"',
    `id: ${JSON.stringify(request.codocId)}`,
    "",
    "data:",
    `  title: ${JSON.stringify(title)}`,
    `  summary: ${JSON.stringify(summary)}`
  ];

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
    filePath: request.filePath ?? existingCodoc?.filePath ?? `${request.codocId}.codoc`,
    content: `${contentLines.join("\n")}\n`,
    overwrite: request.overwrite || existingCodoc !== null
  };
}

async function buildProjectSummary(service: CobookService): Promise<ProjectSummary> {
  const workspace = await service.getWorkspace();
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
  rawPinnedCodocIds: string[] | undefined
): Promise<ChatContextPlan> {
  const projectSummary = await buildProjectSummary(service);
  const codocOrder = new Map(projectSummary.codocs.map((codoc, index) => [codoc.id, index]));
  const requestedPinnedCodocIds = rawPinnedCodocIds ?? [];
  const uniqueRequestedPinnedCodocIds = uniqueStrings(requestedPinnedCodocIds);
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
    requestedPinnedCodocIds,
    pinnedCodocIds,
    ignoredPinnedCodocIds,
    contextCodocIds,
    pinnedCodocs
  };
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
