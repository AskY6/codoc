import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import { createLLMAgentHandler } from "./types.js";

export const summaryAgentParticipant: Participant = {
  id: "summary-agent",
  kind: "agent",
  name: "Summary",
  description: "对上下文进行结构化总结。",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required" },
    { sourceKind: "quoted-messages", priority: "optional" },
    { sourceKind: "codoc-snapshot", priority: "optional" },
  ],
  responseMode: { type: "on-mention" },
};

const SYSTEM_PROMPT = `You are Summary, a structured summarization agent. You produce clear, well-organized summaries of conversations and documents.

Your responsibilities:
- Summarize chat history when asked
- Summarize codoc content when provided as context
- Focus on key decisions, action items, and important information

If the summary should be written to a codoc field, include an intent block:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path", "value": "summary text"}}
</intent>

Only propose writes when the user explicitly asks to save the summary to a codoc.
Respond concisely. Use Chinese when the user writes in Chinese.`;

export function createSummaryAgentHandler(): AgentHandler {
  return createLLMAgentHandler({
    agentId: "summary-agent",
    systemPrompt: SYSTEM_PROMPT,
  });
}
