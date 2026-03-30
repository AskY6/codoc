import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Workspace, setLLMClient } from "@codoc/core";
import type { LLMClient } from "@codoc/core";
import { getClient, getModel } from "@/shared/ai";
import { loadCredentials } from "./credentials.js";
import { registerAllConnectors } from "./register-connectors.js";

function ensureLLMClient(): void {
  const client = getClient();
  const impl: LLMClient = {
    async generate({ prompt, schema }) {
      const res = await client.messages.create({
        model: getModel(),
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      let text = "";
      for (const block of res.content) {
        if (block.type === "text") text += block.text;
      }

      // If a non-empty schema is provided, attempt structured JSON parse.
      if (schema && Object.keys(schema).length > 0) {
        try {
          return JSON.parse(text);
        } catch {
          /* fall through to raw text */
        }
      }
      return text;
    },
  };
  setLLMClient(impl);
}

const g = globalThis as typeof globalThis & { _ws?: Workspace };

export async function getWorkspace(): Promise<Workspace> {
  if (!g._ws) {
    ensureLLMClient();
    const docsDir = resolve(process.cwd(), "docs");
    await mkdir(docsDir, { recursive: true });
    await loadCredentials(docsDir);
    await registerAllConnectors(docsDir);
    g._ws = await Workspace.create(docsDir);
  }
  return g._ws;
}

export async function rescanWorkspace(): Promise<string[]> {
  const ws = await getWorkspace();
  return ws.rescan();
}
