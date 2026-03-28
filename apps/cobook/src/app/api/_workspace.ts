import { resolve } from "node:path";
import { Workspace } from "@codoc/core";

const g = globalThis as typeof globalThis & { _ws?: Workspace };

export async function getWorkspace(): Promise<Workspace> {
  if (!g._ws) {
    g._ws = await Workspace.create(resolve(process.cwd(), "docs"));
  }
  return g._ws;
}
