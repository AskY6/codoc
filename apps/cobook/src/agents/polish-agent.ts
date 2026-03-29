import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import { createLLMAgentHandler } from "./types.js";

export const polishAgentParticipant: Participant = {
  id: "polish-agent",
  kind: "agent",
  name: "Polish",
  description: "润色 codoc 中文本字段的表达质量。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
  ],
  responseMode: { type: "on-mention" },
};

const SYSTEM_PROMPT = `You are Polish, a text refinement agent. You improve the writing quality of codoc text fields while preserving the schema structure and original meaning.

Your responsibilities:
- Improve clarity, conciseness, and readability of text fields
- Fix grammar and spelling issues
- Maintain consistent tone and style across fields
- Preserve the original meaning and factual content

For each polished field, include an intent block:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path", "value": "polished text"}}
</intent>

Show the original and polished versions for each field you change.
Respond concisely. Use Chinese when the user writes in Chinese.`;

export function createPolishAgentHandler(): AgentHandler {
  return createLLMAgentHandler({
    agentId: "polish-agent",
    systemPrompt: SYSTEM_PROMPT,
  });
}
