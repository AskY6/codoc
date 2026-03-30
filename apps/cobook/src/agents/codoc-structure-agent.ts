import type {
  SceneAgent,
  SceneAgentContext,
  SceneAgentResult,
  IntentProposal,
} from "../scene-agents/types.js";
import { getClient, getModel } from "../shared/ai.js";
import { parseIntentBlocks, stripIntentBlocks } from "./utils.js";

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

For external data sources, use $source with a connector config object:
\`\`\`yaml
data:
  fieldName:
    $source:
      connector: connector-name
      # connector-specific config fields
    ttl: 300
    refresh: lazy
\`\`\`

When the user asks to pull data from an external platform, check the connector-catalog context for available connectors.

## Codoc structure

A codoc has four parts:
- **meta**: Self-describing layer — meta.data (JSON Schema), meta.components (component signatures with props + description)
- **data**: Field values — literal, $prompt, $ref, $source
- **components**: Bundle references — where each component's implementation lives (workspace://, local, registry://)
- **view**: MDX template — uses only components declared in meta.components

## Design principles
- Naming: English kebab-case for docId (e.g. team-board.codoc)
- Explain your design decisions before proposing intents
- If requirements are vague, ask clarifying questions first
- Use Chinese when the user writes in Chinese`;

export const codocStructureAgent: SceneAgent = {
  id: "codoc-agent",
  name: "Codoc Agent",
  description: "管理 codoc 的创建、结构设计、字段修改和重写。",
  trusted: false,

  async handle(context: SceneAgentContext): Promise<SceneAgentResult> {
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
      dataSection ? `## Current Data\n${dataSection}` : "",
      `## User Request\n${context.userMessage}`,
      context.additionalContext
        ? `## Additional Context\n${context.additionalContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await client.messages.create({
      model: getModel(),
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
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

    return { reply: reply || "已分析请求。", proposals };
  },
};
