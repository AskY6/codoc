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
// Helper: build MDX codoc from frontmatter + body
// ---------------------------------------------------------------------------

function mdxCodoc(
  frontmatter: { meta?: Record<string, unknown>; data?: Record<string, unknown> },
  body: string,
): string {
  const fm = stringify(frontmatter).trim();
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Claude Code Log generators
// ---------------------------------------------------------------------------

function generateSessionsCodoc(params: Record<string, unknown>): string {
  const { projectName, projectPath, projectId } = params;
  return mdxCodoc(
    {
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
    },
    `
{(data.sessions ?? []).map(s => (
  <Navigate
    key={s.id}
    to={\`claude-code-logs/${projectId}/\${s.id}.codoc\`}
    generate={{
      source: "local:claude-code-log",
      params: { mode: "session", projectId: "${projectId}", file: \`${projectPath}/\${s.file}\`, sessionName: s.startedAt },
    }}
  >
    <Stack>

**{s.startedAt}**

{s.userMessageCount} user msgs, {s.assistantMessageCount} assistant msgs, {s.toolCallCount} tool calls

    </Stack>
  </Navigate>
))}
`,
  );
}

function generateSessionCodoc(params: Record<string, unknown>): string {
  const { file, sessionName } = params;
  return mdxCodoc(
    {
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
    },
    `
<Section title="Tool Usage">
  <DataTable rows={data.session?.stats?.toolBreakdown ?? []} />
</Section>

<Section title="Conversation">
  <Timeline
    items={(data.session?.messages ?? []).map(msg => ({
      title: msg.role,
      pubDate: msg.timestamp,
      summary: msg.content,
    }))}
  />
</Section>
`,
  );
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
