import { NextResponse } from "next/server";
import { getChatAbility, getSessionId } from "@/workspace/api/_chat";

export async function POST(req: Request) {
  const body: { kind: string; id: string; label?: string } = await req.json();
  const chat = await getChatAbility();
  const sessionId = await getSessionId();

  chat.addResourceRef(sessionId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const refId = searchParams.get("id");
  if (!refId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const chat = await getChatAbility();
  const sessionId = await getSessionId();

  chat.removeResourceRef(sessionId, refId);
  return NextResponse.json({ ok: true });
}
