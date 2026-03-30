import { NextResponse } from "next/server";
import { getWorkspace } from "@/workspace/server/workspace";

/**
 * POST /api/ingest
 * Body: { skill: string, path: string }
 * Triggers skill-based ingestion of an external directory.
 */
export async function POST(req: Request) {
  let body: { skill?: string; path: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.path || typeof body.path !== "string") {
    return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
  }

  const skillName = body.skill ?? "claude-code-log";

  try {
    const ws = await getWorkspace();
    const docIds = await ws.ingestBySkillName(skillName, body.path);
    return NextResponse.json({ docIds });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
