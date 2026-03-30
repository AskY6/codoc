import type { Workspace, DocMeta, CodocRuntime } from "@codoc/core";
import { listConnectors, getCredentialStore } from "@codoc/core";
import type {
  ContextSource,
  ContextSourceFactory,
} from "../chat/types.js";

export function serializeCodocForLLM(
  meta: DocMeta,
  runtime: CodocRuntime,
): string {
  const lines: string[] = [];
  lines.push(`## ${meta.docId}`);

  lines.push("Schema:");
  lines.push("```json");
  lines.push(JSON.stringify(meta.type, null, 2));
  lines.push("```");

  lines.push("Current values:");
  for (const fieldMeta of meta.fields) {
    const field = runtime.tree.getField(fieldMeta.path);
    if (!field) continue;
    const { state } = field;
    if (state.status === "resolved") {
      lines.push(`- \`${fieldMeta.path}\`: ${JSON.stringify(state.value)}`);
    } else {
      lines.push(`- \`${fieldMeta.path}\`: (${state.status})`);
    }
  }

  return lines.join("\n");
}

export function createCodocContextSource(
  workspace: Workspace,
  docId: string,
): ContextSource {
  return {
    kind: "codoc-snapshot",
    async resolve() {
      const meta = workspace.getDocMeta(docId);
      if (!meta) {
        return { kind: "codoc-snapshot", content: `(codoc "${docId}" not found)` };
      }
      const runtime = workspace.loadDoc(docId);
      const content = serializeCodocForLLM(meta, runtime);
      return { kind: "codoc-snapshot", content };
    },
  };
}

export function createCodocContextSourceFactory(
  workspace: Workspace,
): ContextSourceFactory {
  return {
    kind: "codoc-snapshot",
    create(ref) {
      return createCodocContextSource(workspace, ref.id);
    },
  };
}

export function createConnectorContextSource(): ContextSource {
  return {
    kind: "connector-catalog",
    async resolve() {
      const metas = listConnectors();
      if (metas.length === 0) {
        return { kind: "connector-catalog", content: "(no connectors registered)" };
      }

      const store = getCredentialStore();
      const lines: string[] = [];
      for (const meta of metas) {
        const authStatus = store.has(meta.name) ? "auth configured" : "auth NOT configured";
        lines.push(`- **${meta.displayName}** (\`${meta.name}\`): ${authStatus}`);
        lines.push(`  ${meta.description}`);
      }
      return { kind: "connector-catalog", content: lines.join("\n") };
    },
  };
}
