import { createInterface } from "node:readline";
import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { resolveWorkspaceId } from "../workspace-discovery.js";

export function registerChatCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("chat")
    .description("Start an interactive chat with the Cobook assistant")
    .option("--new", "Start a new thread (skip resume prompt)")
    .option("--thread <id>", "Resume a specific thread by ID")
    .action(async (opts: { new?: boolean; thread?: string }) => {
      const client = getClient();
      const wsId = await resolveWorkspaceId(
        client,
        program.opts()["workspace"] as string | undefined,
      );

      let threadId: string;

      if (opts.thread) {
        // Resume specific thread
        threadId = opts.thread;
        console.log(`Resuming thread ${threadId}\n`);
      } else if (opts.new) {
        // Force new thread
        const thread = await client.createThread(wsId);
        threadId = thread.id;
        console.log("New conversation started.\n");
      } else {
        // Check for existing threads
        const threads = await client.listThreads(wsId);
        if (threads.length > 0) {
          const latest = threads[threads.length - 1]!;
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(
              `Found previous conversation (${latest.id.slice(0, 8)}...). Resume? [Y/n] `,
              (ans) => {
                rl.close();
                resolve(ans.trim().toLowerCase());
              },
            );
          });
          if (answer === "" || answer === "y" || answer === "yes") {
            threadId = latest.id;
            // Print last few messages for context
            const detail = await client.getThread(threadId);
            const recent = detail.messages.slice(-4);
            if (recent.length > 0) {
              console.log("\n--- Recent messages ---");
              for (const msg of recent) {
                const prefix = msg.role === "user" ? "\x1b[36myou\x1b[0m" : "\x1b[32massistant\x1b[0m";
                const text = msg.content.length > 120 ? msg.content.slice(0, 120) + "..." : msg.content;
                console.log(`${prefix}: ${text}`);
              }
              console.log("--- End ---\n");
            }
          } else {
            const thread = await client.createThread(wsId);
            threadId = thread.id;
            console.log("New conversation started.\n");
          }
        } else {
          const thread = await client.createThread(wsId);
          threadId = thread.id;
          console.log("New conversation started.\n");
        }
      }

      // Interactive REPL
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log("Type your message (Ctrl+C to exit).\n");

      const prompt = () => {
        rl.question("\x1b[36myou>\x1b[0m ", async (input) => {
          const trimmed = input.trim();
          if (!trimmed) {
            prompt();
            return;
          }

          process.stdout.write("\x1b[32massistant>\x1b[0m ");

          try {
            const res = await client.sendMessage(threadId, trimmed, wsId);
            await consumeSSE(res);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`\n\x1b[31mError: ${msg}\x1b[0m`);
          }

          console.log("\n");
          prompt();
        });
      };

      rl.on("close", () => {
        console.log("\nBye!");
        process.exit(0);
      });

      prompt();
    });
}

// ---------------------------------------------------------------------------
// SSE consumer — reads the response body as a stream of SSE events
// ---------------------------------------------------------------------------

async function consumeSSE(res: Response): Promise<void> {
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          if (data.text) {
            process.stdout.write(data.text);
          } else if (data.message) {
            // error event
            process.stdout.write(`\n\x1b[31m[error] ${data.message}\x1b[0m`);
          }
        } catch {
          // non-JSON data line, skip
        }
      }
      // event: lines and empty lines are ignored for output
    }
  }
}
