import { getWorkspace } from "./_workspace";
import { scheduleForce } from "@codoc/core";

export async function gatherDocContext(docIds: string[]): Promise<string> {
  const ws = await getWorkspace();
  const sections: string[] = [];

  for (const docId of docIds) {
    const meta = ws.getDocMeta(docId);
    if (!meta) {
      sections.push(`## ${docId}\n_Document not found._`);
      continue;
    }

    const { tree, dag } = ws.loadDoc(docId);
    await scheduleForce(tree, dag).catch(() => {});

    const fields: string[] = [];
    for (const path of tree.getAllPaths()) {
      const field = tree.getField(path);
      if (!field) continue;
      const state = field.state;
      let display: string;
      if (state.status === "resolved") {
        display =
          typeof state.value === "string"
            ? state.value
            : JSON.stringify(state.value, null, 2);
      } else if (state.status === "error") {
        display = `[error: ${state.error?.message ?? "unknown"}]`;
      } else {
        display = `[${state.status}]`;
      }
      fields.push(`- **${path}** (${field.meta.loader.type}): ${display}`);
    }

    sections.push(`## ${docId}\n${fields.join("\n")}`);
  }

  return sections.join("\n\n");
}
