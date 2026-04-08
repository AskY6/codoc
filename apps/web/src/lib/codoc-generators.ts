import { stringify } from "yaml";

// ---------------------------------------------------------------------------
// Codoc content generators for lazy navigate actions
// ---------------------------------------------------------------------------

type Generator = (params: Record<string, unknown>) => string;

const generators = new Map<string, Generator>();

export function registerCodocGenerator(
  source: string,
  generator: Generator,
): void {
  generators.set(source, generator);
}

export function generateCodocContent(
  source: string,
  params: Record<string, unknown>,
): string | null {
  const gen = generators.get(source);
  if (!gen) return null;
  return gen(params);
}

// ---------------------------------------------------------------------------
// Claude Code Log generators
// ---------------------------------------------------------------------------

function generateSessionsCodoc(params: Record<string, unknown>): string {
  const { projectName, projectPath, projectId } = params;
  return stringify({
    meta: {
      title: `Sessions: ${projectName}`,
      tags: ["claude-code", "logs"],
    },
    data: {
      sessions: {
        $source: "local:claude-code-log",
        mode: "sessions",
        projectPath,
      },
    },
    view: {
      type: "stack",
      repeat: { bind: "data.sessions", as: "s" },
      template: {
        type: "stack",
        children: [
          {
            type: "text",
            props: { content: "{{s.startedAt}}", variant: "caption" },
          },
          {
            type: "text",
            props: {
              content:
                "{{s.userMessageCount}} user msgs, {{s.assistantMessageCount}} assistant msgs, {{s.toolCallCount}} tool calls",
            },
          },
        ],
        action: {
          type: "navigate",
          path: `claude-code-logs/${projectId}/{{s.id}}.codoc`,
          generate: {
            source: "local:claude-code-log",
            params: {
              mode: "session",
              projectId,
              file: `${projectPath}/{{s.file}}`,
              sessionName: "{{s.startedAt}}",
            },
          },
        },
      },
    },
  });
}

function generateSessionCodoc(params: Record<string, unknown>): string {
  const { file, sessionName } = params;
  return stringify({
    meta: {
      title: `Session ${sessionName ?? ""}`.trim(),
      tags: ["claude-code", "logs", "session"],
    },
    data: {
      session: {
        $source: "local:claude-code-log",
        mode: "session",
        file,
      },
    },
    view: {
      type: "section",
      children: [
        {
          type: "section",
          props: { title: "Tool Usage" },
          children: [
            { type: "table", bind: "data.session.stats.toolBreakdown" },
          ],
        },
        {
          type: "section",
          props: { title: "Conversation" },
          children: [
            {
              type: "timeline",
              repeat: { bind: "data.session.messages", as: "msg" },
              template: {
                type: "stack",
                children: [
                  {
                    type: "text",
                    props: {
                      content: "{{msg.role}} — {{msg.timestamp}}",
                      variant: "caption",
                    },
                  },
                  {
                    type: "markdown",
                    props: { content: "{{msg.content}}" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });
}

function claudeCodeLogGenerator(params: Record<string, unknown>): string {
  const mode = String(params["mode"]);
  switch (mode) {
    case "sessions":
      return generateSessionsCodoc(params);
    case "session":
      return generateSessionCodoc(params);
    default:
      throw new Error(`No codoc generator for mode: ${mode}`);
  }
}

// ---------------------------------------------------------------------------
// Register built-in generators
// ---------------------------------------------------------------------------

registerCodocGenerator("local:claude-code-log", claudeCodeLogGenerator);
