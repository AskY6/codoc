// Parallel material-recording pipeline for the perf-review agent.
//
// Splits raw material into N independent items, processes each in
// parallel via separate LLM calls, then merges results into a single
// codoc. This reduces wall-clock time from ~3min (one 16K-token call)
// to ~30s (N concurrent ~2-3K-token calls).
//
// Three phases:
//   1. SPLIT  (Haiku)  — identify N items from raw text → JSON
//   2. WORKER (Sonnet)  — N concurrent calls, each structures one item
//   3. MERGE  (tool loop) — assemble codoc, call createCodoc

import type { AgentId, ChatMessage } from "@cobook/core";
import type { NodeId } from "@cobook/graph";
import type { ChatRunContext } from "../../runner/context.js";
import type { ChatTool } from "../../state/aliases.js";
import type { ChatState } from "../../state/state.js";
import { stripCodeFence } from "./util.js";

// ---- Types ---------------------------------------------------------------

interface SplitItem {
  readonly id: string;
  readonly rawText: string;
}

interface SplitResult {
  readonly subject: string;
  readonly period: string;
  readonly role: string;
  readonly reviewGroup: string;
  readonly items: readonly SplitItem[];
}

interface WorkerResult {
  readonly itemId: string;
  readonly category: "baseline" | "standout" | "future" | "raw";
  readonly mdxSection: string;
  readonly dataEntry: string;
}

// ---- Constants -----------------------------------------------------------

const MAX_CONCURRENT_WORKERS = 5;

const SPLIT_SYSTEM_PROMPT = `你是一个绩效材料拆分器。
用户会提供一个人的绩效原始材料。你的任务是：
1. 提取基本信息：姓名、时间段、岗位/职能、校准分组
2. 将原始材料拆分为独立的工作事项（项目、成果、计划等）
3. 每个事项应该是一个可以独立评估的完整单元

输出严格 JSON 格式（不要 markdown code fence）：
{
  "subject": "姓名",
  "period": "时间段",
  "role": "岗位/职能，未知则填未提供",
  "reviewGroup": "校准分组，未知则填未分组",
  "items": [
    { "id": "item-1", "rawText": "该事项的完整原文" },
    { "id": "item-2", "rawText": "..." }
  ]
}

规则：
- 每个 item 只包含一个独立的工作事项
- 保留原文，不删改、不润色
- 如果材料只描述了一个事项，items 数组也只有一个元素
- id 使用 item-1, item-2, ... 格式`;

function buildWorkerSystemPrompt(subject: string, period: string): string {
  return `你是一个绩效材料结构化助手。你需要对一条工作事项进行分类和结构化。

被评估人：${subject}
时间段：${period}

对这条事项：
1. 判断它属于哪个类别：
   - baseline：岗位要求内、已交付的常规成果
   - standout：超出岗位基线、解决高难问题或形成复利影响的成果
   - future：尚未兑现、但有明确收益假设和验证指标的计划
   - raw：暂时无法归类
2. 生成该事项的 MDX 片段（使用 <ExtractedFact> 组件）
3. 生成该事项的 data entry（YAML 格式，用于 frontmatter）

输出严格 JSON 格式（不要 markdown code fence）：
{
  "category": "baseline|standout|future|raw",
  "mdxSection": "<ExtractedFact ...> 的 MDX 片段",
  "dataEntry": "该事项的 YAML 列表条目（以 - 开头）"
}

规则：
- 保留原文核心内容，不删改事实
- 剥离夸张修辞，模糊量词标记为 [缺少量化数据]
- MDX 片段只输出该事项的部分，不要输出完整文档
- dataEntry 是一个 YAML 列表项，用于嵌入 frontmatter 的对应数组`;
}

// ---- Pipeline phases -----------------------------------------------------

