import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  SceneAgent,
  SceneAgentContext,
  SceneAgentResult,
  IntentProposal,
} from "../scene-agents/types.js";
import { getClient, getModel } from "../shared/ai.js";
import { parseIntentBlocks, stripIntentBlocks } from "./utils.js";

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
// Ingest handler — no LLM needed, produces structured intent directly
// ---------------------------------------------------------------------------

async function handleIngest(
  context: SceneAgentContext,
): Promise<SceneAgentResult> {
  const projects = await findClaudeProjects();
  if (projects.length === 0) {
    return { reply: "未找到 Claude Code 项目目录。", proposals: [] };
  }

  const lower = context.userMessage.toLowerCase();
  let matched = projects.find((p) => lower.includes(p.name.toLowerCase()));
  if (!matched && projects.length === 1) {
    matched = projects[0];
  }

  if (!matched) {
    const list = projects
      .map((p) => `- \`${p.name}\` → \`${p.path}\``)
      .join("\n");
    return {
      reply: `找到 ${projects.length} 个 Claude Code 项目，请指定要接入的项目：\n${list}`,
      proposals: [],
    };
  }

  return {
    reply: `将接入项目 \`${matched.name}\` 的 Claude Code 日志。`,
    proposals: [
      {
        targetDocId: matched.name,
        content: `Ingest Claude Code logs from ${matched.path}`,
        payload: {
          kind: "ingest",
          payload: { skill: "claude-code-log", path: matched.path },
        },
      },
    ],
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
    return INGEST_KEYWORDS.test(context.userMessage)
      ? handleIngest(context)
      : handleAnalysis(context);
  },
};
