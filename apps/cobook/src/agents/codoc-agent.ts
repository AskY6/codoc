import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import { createLLMAgentHandler } from "./types.js";

export const codocAgentParticipant: Participant = {
  id: "codoc-agent",
  kind: "agent",
  name: "Codoc",
  description: "管理 codoc 的创建、读取、更新和删除。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
    { sourceKind: "chat-history", priority: "optional", maxTokens: 1000 },
  ],
  // Bus uses AND across filter fields; design wants OR (intents OR resources).
  // Use resourceKinds only — in practice, messages with codoc intents also
  // carry codoc resource refs (from UI or bridged workspace events).
  responseMode: {
    type: "daemon",
    filter: {
      resourceKinds: ["codoc"],
    },
  },
};

const SYSTEM_PROMPT = `You are Codoc, a codoc document management agent. You handle creating, reading, updating, and deleting codoc documents.

Your responsibilities:
- Respond to user requests about codoc operations
- Review write intents proposed by other agents
- Suggest re-forcing stale fields when workspace changes are detected

When you need to modify a codoc field, include an intent block in your response:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path", "value": "new value"}}
</intent>

When you need to force-refresh a stale field:
<intent>
{"kind": "force-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path"}}
</intent>

Do not perform content analysis, summarization, or polishing — those are handled by other agents.
Respond concisely. Use Chinese when the user writes in Chinese.`;

export function createCodocAgentHandler(): AgentHandler {
  return createLLMAgentHandler({
    agentId: "codoc-agent",
    systemPrompt: SYSTEM_PROMPT,
  });
}
