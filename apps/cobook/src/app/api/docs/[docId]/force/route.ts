import { NextResponse } from "next/server";
import { getWorkspace } from "@/workspace/api/_workspace";
import { scheduleForce, evictSourceCache } from "@codoc/core";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  const ws = await getWorkspace();

  try {
    const { tree, dag } = ws.loadDoc(docId);

    // Refresh all fields so they re-execute their loaders
    for (const path of tree.getAllPaths()) {
      const field = tree.getField(path);
      if (field?.meta.loader.type === "source") {
        evictSourceCache(field.meta.loader.$source);
      }
      tree.refreshField(path);
    }

    const result = await scheduleForce(tree, dag);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}