async function splitItems(
  ctx: ChatRunContext,
  userMessage: string,
  nodeId: NodeId,
): Promise<SplitResult> {
  ctx.emit({ kind: "token", nodeId, delta: "正在分析材料结构..." });

  const response = await ctx.llm.createMessage({
    model: ctx.modelConfig?.routerModel ?? "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    system: SPLIT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    signal: ctx.signal,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(stripCodeFence(text)) as SplitResult;
}

async function processItem(
  ctx: ChatRunContext,
  item: SplitItem,
  subject: string,
  period: string,
  nodeId: NodeId,
): Promise<WorkerResult> {
  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n处理事项: ${item.id}...`,
  });

  const response = await ctx.llm.createMessage({
    model: ctx.modelConfig?.defaultModel ?? "claude-sonnet-4-20250514",
    maxTokens: 4096,
    system: buildWorkerSystemPrompt(subject, period),
    messages: [{ role: "user", content: item.rawText }],
    signal: ctx.signal,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(stripCodeFence(text)) as {
    category: string;
    mdxSection: string;
    dataEntry: string;
  };

  return {
    itemId: item.id,
    category: parsed.category as WorkerResult["category"],
    mdxSection: parsed.mdxSection,
    dataEntry: parsed.dataEntry,
  };
}

/** Minimal codoc from split metadata + raw user text (no workers). */
function assembleRawCodoc(
  split: SplitResult,
  rawText: string,
): { path: string; title: string; content: string } {
  const namePinyin = split.subject
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
  const periodTag = split.period.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const path = `perf/${namePinyin}-${periodTag}`;
  const title = `材料: ${split.subject} — ${split.period}`;

  const content = `---
title: "${title}"
tags: [material, ${periodTag}, ${namePinyin}]
schema:
  subject: string
  period: string
  role: string
  review_group: string
data:
  subject: "${split.subject}"
  period: "${split.period}"
  role: "${split.role}"
  review_group: "${split.reviewGroup}"
---

<MaterialHeader
  subject="${split.subject}"
  period="${split.period}"
/>

## 岗位背景

- 岗位/职能: ${split.role}
- 校准分组: ${split.reviewGroup}

## 原始材料

${rawText}`;

  return { path, title, content };
}

function assembleCodocContent(
  split: SplitResult,
  results: readonly WorkerResult[],
): { path: string; title: string; content: string } {
  const baseline = results.filter((r) => r.category === "baseline");
  const standout = results.filter((r) => r.category === "standout");
  const future = results.filter((r) => r.category === "future");
  const raw = results.filter((r) => r.category === "raw");

  const dataEntries = (items: readonly WorkerResult[]) =>
    items.map((r) => `    ${r.dataEntry}`).join("\n") || "    - (无)";
  const mdxSections = (items: readonly WorkerResult[]) =>
    items.map((r) => r.mdxSection).join("\n\n") || "(无)";

  const namePinyin = split.subject
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
  const periodTag = split.period.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const path = `perf/${namePinyin}-${periodTag}`;
  const title = `材料: ${split.subject} — ${split.period}`;

  const content = `---
title: "${title}"
tags: [material, ${periodTag}, ${namePinyin}]
schema:
  subject: string
  period: string
  role: string
  review_group: string
  baseline_results: array
  standout_contributions: array
  future_plans: array
  raw_items: array
data:
  subject: "${split.subject}"
  period: "${split.period}"
  role: "${split.role}"
  review_group: "${split.reviewGroup}"
  baseline_results:
${dataEntries(baseline)}
  standout_contributions:
${dataEntries(standout)}
  future_plans:
${dataEntries(future)}
  raw_items:
${dataEntries(raw)}
---

<MaterialHeader
  subject="${split.subject}"
  period="${split.period}"
  count={${results.length}}
/>

## 岗位背景

- 岗位/职能: ${split.role}
- 校准分组: ${split.reviewGroup}

## 基本工作成果

${mdxSections(baseline)}

## 突出表现

${mdxSections(standout)}

## 未来规划

${mdxSections(future)}

## 原始材料补充

${mdxSections(raw)}`;

  return { path, title, content };
}

/** Programmatically create a codoc and return the state update. */
async function directCreate(
  assembled: { path: string; title: string; content: string },
  tools: readonly ChatTool[],
  state: ChatState,
  ctx: ChatRunContext,
  agentId: AgentId,
  nodeId: NodeId,
): Promise<Partial<ChatState> | null> {
  const toolMap = new Map(tools.map((t) => [t.schema.name, t]));
  const createTool = toolMap.get("createCodoc");
  if (!createTool) return null;

  const toolInput = {
    path: assembled.path,
    title: assembled.title,
    content: assembled.content,
  };

  ctx.emit({ kind: "toolCall", nodeId, tool: "createCodoc", input: toolInput });

  const createResult = await createTool.execute(toolInput, state, ctx);
  const output = createResult.ok
    ? createResult.value
    : { error: "Failed to create material codoc" };

  ctx.emit({ kind: "toolResult", nodeId, tool: "createCodoc", output });

  const summaryText = createResult.ok
    ? `材料已录入！已为 ${assembled.title} 创建绩效材料文档。`
    : `材料 codoc 创建失败。`;

  const finalMessage: ChatMessage = {
    kind: "assistant",
    id: ctx.mintMessageId(),
    threadId: state.threadId!,
    content: summaryText,
    agentId,
    metadata: {
      toolCalls: [{ name: "createCodoc", input: toolInput }],
      toolResults: [{ name: "createCodoc", output }],
    },
  };
  ctx.emit({ kind: "done", finalMessage });
  return { messages: [finalMessage] };
}

// ---- Orchestrator --------------------------------------------------------

export async function runParallelMaterialRecording(params: {
  readonly agentId: AgentId;
  readonly tools: readonly ChatTool[];
  readonly state: ChatState;
  readonly ctx: ChatRunContext;
}): Promise<Partial<ChatState>> {
  const { agentId, tools, state, ctx } = params;
  const nodeId = agentId as unknown as NodeId;

  // Find the latest user message.
  const userMessages = state.messages.filter((m) => m.kind === "user");
  const latestUser = userMessages[userMessages.length - 1];
  if (!latestUser) {
    const msg: ChatMessage = {
      kind: "assistant",
      id: ctx.mintMessageId(),
      threadId: state.threadId!,
      content: "没有找到用户消息。",
      agentId,
      metadata: { toolCalls: [], toolResults: [] },
    };
    ctx.emit({ kind: "done", finalMessage: msg });
    return { messages: [msg] };
  }

  // Phase 1: Split
  let split: SplitResult;
  try {
    split = await splitItems(ctx, latestUser.content, nodeId);
  } catch {
    // Splitter failed — create raw codoc with basic metadata.
    ctx.emit({
      kind: "token",
      nodeId,
      delta: "\n材料拆分失败，直接录入原始材料...",
    });
    const rawAssembled = assembleRawCodoc(
      { subject: "未知", period: "未知", role: "未提供", reviewGroup: "未分组", items: [] },
      latestUser.content,
    );
    const result = await directCreate(rawAssembled, tools, state, ctx, agentId, nodeId);
    if (result) return result;
    return null as unknown as Partial<ChatState>;
  }

  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n识别到 ${split.items.length} 个工作事项，${split.items.length <= 1 ? "直接录入..." : "开始并行处理..."}`,
  });

  // ≤1 item — not worth parallelizing, but still create directly.
  if (split.items.length <= 1) {
    const rawAssembled = assembleRawCodoc(split, latestUser.content);
    const result = await directCreate(rawAssembled, tools, state, ctx, agentId, nodeId);
    if (result) return result;
    return null as unknown as Partial<ChatState>;
  }

  // Phase 2: Parallel workers (capped concurrency).
  const workerResults: WorkerResult[] = [];
  const errors: string[] = [];

  // Process in batches of MAX_CONCURRENT_WORKERS.
  for (let i = 0; i < split.items.length; i += MAX_CONCURRENT_WORKERS) {
    const batch = split.items.slice(i, i + MAX_CONCURRENT_WORKERS);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        processItem(ctx, item, split.subject, split.period, nodeId),
      ),
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        workerResults.push(result.value);
      } else {
        errors.push(String(result.reason));
      }
    }
  }

  if (workerResults.length === 0) {
    const msg: ChatMessage = {
      kind: "assistant",
      id: ctx.mintMessageId(),
      threadId: state.threadId!,
      content: `所有事项处理失败：${errors.join("; ")}`,
      agentId,
      metadata: { toolCalls: [], toolResults: [] },
    };
    ctx.emit({ kind: "done", finalMessage: msg });
    return { messages: [msg] };
  }

  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n${workerResults.length}/${split.items.length} 个事项处理完成，正在合并写入...`,
  });

  // Phase 3: Merge — direct programmatic tool call, no LLM needed.
  const assembled = assembleCodocContent(split, workerResults);
  const mergeResult = await directCreate(assembled, tools, state, ctx, agentId, nodeId);
  if (mergeResult) return mergeResult;

  // directCreate failed (no createCodoc tool) — signal fallback.
  return null as unknown as Partial<ChatState>;
}
