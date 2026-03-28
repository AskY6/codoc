import { NextResponse } from "next/server";
import { getWorkspace } from "../../_workspace";
import { scheduleForce } from "@codoc/core";
import type { DocSnapshot, FieldSnapshot } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  const ws = await getWorkspace();
  const meta = ws.getDocMeta(docId);
  if (!meta) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { tree, dag } = ws.loadDoc(docId);

  // Kick off force in background (results stream via SSE)
  const allIdle = tree.getAllPaths().every((p) => {
    const f = tree.getField(p);
    return f?.state.status === "idle";
  });
  if (allIdle) {
    scheduleForce(tree, dag).catch(() => {});
  }

  const fields: Record<string, FieldSnapshot> = {};
  for (const path of tree.getAllPaths()) {
    const field = tree.getField(path)!;
    const snap: FieldSnapshot = {
      status: field.state.status,
      loaderType: field.meta.loader.type,
    };
    if (field.state.status === "resolved") {
      snap.value = field.state.value;
    }
    if (field.state.status === "error") {
      snap.error = field.state.error.message;
    }
    fields[path] = snap;
  }

  // Preprocess view: {fieldName} → <CodataValue path="/fieldName" />
  const codoc = ws.getRawDoc(docId);
  let view = codoc?.view ?? "";
  if (codoc?.data) {
    for (const name of Object.keys(codoc.data)) {
      view = view.replace(
        new RegExp(`\\{${name}\\}`, "g"),
        `<CodataValue path="/${name}" />`,
      );
    }
  }

  const snapshot: DocSnapshot = {
    docId,
    fields,
    view,
    externalRefs: meta.externalRefs,
  };

  return NextResponse.json(snapshot);
}
