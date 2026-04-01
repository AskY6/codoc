import { realpathSync } from "node:fs";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { RuleBasedBaseAgent } from "@cobook/agent";
import {
  LocalCobookService,
  RpcCobookService,
  createCobookRpcServer,
  createLoopbackServiceTransport
} from "@cobook/service";

import { CLI_COMMANDS, type CliCommandName } from "./commands/index.js";
import { formatJson } from "./format/index.js";
import { createCliApp, type CliRunResult } from "./index.js";

interface ParsedCliArgs {
  help: boolean;
  root: string;
  transport: "local" | "rpc";
  command?: CliCommandName;
  args: string[];
}

export async function runCliProgram(rawArgv: string[] = argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(rawArgv);
  if (parsed.help) {
    stdout.write(`${renderHelp()}\n`);
    return 0;
  }

  if (!parsed.command) {
    stderr.write("Missing command.\n\n");
    stderr.write(`${renderHelp()}\n`);
    return 1;
  }

  const agent = new RuleBasedBaseAgent();
  const localService = new LocalCobookService({
    chatHandler: (input, boundService) => agent.run(input, boundService)
  });
  const service =
    parsed.transport === "rpc"
      ? new RpcCobookService(
          createLoopbackServiceTransport(createCobookRpcServer(localService))
        )
      : localService;
  await service.openWorkspace(parsed.root);

  if (parsed.command === "watch") {
    if (parsed.transport === "rpc") {
      throw new Error("The watch command currently requires the local service transport.");
    }

    for await (const event of service.watch()) {
      stdout.write(`${formatJson(event)}\n`);
    }

    return 0;
  }

  const app = createCliApp(service);
  const result = await app.run({
    command: parsed.command,
    args: parsed.args
  });

  stdout.write(`${formatResult(result)}\n`);
  return 0;
}

function parseCliArgs(rawArgv: string[]): ParsedCliArgs {
  let help = false;
  let root = cwd();
  let transport: ParsedCliArgs["transport"] = "local";
  const positional: string[] = [];

  for (let index = 0; index < rawArgv.length; index += 1) {
    const entry = rawArgv[index];
    if (!entry) {
      continue;
    }

    if (entry === "--help" || entry === "-h") {
      help = true;
      continue;
    }

    if (entry === "--root") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error("Missing value for --root.");
      }

      root = resolvePath(next);
      index += 1;
      continue;
    }

    if (entry === "--transport") {
      const next = rawArgv[index + 1];
      if (next !== "local" && next !== "rpc") {
        throw new Error('Missing or invalid value for --transport. Use "local" or "rpc".');
      }

      transport = next;
      index += 1;
      continue;
    }

    positional.push(entry);
  }

  return {
    help,
    root,
    transport,
    ...(positional[0] ? { command: positional[0] as CliCommandName } : {}),
    args: positional.slice(1)
  };
}

function renderHelp(): string {
  const commands = CLI_COMMANDS.map(
    (command) => `  ${command.name.padEnd(8, " ")} ${command.description}`
  ).join("\n");

  return [
    "Usage: cobook [--root <path>] [--transport local|rpc] <command> [args...]",
    "",
    "Commands:",
    commands
  ].join("\n");
}

function formatResult(result: CliRunResult): string {
  if (Array.isArray(result) && result.every((entry) => typeof entry === "string")) {
    return result.join("\n");
  }

  return formatJson(result);
}

function isMainModule(): boolean {
  const entry = argv[1];
  if (!entry) {
    return false;
  }

  return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runCliProgram().then(
    (code) => {
      exit(code);
    },
    (error: unknown) => {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
    }
  );
}
