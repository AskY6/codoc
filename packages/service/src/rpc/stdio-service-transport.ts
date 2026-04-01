import { spawn } from "node:child_process";

import type { ClosableServiceTransport, ServiceRpcRequest, ServiceRpcResponse } from "./types.js";

export interface StdioServiceTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface PendingRequest<TResult> {
  resolve: (response: ServiceRpcResponse<TResult>) => void;
  reject: (error: Error) => void;
}

export function createStdioServiceTransport(
  options: StdioServiceTransportOptions
): ClosableServiceTransport {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const pending = new Map<string, PendingRequest<unknown>>();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;

  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    processStdoutBuffer();
  });

  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  child.on("error", (error) => {
    rejectAllPending(
      new Error(`RPC server process failed to start: ${error instanceof Error ? error.message : String(error)}`)
    );
  });

  child.on("exit", (code, signal) => {
    if (closed) {
      return;
    }

    rejectAllPending(
      new Error(
        [
          `RPC server process exited unexpectedly.`,
          `code=${code ?? "null"} signal=${signal ?? "null"}`,
          stderrBuffer.length > 0 ? `stderr:\n${stderrBuffer}` : ""
        ]
          .filter((line) => line.length > 0)
          .join("\n")
      )
    );
  });

  return {
    send<TResult = unknown>(request: ServiceRpcRequest): Promise<ServiceRpcResponse<TResult>> {
      if (closed) {
        return Promise.reject(new Error("RPC server transport is already closed."));
      }

      return new Promise<ServiceRpcResponse<TResult>>((resolve, reject) => {
        pending.set(request.id, {
          resolve: resolve as PendingRequest<unknown>["resolve"],
          reject
        });

        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) {
            return;
          }

          pending.delete(request.id);
          reject(
            new Error(
              `Failed to write RPC request "${request.method}": ${error instanceof Error ? error.message : String(error)}`
            )
          );
        });
      });
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;

      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
          }
          resolve();
        }, 1000);

        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });

        child.stdin.end();
      });
    }
  };

  function processStdoutBuffer(): void {
    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      let response: ServiceRpcResponse;
      try {
        response = JSON.parse(line) as ServiceRpcResponse;
      } catch {
        rejectAllPending(
          new Error(
            `Failed to parse RPC response line: ${line}${stderrBuffer.length > 0 ? `\nstderr:\n${stderrBuffer}` : ""}`
          )
        );
        void close();
        return;
      }

      const pendingRequest = pending.get(response.id);
      if (!pendingRequest) {
        continue;
      }

      pending.delete(response.id);
      pendingRequest.resolve(response);
    }
  }

  function rejectAllPending(error: Error): void {
    for (const request of pending.values()) {
      request.reject(error);
    }

    pending.clear();
  }
}
