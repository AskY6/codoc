import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { getCredentialStore } from "@codoc/core";

export async function loadCredentials(docsDir: string): Promise<void> {
  const credPath = join(docsDir, ".cobook", "credentials.yaml");
  try {
    const content = await readFile(credPath, "utf-8");
    const creds = parseYaml(content) as Record<string, Record<string, unknown>> | null;
    if (!creds || typeof creds !== "object") return;
    const store = getCredentialStore();
    for (const [name, auth] of Object.entries(creds)) {
      if (auth && typeof auth === "object") {
        store.set(name, auth);
      }
    }
  } catch {
    // File not found or parse error — silent. Connector will report "认证未配置" at runtime.
  }
}
