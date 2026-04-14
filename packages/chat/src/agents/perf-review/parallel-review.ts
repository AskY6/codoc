// Parallel individual-review pipeline for the perf-review agent.
//
// Splits the material codoc into N independent items, extracts facts
// for each in parallel, then runs a single scoring call and assembles
// the review codoc. Reduces wall-clock time from ~3min to ~40s.
//
// Four phases:
//   1. IDENTIFY + FETCH — find material codoc, split items
//   2. WORKERS          — N concurrent fact-extraction calls
//   3. SCORE            — single call: all facts → 5 dimensions + ScoreCards
//   4. ASSEMBLE + CREATE — programmatic merge → createCodoc via tool loop

import type { AgentId, ChatMessage } from "@cobook/core";
import type { NodeId } from "@cobook/graph";
import type { ChatRunContext } from "../../runner/context.js";
import type { ChatTool } from "../../state/aliases.js";
import type { ChatState } from "../../state/state.js";
import { stripCodeFence } from "./util.js";
import { PERF_REVIEW_RUBRIC } from "./rubric.js";

// ---- Types ---------------------------------------------------------------

interface ReviewItem {
  readonly id: string;
  readonly category: "baseline" | "standout" | "future" | "raw";
  readonly rawText: string;
}

interface IdentifyResult {
  readonly subject: string;
  readonly period: string;
  readonly role: string;
  readonly reviewGroup: string;
  readonly materialPath: string;
  readonly items: readonly ReviewItem[];
}

interface WorkerResult {
  readonly itemId: string;
  readonly category: string;
  readonly factMdx: string;
  readonly evidenceStrength: "verified" | "unconfirmed" | "unverifiable";
}

interface ScoreResult {
  readonly scores: {
    business: number;
    technical: number;
    impact: number;
    growth: number;
    ownership: number;
    weightedTotal: number;
  };
  readonly scoreCardsMdx: string;
  readonly summaryMdx: string;
  readonly evidenceCounts: {
    verified: number;
    unconfirmed: number;
    unverifiable: number;
  };
}

// ---- Constants -----------------------------------------------------------

const MAX_CONCURRENT_WORKERS = 5;

const IDENTIFY_SYSTEM_PROMPT = `你是一个绩效 review 助手。用户要求你 review 某人的绩效材料。

你会收到两个输入：
1. 用户的请求消息
2. 该人的绩效材料 codoc 全文

你的任务是：
1. 从用户消息中提取被评审人姓名和时间段
2. 从材料 codoc 中提取基本信息和所有工作事项

输出严格 JSON 格式（不要 markdown code fence）：
{
  "subject": "姓名",
  "period": "时间段",
  "role": "岗位/职能",
  "reviewGroup": "校准分组",
  "items": [
    { "id": "item-1", "category": "baseline|standout|future|raw", "rawText": "该事项的完整原文" },
    { "id": "item-2", "category": "...", "rawText": "..." }
  ]
}

规则：
- 每个 item 只包含一个独立的工作事项
- category 根据材料中的分类（基本工作成果=baseline, 突出表现=standout, 未来规划=future, 其他=raw）
- 保留原文，不删改`;

function buildReviewWorkerPrompt(subject: string, period: string): string {
  return `你是一个绩效事实提取助手。对一条工作事项进行事实抽取和证据评估。

被评估人：${subject}
时间段：${period}

对这条事项做以下处理：
1. 去美化：剥离夸张修辞和模糊量词（如"大幅提升" → 标记为 [缺少量化数据]）
2. 抽事实：提取做了什么、结果、影响范围、收益类型、收益链路、个人贡献
3. 评证据强度：
   - verified：有明确数据、链接、工单、发布记录等可验证材料
   - unconfirmed：结论合理，但缺少直接证据
   - unverifiable：纯主观陈述或无法验证
4. 生成 MDX 片段

输出严格 JSON 格式（不要 markdown code fence）：
{
  "evidenceStrength": "verified|unconfirmed|unverifiable",
  "factMdx": "<ExtractedFact action=\\"做了什么\\" result=\\"量化结果\\" scope=\\"影响范围\\" strength=\\"verified|unconfirmed|unverifiable\\" />\\n<Evidence strength=\\"verified|unconfirmed|unverifiable\\" quote=\\"收益链路: ...; 个人贡献: ...; 原文: ...\\" />"
}

规则：
- 收益类型归入：用户收益、业务收益、技术收益、团队收益
- 收益链路尽量连接到增收、降本、降风险
- 个人贡献必须写清边界；团队结果标注"个人贡献待确认"
- 收益链路不完整标注 [收益链路待补充]
- 缺少量化结果标注 [缺少量化数据]`;
}

