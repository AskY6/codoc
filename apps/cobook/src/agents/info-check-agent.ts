import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import { createLLMAgentHandler } from "./types.js";

export const infoCheckAgentParticipant: Participant = {
  id: "info-check-agent",
  kind: "agent",
  name: "Info Check",
  description: "校验 codoc 字段的一致性、时效性和引用有效性。",
  contextRequirements: [
    { sourceKind: "codoc-snapshot", priority: "required" },
    { sourceKind: "chat-history", priority: "optional", maxTokens: 500 },
  ],
  responseMode: { type: "on-mention" },
};

const SYSTEM_PROMPT = `You are Info Check, a validation agent. You check codoc fields for consistency, freshness, and reference validity.

Your responsibilities:
- Verify that field values are consistent with each other
- Identify outdated or stale information
- Check that references between fields are valid
- Produce a structured validation report

If you find fields that need correction, include intent blocks:
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "DOC_ID", "field": "/field/path", "value": "corrected value"}}
</intent>

Always explain what issues you found before proposing corrections.
Respond concisely. Use Chinese when the user writes in Chinese.`;

export function createInfoCheckAgentHandler(): AgentHandler {
  return createLLMAgentHandler({
    agentId: "info-check-agent",
    systemPrompt: SYSTEM_PROMPT,
  });
}
