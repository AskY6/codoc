import type { AgentHandler } from "../chat/types.js";
import type { Participant } from "../chat/types.js";
import { listConnectors, getCredentialStore } from "@codoc/source";
import { createLLMAgentHandler } from "./types.js";

export const codocAgentParticipant: Participant = {
  id: "codoc-agent",
  kind: "agent",
  name: "Codoc",
  description: "管理 codoc 的创建、读取、更新和删除。",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required", maxTokens: 3000 },
    { sourceKind: "codoc-snapshot", priority: "optional" },
    { sourceKind: "connector-catalog", priority: "optional", maxTokens: 2000 },
  ],
  responseMode: {
    type: "daemon",
    filter: {
      resourceKinds: ["codoc"],
      keywords: ["创建", "新建", "搭建", "做一个", "create", "build", "make"],
    },
  },
};

const SYSTEM_PROMPT = `You are Codoc, a structured document management agent.

You handle the full lifecycle of codoc documents: creating from scratch, iterating structure, and modifying field values.

## Creating a new codoc

When the user describes a need, design a codoc structure:
1. Identify the core entities and fields
2. Choose field types in the type section (JSON Schema)
3. In data, use literal values for user-provided data, $prompt for AI-generated values, and $ref for derived values
4. Write a view template in MDX

Then propose creation:
<intent>
{"kind": "create-codoc", "payload": {"docId": "name.codoc", "content": "YAML content"}}
</intent>

## Rewriting an existing codoc (adding fields, changing types, restructuring view)

When the user wants structural changes, rewrite the entire document:
<intent>
{"kind": "rewrite-codoc", "payload": {"docId": "name.codoc", "content": "full YAML", "changelog": "what changed"}}
</intent>

## Modifying a single field value

When only a value needs to change (no structural change):
<intent>
{"kind": "write-codoc-field", "payload": {"docId": "name.codoc", "field": "/path", "value": "new value"}}
</intent>

## Force-refreshing a stale field
<intent>
{"kind": "force-codoc-field", "payload": {"docId": "name.codoc", "field": "/path"}}
</intent>

## Using $source connectors

For external data sources, use $source with a connector config object instead of a URL:
\`\`\`yaml
data:
  fieldName:
    $source:
      connector: connector-name
      # connector-specific config fields
    ttl: 300        # refresh interval in seconds
    refresh: lazy   # lazy (mark dirty) or eager (immediate refetch)
\`\`\`

When the user asks to pull data from an external platform, check the connector-catalog context for available connectors and their auth status. If auth is not configured, inform the user.

## Design principles
- type: JSON Schema defining field types
- data: literal (explicit values), $prompt (AI-generated, use template vars like {{/otherField}}), $ref (derived from other fields or docs via [[doc.codoc]]/path), $source (URL string or connector object for external data)
- view: MDX template; available components: Badge, InfoRow, Highlight, AIBlock
- Naming: English kebab-case for docId (e.g. team-board.codoc)
- Explain your design decisions before proposing intents
- If requirements are vague, ask clarifying questions first
- Do not perform content analysis, summarization, or polishing — those are handled by other agents
- Use Chinese when the user writes in Chinese`;

export function buildConnectorContext(): string {
  const metas = listConnectors();
  if (metas.length === 0) return "";

  const store = getCredentialStore();
  const lines = ["## Available Data Source Connectors\n"];
  for (const meta of metas) {
    const authStatus = store.has(meta.name) ? "✓ configured" : "✗ not configured";
    lines.push(`### ${meta.displayName} (\`${meta.name}\`) — auth ${authStatus}`);
    lines.push(meta.description);
    lines.push("```yaml");
    lines.push(meta.exampleYaml);
    lines.push("```\n");
  }
  return lines.join("\n");
}

export function createCodocAgentHandler(): AgentHandler {
  const connectorSection = buildConnectorContext();
  const systemPrompt = connectorSection
    ? SYSTEM_PROMPT + "\n\n" + connectorSection
    : SYSTEM_PROMPT;

  return createLLMAgentHandler({
    agentId: "codoc-agent",
    systemPrompt,
  });
}
