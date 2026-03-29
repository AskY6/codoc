import { NextResponse } from "next/server";
import { getChatAbility, getSessionId } from "@/workspace/api/_chat";

interface IntentRequest {
  msgId: string;
  intentIdx: number;
  status: "confirmed" | "rejected";
}

export async function POST(req: Request) {
  const body: IntentRequest = await req.json();
  const chat = await getChatAbility();
  const sessionId = await getSessionId();

  chat.updateIntentStatus(sessionId, body.msgId, body.intentIdx, body.status);

  return NextResponse.json({ ok: true });
}
