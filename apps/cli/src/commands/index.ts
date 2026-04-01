export type CliCommandName = "list" | "validate" | "resolve" | "graph" | "chat";

export interface CliCommand {
  name: CliCommandName;
  description: string;
}

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "list", description: "List codocs in the current workspace." },
  { name: "validate", description: "Parse and validate the current workspace." },
  { name: "resolve", description: "Resolve a single node key." },
  { name: "graph", description: "Inspect the current DAG snapshot." },
  { name: "chat", description: "Send a message through the base AI flow." }
];
