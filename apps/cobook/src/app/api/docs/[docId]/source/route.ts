import { NextResponse } from "next/server";
import { getSharedWorkspace } from "@/workspace/server/chat";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params;
  const ws = await getSharedWorkspace();

  const source = await ws.getRawSource(docId);
  if (source === undefined) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return new NextResponse(source, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
  });
}