function buildScorePrompt(subject: string, period: string): string {
  return `你是一个绩效评分助手。基于已提取的结构化事实，对被评审人进行多维度评分。

被评估人：${subject}
时间段：${period}

${PERF_REVIEW_RUBRIC}

限分规则：
- 没有结果或收益链路不完整时，业务成果通常不高于 3 分
- 团队结果无法说明个人贡献时，影响力与协作、主动性与 Ownership 通常不高于 3 分
- 未来规划不能直接抬高本期业务成果；只作为成长性和 Ownership 的辅助信号
- 信息不足时，明确标注并给出保守分数

你会收到所有已提取的事实。请：
1. 对每个维度独立打分 (1-5)
2. 计算加权总分 (业务成果×0.3 + 技术深度×0.25 + 影响力×0.2 + 成长性×0.15 + 主动性×0.1)
3. 为每个维度输出 ScoreCard MDX 组件
4. 输出一句话总评

输出严格 JSON 格式（不要 markdown code fence）：
{
  "scores": {
    "business": 分数,
    "technical": 分数,
    "impact": 分数,
    "growth": 分数,
    "ownership": 分数,
    "weightedTotal": 加权总分保留两位小数
  },
  "scoreCardsMdx": "所有 ScoreCard 组件的 MDX 文本",
  "summaryMdx": "<Summary>一句话总评</Summary>"
}

ScoreCard 格式：
<ScoreCard dimension="维度名" weight={权重} score={data.score_xxx}>
  <Highlight>{核心判断}</Highlight>
  <Improvement>{不足之处}</Improvement>
  <Evidence strength="verified|unconfirmed|unverifiable" quote="{最关键的一条证据}" />
</ScoreCard>`;
}

// ---- Pipeline phases -----------------------------------------------------

async function identifyAndFetch(
  ctx: ChatRunContext,
  tools: readonly ChatTool[],
  state: ChatState,
  userMessage: string,
  nodeId: NodeId,
): Promise<IdentifyResult | null> {
  ctx.emit({ kind: "token", nodeId, delta: "正在查找绩效材料..." });

  // Programmatically call listCodocs.
  const toolMap = new Map(tools.map((t) => [t.schema.name, t]));
  const listTool = toolMap.get("listCodocs");
  const getTool = toolMap.get("getCodoc");
  if (!listTool || !getTool) return null;

  const listResult = await listTool.execute({}, state, ctx);
  if (!listResult.ok) return null;

  const codocs = listResult.value as readonly {
    id: string;
    path: string;
    title: string | null;
  }[];

  // Find material codocs.
  const materials = codocs.filter(
    (c) => c.path.startsWith("materials/") || c.title?.includes("材料"),
  );
  if (materials.length === 0) return null;

  // Use Haiku to match the right material and extract items.
  // If only one material, use it directly.
  const targetMaterial =
    materials.length === 1 ? materials[0]! : null;

  // Fetch the material content.
  let materialContent: string;
  let materialPath: string;

  if (targetMaterial) {
    const getResult = await getTool.execute(
      { id: targetMaterial.id },
      state,
      ctx,
    );
    if (!getResult.ok) return null;
    const detail = getResult.value as { content: string; path: string };
    materialContent = detail.content;
    materialPath = detail.path;
  } else {
    // Multiple materials — ask Haiku to pick the right one.
    const pickPrompt = `用户请求: ${userMessage}\n\n可用材料:\n${materials.map((m) => `- id: ${m.id}, title: ${m.title}`).join("\n")}\n\n请输出最匹配的材料 id（纯文本，不要 JSON）`;
    const pickResp = await ctx.llm.createMessage({
      model: ctx.modelConfig?.routerModel ?? "claude-haiku-4-5-20251001",
      maxTokens: 64,
      system: "从列表中选择最匹配用户请求的材料 codoc id。只输出 id。",
      messages: [{ role: "user", content: pickPrompt }],
      signal: ctx.signal,
    });
    const pickedId = pickResp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const matched = materials.find((m) => m.id === pickedId) ?? materials[0]!;
    const getResult = await getTool.execute(
      { id: matched.id },
      state,
      ctx,
    );
    if (!getResult.ok) return null;
    const detail = getResult.value as { content: string; path: string };
    materialContent = detail.content;
    materialPath = detail.path;
  }

  ctx.emit({ kind: "token", nodeId, delta: "\n正在拆分材料事项..." });

  // Use Haiku to split items from the material content.
  const splitResp = await ctx.llm.createMessage({
    model: ctx.modelConfig?.routerModel ?? "claude-haiku-4-5-20251001",
    maxTokens: 4096,
    system: IDENTIFY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `用户请求: ${userMessage}\n\n材料 codoc 全文:\n${materialContent}`,
      },
    ],
    signal: ctx.signal,
  });

  const splitText = splitResp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(stripCodeFence(splitText)) as {
    subject: string;
    period: string;
    role: string;
    reviewGroup: string;
    items: readonly { id: string; category: string; rawText: string }[];
  };

  return {
    ...parsed,
    materialPath,
    items: parsed.items.map((it) => ({
      ...it,
      category: it.category as ReviewItem["category"],
    })),
  };
}

