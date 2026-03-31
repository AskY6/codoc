import { NextResponse } from "next/server";
import { getSharedWorkspace } from "@/workspace/server/chat";
import type { WorkspaceSnapshot, DocMeta } from "@/shared/types";

export async function GET() {
  const ws = await getSharedWorkspace();
  const rawDocs = ws.listDocs();
  const graph = ws.getDependencyGraph();

  const docs: DocMeta[] = rawDocs.map((d) => ({
    docId: d.docId,
    fields: d.fields.map((f) => ({
      path: f.path,
      loaderType: f.loaderType,
      description: f.description,
    })),
  }));

  const snapshot: WorkspaceSnapshot = { docs, graph };
  return NextResponse.json(snapshot);
}
