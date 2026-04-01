import type { BuildResult, GraphSnapshot, ResolvedValue } from "@cobook/core";
import type { CodocSummary, CobookService } from "@cobook/service";

import { CLI_COMMANDS, type CliCommand, type CliCommandName } from "./commands/index.js";
import { collectChatTranscript } from "./tui/index.js";

export interface CliRunInput {
  command: CliCommandName;
  args: string[];
}

export type CliRunResult =
  | BuildResult
  | GraphSnapshot
  | ResolvedValue
  | CodocSummary[]
  | string[];

export interface CliApp {
  commands: readonly CliCommand[];
  run(input: CliRunInput): Promise<CliRunResult>;
}

export function createCliApp(service: CobookService): CliApp {
  return {
    commands: CLI_COMMANDS,
    async run(input) {
      switch (input.command) {
        case "list":
          return service.listCodocs();
        case "validate":
          return service.build();
        case "resolve": {
          const nodeKey = input.args[0];
          if (!nodeKey) {
            throw new Error("Missing required node key.");
          }

          return service.resolve(nodeKey);
        }
        case "graph":
          return service.graph();
        case "chat":
          return collectChatTranscript(
            service.chat({
              message: input.args.join(" ")
            })
          );
      }
    }
  };
}
