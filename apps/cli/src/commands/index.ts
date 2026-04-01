export type CliCommandName =
  | "list"
  | "validate"
  | "graph"
  | "diagnose"
  | "watch"
  | "invalidate"
  | "resolve"
  | "chat";

export interface CliCommand {
  name: CliCommandName;
  description: string;
}

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "list", description: "List codocs in the current workspace." },
  { name: "validate", description: "Parse and validate the current workspace." },
  { name: "graph", description: "Inspect the current DAG snapshot." },
  { name: "diagnose", description: "Show graph nodes with runtime state and dependents." },
  { name: "watch", description: "Watch workspace changes and rebuild on codoc/config updates." },
  { name: "invalidate", description: "Mark a node and its dependents as dirty." },
  { name: "resolve", description: "Resolve a single node key." },
  { name: "chat", description: "Send a message through the base AI flow." }
];
