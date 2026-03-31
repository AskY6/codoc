import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  SceneAgent,
  SceneAgentContext,
  SceneAgentResult,
  IntentProposal,
} from "../framework/types.js";
import { getClient, getModel } from "../../shared/ai.js";
import { parseIntentBlocks, stripIntentBlocks } from "../utils.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("claude-log");

// ---------------------------------------------------------------------------
// Claude Code project discovery
// ---------------------------------------------------------------------------

interface ProjectEntry {
  name: string;
  path: string;
}

async function findClaudeProjects(): Promise<ProjectEntry[]> {
  const projectsRoot = join(homedir(), ".claude", "projects");
  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    const projects: ProjectEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(projectsRoot, entry.name);
      const files = await readdir(dirPath).catch(() => []);
      if (files.some((f) => f.endsWith(".jsonl"))) {
        projects.push({ name: entry.name, path: dirPath });
      }
    }
    return projects;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ingest handler — uses LLM to understand project selection from chat context
// ---------------------------------------------------------------------------

function formatProjectList(projects: ProjectEntry[]): string {
  return projects
    .map((p, i) => `${i + 1}. \`${p.name}\` → \`${p.path}\``)
    .join("\n");
}

function buildIngestProposals(selected: ProjectEntry[]): {
  reply: string;
  proposals: IntentProposal[];
} {
  const names = selected.map((p) => `\`${p.name}\``).join(", ");
  return {
    reply: `将接入项目 ${names} 的 Claude Code 日志。`,
    proposals: selected.map((p) => ({
      targetDocId: p.name,
      content: `Ingest Claude Code logs from ${p.path}`,
      payload: {
        kind: "ingest",
        payload: { skill: "claude-code-log", path: p.path },
      },
    })),
  };
}

const SELECTION_SYSTEM = `You are a project selector. Given a numbered list of Claude Code projects and a user message (possibly with conversation history), determine which projects the user wants to select.

Output a JSON array of 1-based indices, e.g. [1, 2, 3].
- "第3个" or "3" → [3]
- "前三个" or "first three" → [1, 2, 3]
- "最后一个" or "last one" → [N] (where N is the total count)
- "codoc 相关的" → indices of projects whose names contain "codoc"
- If the user names a specific project by name, return its index.

IMPORTANT: If the user is making a general request like "接入日志" or "接入项目" WITHOUT specifying which project (no name, no number, no filter), return []. This means the system should show the full list for the user to choose from.

Output ONLY the JSON array, nothing else.`;

async function selectProjectsWithLLM(
  projects: ProjectEntry[],
  userMessage: string,
  chatHistory: string,
): Promise<ProjectEntry[]> {
  const list = formatProjectList(projects);
  const historySection = chatHistory
    ? `\n\nConversation history:\n${chatHistory}`
    : "";

  const client = getClient();
  const response = await client.messages.create({
    model: getModel(),
    max_tokens: 100,
    system: SELECTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Projects (${projects.length} total):\n${list}\n\nUser message: "${userMessage}"${historySection}`,
      },
    ],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  try {
    const indices: number[] = JSON.parse(text);
    return indices
      .filter((i) => i >= 1 && i <= projects.length)
      .map((i) => projects[i - 1]);
  } catch {
    log.warn("failed to parse selection LLM response", { text });
    return [];
  }
}

async function handleIngest(
  context: SceneAgentContext,
): Promise<SceneAgentResult> {
  const projects = await findClaudeProjects();
  if (projects.length === 0) {
    return { reply: "未找到 Claude Code 项目目录。", proposals: [] };
  }

  // Single project — skip selection
  if (projects.length === 1) {
    return buildIngestProposals(projects);
  }

  // Use LLM to understand what the user wants to select
  const selected = await selectProjectsWithLLM(
    projects,
    context.userMessage,
    context.chatHistory,
  );

  if (selected.length > 0) {
    log.info("projects selected", {
      count: selected.length,
      names: selected.map((p) => p.name),
    });
    return buildIngestProposals(selected);
  }

  // No match — show the list for user to pick from
  return {
    reply: `找到 ${projects.length} 个 Claude Code 项目，请指定要接入的项目：\n${formatProjectList(projects)}`,
    proposals: [],
  };
}

// ---------------------------------------------------------------------------
// Analysis handler — uses LLM to analyze session logs
// ---------------------------------------------------------------------------

const ANALYSIS_PROMPT = `You are a Claude Code session log analyst. Given codoc schemas and data containing Claude Code session logs, analyze them and produce insights.

You can:
- Summarize session activity (tools used, files changed, decisions made)
- Extract key decisions and turning points
- Identify error patterns and recovery strategies
- Compare activity across sessions

For each insight that should be written to a codoc field, output an intent block:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/path", "value": "analysis text"}}
</intent>

Only propose writes when the user explicitly asks to save the analysis.
Respond concisely. Use Chinese when the user writes in Chinese.`;

async function handleAnalysis(
  context: SceneAgentContext,
): Promise<SceneAgentResult> {
  const client = getClient();

  const schemaSection = Object.entries(context.schemas)
    .map(
      ([docId, schema]) =>
        `### ${docId}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  const dataSection = Object.entries(context.data)
    .map(
      ([docId, data]) =>
        `### ${docId}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  const sections = [
    context.chatHistory ? `## Conversation History\n${context.chatHistory}` : "",
    schemaSection ? `## Schemas\n${schemaSection}` : "",
    dataSection ? `## Data\n${dataSection}` : "",
    `## User Request\n${context.userMessage}`,
    context.additionalContext
      ? `## Additional Context\n${context.additionalContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create({
    model: getModel(),
    max_tokens: 1024,
    system: ANALYSIS_PROMPT,
    messages: [{ role: "user", content: sections }],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  const intents = parseIntentBlocks(text);
  const reply = stripIntentBlocks(text);

  const proposals: IntentProposal[] = intents.map((intent) => ({
    targetDocId: (intent.payload as any)?.docId ?? "unknown",
    targetField: (intent.payload as any)?.field,
    content: `${intent.kind}: ${JSON.stringify(intent.payload)}`,
    payload: { kind: intent.kind, payload: intent.payload },
  }));

  return { reply: reply || "已分析日志。", proposals };
}

// ---------------------------------------------------------------------------
// Scene Agent definition
// ---------------------------------------------------------------------------

const INGEST_KEYWORDS =
  /接入|ingest|导入|连接|connect|加载|load|日志.*项目|project.*log/i;

export const claudeLogAgent: SceneAgent = {
  id: "claude-log",
  name: "Claude Code Log",
  description:
    "接入和分析 Claude Code 会话日志，提取关键决策、工具调用和对话摘要。",
  trusted: false,

  async handle(context: SceneAgentContext): Promise<SceneAgentResult> {
    // Check both current message AND chat history for ingest context.
    // A follow-up like "选前三个" doesn't contain ingest keywords,
    // but the history shows we were in the middle of project selection.
    const isIngestFlow =
      INGEST_KEYWORDS.test(context.userMessage) ||
      INGEST_KEYWORDS.test(context.chatHistory);
    return isIngestFlow ? handleIngest(context) : handleAnalysis(context);
  },
};
