// Template types — a template is a set of codoc files + component list
// that gets scaffolded into a workspace on `codoc init --from <id>`.

export interface TemplateFile {
  /** Path relative to workspace root (e.g. "rss/openai.codoc") */
  readonly path: string;
  /** Raw file content (YAML frontmatter + MDX body) */
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Interaction declarations — injected into config at init time
// ---------------------------------------------------------------------------

export interface Command {
  readonly name: string;
  readonly description: string;
  /** Full or partial prompt sent to chat when the command is invoked. */
  readonly prompt: string;
}

export interface QuickAction {
  readonly label: string;
  readonly prompt: string;
}

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Component names from the catalog to auto-install */
  readonly components: readonly string[];
  /** Generate the template files */
  files(): readonly TemplateFile[];

  // ---- Interaction declarations (optional) --------------------------------

  /** Domain-specific slash commands → injected into ChatPanel. */
  readonly commands?: readonly Command[];
  /** Chat quick-action chips → replace default chips when present. */
  readonly quickActions?: readonly QuickAction[];
  /** Extra system prompt instructions → concatenated to base prompt. */
  readonly agentInstructions?: string;
}
