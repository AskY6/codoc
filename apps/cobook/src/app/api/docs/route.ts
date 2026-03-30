import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { rescanWorkspace } from "@/workspace/server/workspace";

export async function POST(req: Request) {
  let body: { docId: string; content: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { docId, content } = body;

  if (!docId || !content) {
    return NextResponse.json(
      { error: "docId and content are required" },
      { status: 400 },
    );
  }

  if (!docId.endsWith(".codoc")) {
    return NextResponse.json(
      { error: "docId must end with .codoc" },
      { status: 400 },
    );
  }

  if (docId.includes("/") || docId.includes("\\") || docId.includes("..")) {
    return NextResponse.json({ error: "Invalid docId" }, { status: 400 });
  }

  const docsDir = resolve(process.cwd(), "docs");
  const filePath = resolve(docsDir, docId);

  try {
    await writeFile(filePath, content, "utf-8");
    const added = await rescanWorkspace();
    return NextResponse.json({ ok: true, docId, added });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
