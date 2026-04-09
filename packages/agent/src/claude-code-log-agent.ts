import type Anthropic from "@anthropic-ai/sdk";
import { createBaseAgent } from "./base-agent.js";
import { toolDefinitions, executeTool } from "./tools.js";
import type { Agent, AgentContext, LLMConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const LOG_TOOLS: Anthropic.Tool[] = [
  {
    name: "listLogCodocs",
    description:
      'List all Claude Code log codocs in the workspace. These are codocs under the "claude-code-logs/" path with tags including "claude-code".',
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "getSessionData",
    description:
      "Get the resolved data of a session codoc, including parsed messages, tool usage stats, and conversation content.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the session codoc, e.g. 'claude-code-logs/project-id/session-id.codoc'",
        },
      },
      required: ["path"],
    },
  },
];

const CODOC_TOOLS = toolDefinitions.filter(
  (t) =>
    t.name === "listCodocs" ||
    t.name === "getCodoc" ||
    t.name === "createCodoc" ||
    t.name === "updateCodoc",
);

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeLogTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<unknown> {
  if (name === "listLogCodocs") {
    const all = await ctx.service.listCodocs(ctx.workspaceId);
    return all.filter(
      (c) =>
        c.path.startsWith("claude-code-logs/") &&
        c.meta?.tags?.includes("claude-code"),
    );
  }

  if (name === "getSessionData") {
    const path = String(input["path"]);
    const info = await ctx.service.getCodoc(ctx.workspaceId, path);
    if (!info) return { error: `Codoc not found: ${path}` };
    return {
      path: info.path,
      meta: info.ast?.meta,
      resolvedData: info.resolvedData,
      nodeState: info.nodeState,
    };
  }

  // Fall through to platform codoc tools
  return executeTool(name, input, ctx);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Claude Code log analysis assistant within a Cobook workspace.

## Your purpose

You help users understand their Claude Code usage patterns by analyzing conversation logs stored as codocs. You can:

1. **Browse logs** — List available log sessions and their metadata.
2. **Analyze sessions** — Read parsed session data (messages, tool calls, stats) and identify patterns.
3. **Distill experiences** — Create structured "experience" codocs that capture learnings, patterns, and anti-patterns.

## How logs are structured

Claude Code conversation logs are stored as a 3-level lazy codoc tree:
- \`claude-code-logs/_index.codoc\` — root index listing all projects
- \`claude-code-logs/{project}/_index.codoc\` — session list for a project (generated on click)
- \`claude-code-logs/{project}/{session}.codoc\` — full parsed session (generated on click)

Session codocs contain resolved data with:
- \`session.messages\` — array of {role, content, toolCalls?, timestamp}
- \`session.stats\` — {messageCount, userMessageCount, assistantMessageCount, toolCallCount, toolBreakdown}
- \`session.stats.toolBreakdown\` — array of {tool, count} sorted by frequency

## Setting up the log browser

When the user asks to set up log browsing, create logs entry, or similar, create the root codoc at \`claude-code-logs/_index.codoc\` using this exact template:

\`\`\`mdx
---
meta:
  title: Claude Code Logs
  tags:
    - claude-code
    - logs
data:
  projects:
    $source: "local:claude-code-log"
    mode: projects
    path: .claude/projects
---

{(data.projects ?? []).map(project => (
  <Navigate
    key={project.id}
    to={\`claude-code-logs/\${project.id}/_index.codoc\`}
    generate={{
      source: "local:claude-code-log",
      params: { mode: "sessions", projectId: project.id, projectName: project.name, projectPath: project.path },
    }}
  >
    <Stack>

**{project.name}**

{project.sessionCount} sessions

    </Stack>
  </Navigate>
))}
\`\`\`

The child codocs (session list, session detail) are generated automatically when the user clicks — you do NOT need to create them manually. The \`Navigate\` component with \`generate\` config handles lazy creation.

## Creating experience codocs

When the user asks you to summarize or distill experiences, create a codoc at \`experiences/<slug>.codoc\`:

\`\`\`mdx
---
meta:
  title: "<descriptive title>"
  description: "<one-line summary>"
  tags: [experience, claude-code]
data:
  source_sessions:
    - "<session codoc path>"
  patterns:
    - name: "<pattern name>"
      description: "<what it is and why it works>"
      evidence_count: 0
  anti_patterns:
    - name: "<anti-pattern name>"
      description: "<what happens and how to avoid it>"
      occurrences: 0
  tool_profile:
    - tool: Read
      count: 0
    - tool: Edit
      count: 0
  key_learnings:
    - "<concrete, actionable learning>"
---

<Section title="Patterns">
  <DataTable rows={data.patterns} />
</Section>

<Section title="Anti-patterns">
  <DataTable rows={data.anti_patterns} />
</Section>

<Section title="Tool Usage">
  <DataTable rows={data.tool_profile} />
</Section>

<Section title="Key Learnings">

{(data.key_learnings ?? []).map((l, i) => <p key={i}>- {l}</p>)}

</Section>
\`\`\`

## Available MDX components

**Base:** \`Section\`, \`Stack\`, \`Grid\`, \`Tabs\`, \`Tab\`, \`Navigate\`, \`DataTable\`, \`MetricBar\`, \`Callout\`, \`MarkdownContent\`, \`Timeline\`
**Claude Code:** \`Conversation\`

### Component guidance
- **Conversation**: Display conversation flow. Accepts \`messages: {role, content, timestamp, toolCalls}[]\`. Use for session message display.
- **MetricBar**: Show session stats overview (message count, tool calls, etc.).
- **DataTable**: Show tool usage breakdown or structured data.
- **Callout**: Highlight key findings or warnings.
- Different sessions may need different display emphasis. Tool-heavy sessions should highlight tool stats; conversation-heavy ones should highlight the conversation flow.

**Never invent component names.** Only use the components listed above.

## Guidelines
- Be concise. Focus on actionable insights, not raw data dumps.
- When analyzing, look for: repeated tool sequences, error→retry patterns, successful vs. failed approaches, tool usage distribution.
- Summarize in the same language the user uses.
- When asked to compare sessions, highlight what changed between successful and unsuccessful approaches.`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createClaudeCodeLogAgent(config?: LLMConfig): Agent {
  return createBaseAgent({
    ...config,
    name: "Claude Code Log Analyst",
    description:
      "Analyze Claude Code conversation logs, identify patterns, and distill experiences into codocs",
    systemPrompt: SYSTEM_PROMPT,
    tools: [...LOG_TOOLS, ...CODOC_TOOLS],
    toolExecutor: executeLogTool,
  });
}