async function extractFact(
  ctx: ChatRunContext,
  item: ReviewItem,
  subject: string,
  period: string,
  nodeId: NodeId,
): Promise<WorkerResult> {
  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n提取事实: ${item.id}...`,
  });

  const response = await ctx.llm.createMessage({
    model: ctx.modelConfig?.defaultModel ?? "claude-sonnet-4-20250514",
    maxTokens: 4096,
    system: buildReviewWorkerPrompt(subject, period),
    messages: [
      {
        role: "user",
        content: `类别: ${item.category}\n\n原文:\n${item.rawText}`,
      },
    ],
    signal: ctx.signal,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(stripCodeFence(text)) as {
    evidenceStrength: string;
    factMdx: string;
  };

  return {
    itemId: item.id,
    category: item.category,
    factMdx: parsed.factMdx,
    evidenceStrength: parsed.evidenceStrength as WorkerResult["evidenceStrength"],
  };
}

async function scoreAll(
  ctx: ChatRunContext,
  results: readonly WorkerResult[],
  subject: string,
  period: string,
  nodeId: NodeId,
): Promise<ScoreResult> {
  ctx.emit({ kind: "token", nodeId, delta: "\n正在评分..." });

  const factsInput = results
    .map(
      (r) =>
        `### ${r.category} — ${r.itemId}\n证据强度: ${r.evidenceStrength}\n${r.factMdx}`,
    )
    .join("\n\n");

  const response = await ctx.llm.createMessage({
    model: ctx.modelConfig?.defaultModel ?? "claude-sonnet-4-20250514",
    maxTokens: 8192,
    system: buildScorePrompt(subject, period),
    messages: [{ role: "user", content: factsInput }],
    signal: ctx.signal,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(stripCodeFence(text)) as {
    scores: ScoreResult["scores"];
    scoreCardsMdx: string;
    summaryMdx: string;
  };

  const evidenceCounts = {
    verified: results.filter((r) => r.evidenceStrength === "verified").length,
    unconfirmed: results.filter((r) => r.evidenceStrength === "unconfirmed")
      .length,
    unverifiable: results.filter((r) => r.evidenceStrength === "unverifiable")
      .length,
  };

  return { ...parsed, evidenceCounts };
}

function assembleReviewCodoc(
  identify: IdentifyResult,
  workers: readonly WorkerResult[],
  score: ScoreResult,
): { path: string; title: string; content: string } {
  const namePinyin = identify.subject
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
  const periodTag = identify.period.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const path = `reviews/${namePinyin}-${periodTag}`;
  const title = `Review: ${identify.subject} — ${identify.period}`;

  const baseline = workers.filter((w) => w.category === "baseline");
  const standout = workers.filter((w) => w.category === "standout");
  const future = workers.filter((w) => w.category === "future");
  const raw = workers.filter((w) => w.category === "raw");

  const s = score.scores;
  const ec = score.evidenceCounts;

  const content = `---
title: "${title}"
tags: [review, ${periodTag}, ${namePinyin}]
schema:
  subject: string
  period: string
  role: string
  review_group: string
  source_material: string
  baseline_count: number
  standout_count: number
  future_plan_count: number
  evidence_verified_count: number
  evidence_unconfirmed_count: number
  evidence_unverifiable_count: number
  score_business: number
  score_technical: number
  score_impact: number
  score_growth: number
  score_ownership: number
  weighted_total: number
data:
  source_material: "${identify.materialPath}"
  subject: "${identify.subject}"
  period: "${identify.period}"
  role: "${identify.role}"
  review_group: "${identify.reviewGroup}"
  baseline_count: ${baseline.length}
  standout_count: ${standout.length}
  future_plan_count: ${future.length}
  evidence_verified_count: ${ec.verified}
  evidence_unconfirmed_count: ${ec.unconfirmed}
  evidence_unverifiable_count: ${ec.unverifiable}
  score_business: ${s.business}
  score_technical: ${s.technical}
  score_impact: ${s.impact}
  score_growth: ${s.growth}
  score_ownership: ${s.ownership}
  weighted_total: ${s.weightedTotal}
---

<ReviewHeader subject="${identify.subject}" period="${identify.period}" total={data.weighted_total} />

${score.summaryMdx}

## 维度评分

${score.scoreCardsMdx}

<WeightedTotal scores={data} />

## 评审上下文

- 岗位/职能: ${identify.role}
- 校准分组: ${identify.reviewGroup}
- 证据分布: 已验证 ${ec.verified} / 待确认 ${ec.unconfirmed} / 无法验证 ${ec.unverifiable}

## 基本工作成果

${baseline.map((w) => w.factMdx).join("\n\n") || "(无)"}

## 突出表现

${standout.map((w) => w.factMdx).join("\n\n") || "(无)"}

## 未来规划

未来规划用于表达潜在价值，不计为本期已兑现成果。

${future.map((w) => w.factMdx).join("\n\n") || "(无)"}${raw.length > 0 ? `\n\n## 其他\n\n${raw.map((w) => w.factMdx).join("\n\n")}` : ""}`;

  return { path, title, content };
}

// ---- Orchestrator --------------------------------------------------------

export async function runParallelReview(params: {
  readonly agentId: AgentId;
  readonly tools: readonly ChatTool[];
  readonly state: ChatState;
  readonly ctx: ChatRunContext;
}): Promise<Partial<ChatState>> {
  const { agentId, tools, state, ctx } = params;
  const nodeId = agentId as unknown as NodeId;

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

  // Phase 1: Identify + Fetch
  let identify: IdentifyResult | null;
  try {
    identify = await identifyAndFetch(
      ctx,
      tools,
      state,
      latestUser.content,
      nodeId,
    );
  } catch {
    identify = null;
  }

  if (!identify || identify.items.length === 0) {
    // Fallback signal — caller uses single tool loop.
    return null as unknown as Partial<ChatState>;
  }

  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n找到 ${identify.items.length} 个事项，开始并行事实提取...`,
  });

  // If ≤1 item, not worth parallelizing.
  if (identify.items.length <= 1) {
    return null as unknown as Partial<ChatState>;
  }

  // Phase 2: Parallel workers
  const workerResults: WorkerResult[] = [];
  const errors: string[] = [];

  for (
    let i = 0;
    i < identify.items.length;
    i += MAX_CONCURRENT_WORKERS
  ) {
    const batch = identify.items.slice(i, i + MAX_CONCURRENT_WORKERS);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        extractFact(ctx, item, identify!.subject, identify!.period, nodeId),
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
      content: `事实提取全部失败：${errors.join("; ")}`,
      agentId,
      metadata: { toolCalls: [], toolResults: [] },
    };
    ctx.emit({ kind: "done", finalMessage: msg });
    return { messages: [msg] };
  }

  ctx.emit({
    kind: "token",
    nodeId,
    delta: `\n${workerResults.length}/${identify.items.length} 个事项提取完成，正在评分...`,
  });

  // Phase 3: Score
  let score: ScoreResult;
  try {
    score = await scoreAll(
      ctx,
      workerResults,
      identify.subject,
      identify.period,
      nodeId,
    );
  } catch {
    // Scoring failed — fall back.
    return null as unknown as Partial<ChatState>;
  }

  ctx.emit({
    kind: "token",
    nodeId,
    delta: "\n评分完成，正在写入 review codoc...",
  });

  // Phase 4: Assemble + Create — direct programmatic tool call, no LLM needed.
  const assembled = assembleReviewCodoc(identify, workerResults, score);

  const toolMap = new Map(tools.map((t) => [t.schema.name, t]));
  const createTool = toolMap.get("createCodoc");
  if (!createTool) {
    return null as unknown as Partial<ChatState>;
  }

  const toolInput = {
    path: assembled.path,
    title: assembled.title,
    content: assembled.content,
  };

  ctx.emit({ kind: "toolCall", nodeId, tool: "createCodoc", input: toolInput });

  const createResult = await createTool.execute(toolInput, state, ctx);
  const output = createResult.ok
    ? createResult.value
    : { error: "Failed to create review codoc" };

  ctx.emit({ kind: "toolResult", nodeId, tool: "createCodoc", output });

  const summaryText = createResult.ok
    ? `Review 完成！已为 ${identify.subject} — ${identify.period} 生成评审报告。\n\n` +
      `- 事实提取: ${workerResults.length} 条\n` +
      `- 证据分布: 已验证 ${score.evidenceCounts.verified} / 待确认 ${score.evidenceCounts.unconfirmed} / 无法验证 ${score.evidenceCounts.unverifiable}\n` +
      `- 加权总分: ${score.scores.weightedTotal}`
    : `Review codoc 创建失败。`;

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
