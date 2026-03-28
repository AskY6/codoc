export interface CommandDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** "agent" invokes a preset agent; "utility" runs a built-in action. */
  action: "agent" | "utility";
  /** Required when action is "agent". */
  agentId?: string;
}

export const BUILTIN_COMMANDS: CommandDef[] = [
  {
    id: "summary",
    name: "Summary",
    description: "Generate a structured summary from referenced codocs",
    icon: "FileText",
    action: "agent",
    agentId: "summary",
  },
  {
    id: "check",
    name: "Information Check",
    description: "Verify field consistency and reference validity",
    icon: "ShieldCheck",
    action: "agent",
    agentId: "info-check",
  },
  {
    id: "polish",
    name: "Text Polish",
    description: "Improve text quality while preserving structure",
    icon: "Sparkles",
    action: "agent",
    agentId: "polish",
  },
  {
    id: "clear",
    name: "Clear Chat",
    description: "Clear all messages in the conversation",
    icon: "Trash2",
    action: "utility",
  },
  {
    id: "help",
    name: "Help",
    description: "Show available commands and shortcuts",
    icon: "CircleHelp",
    action: "utility",
  },
];

export function filterCommands(query: string): CommandDef[] {
  if (!query) return BUILTIN_COMMANDS;
  const q = query.toLowerCase();
  return BUILTIN_COMMANDS.filter(
    (c) =>
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
  );
}
