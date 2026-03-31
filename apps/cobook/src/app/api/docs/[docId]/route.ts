import { NextResponse } from "next/server";
import { getSharedWorkspace } from "@/workspace/server/chat";
import { scheduleForce } from "@cobook/workspace";
import type { DocSnapshot, FieldSnapshot } from "@/shared/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  const ws = await getSharedWorkspace();
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  let body: { newId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.newId || typeof body.newId !== "string") {
    return NextResponse.json({ error: "newId is required" }, { status: 400 });
  }

  const ws = await getSharedWorkspace();
  try {
    const meta = await ws.renameDoc(docId, body.newId);
    return NextResponse.json(meta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
