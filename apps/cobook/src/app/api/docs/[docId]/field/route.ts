import { NextResponse } from "next/server";
import { getSharedWorkspace } from "@/workspace/server/chat";
import { propagateAndInvalidate } from "@cobook/workspace";
import { evictSourceCache } from "@codoc/source";
import type { FieldAction } from "@/shared/types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  const ws = await getSharedWorkspace();

  let body: FieldAction;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { tree, dag } = ws.loadDoc(docId);
    const field = tree.getField(body.path);
    if (!field) {
      return NextResponse.json({ error: `Field not found: ${body.path}` }, { status: 404 });
    }

    if (body.action === "update") {
      tree.updateField(body.path, body.value);
      const dirty = propagateAndInvalidate(dag, tree, [body.path]);
      for (const p of dirty) {
        await tree.observe(p);
      }
    } else if (body.action === "reforce") {
      if (field.meta.loader.type === "source") {
        evictSourceCache(field.meta.loader.$source);
      }
      tree.refreshField(body.path);
      await tree.observe(body.path);
      const dirty = propagateAndInvalidate(dag, tree, [body.path]);
      for (const p of dirty) {
        await tree.observe(p);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
