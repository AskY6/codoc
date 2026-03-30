import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import type { SceneAgent, SceneAgentContext, IntentProposal } from "../scene-agents/types.js";
import { createLLMAgentHandler } from "./types.js";
import { getClient, getModel } from "../shared/ai.js";

// ---------------------------------------------------------------------------
// Legacy chat participant (backward compat — still works via @mention)
// ---------------------------------------------------------------------------

export const claudeCodeLogAgentParticipant: Participant = {
  id: "claude-code-log-agent",
  kind: "agent",
  name: "Claude Code Log",
  description: "分析和浏览 Claude Code 会话日志，提取关键决策、工具调用和对话摘要。",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required", maxTokens: 3000 },
    { sourceKind: "codoc-snapshot", priority: "required" },
  ],
  responseMode: {
    type: "on-mention",
  },
};

const LEGACY_SYSTEM_PROMPT = `You are Claude Code Log, a session log analysis agent. You help users understand and extract insights from Claude Code session logs that have been ingested as codocs.

Your responsibilities:
- Summarize what happened in a Claude Code session
- Extract key decisions, tool calls, and code changes
- Identify patterns across multiple sessions
- Highlight errors, retries, and important conversation turns

If the analysis should be written to a codoc field, include an intent block:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path", "value": "analysis text"}}
</intent>

Only propose writes when the user explicitly asks to save the analysis to a codoc.
Respond concisely. Use Chinese when the user writes in Chinese.`;

export function createClaudeCodeLogAgentHandler(): AgentHandler {
  return createLLMAgentHandler({
    agentId: "claude-code-log-agent",
    systemPrompt: LEGACY_SYSTEM_PROMPT,
  });
}

// ---------------------------------------------------------------------------
// Scene Agent protocol (Phase 2)
// ---------------------------------------------------------------------------

const SCENE_SYSTEM_PROMPT = `You are a Claude Code session log analysis specialist. Given a codoc's schema and data containing Claude Code session logs, analyze the sessions and produce insights.

You can:
- Summarize session activity (tools used, files changed, decisions made)
- Extract key decisions and turning points in a coding session
- Identify error patterns and recovery strategies
- Compare activity across multiple sessions

For each insight that should be written to a codoc field, output a line in this exact format:
INTENT|docId|fieldPath|natural language description of the analysis to write

Be specific about what to analyze and where to write results.`;

export const claudeCodeLogSceneAgent: SceneAgent = {
  id: "claude-code-log-agent",
  name: "Claude Code Log",
  description: "分析 Claude Code 会话日志，提取关键决策、工具调用模式和对话摘要。",
  trusted: false,

  async handle(context: SceneAgentContext): Promise<IntentProposal[]> {
    const schemaSection = Object.entries(context.schemas)
      .map(([docId, schema]) => `### ${docId}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``)
      .join("\n\n");

    const dataSection = Object.entries(context.data)
      .map(([docId, data]) => `### ${docId}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``)
      .join("\n\n");

    const client = getClient();
    const response = await client.messages.create({
      model: getModel(),
      max_tokens: 1024,
      system: SCENE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `## Schemas\n${schemaSection}`,
            `## Data\n${dataSection}`,
            `## User Request\n${context.userMessage}`,
            context.additionalContext ? `## Additional Context\n${context.additionalContext}` : "",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    return parseIntentLines(text);
  },
};

function parseIntentLines(text: string): IntentProposal[] {
  const proposals: IntentProposal[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("INTENT|")) continue;
    const parts = trimmed.split("|");
    if (parts.length < 4) continue;
    proposals.push({
      targetDocId: parts[1],
      targetField: parts[2] || undefined,
      naturalLanguageIntent: parts.slice(3).join("|"),
    });
  }
  return proposals;
}
