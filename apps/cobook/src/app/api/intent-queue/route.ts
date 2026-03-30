import { NextResponse } from "next/server";
import { getIntentQueue } from "@/workspace/server/chat";

interface IntentQueueAction {
  intentId: string;
  action: "confirm" | "reject" | "preview";
}

export async function POST(req: Request) {
  let body: IntentQueueAction;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.intentId || !body.action) {
    return NextResponse.json(
      { error: "Missing intentId or action" },
      { status: 400 },
    );
  }

  try {
    const queue = await getIntentQueue();
    switch (body.action) {
      case "confirm":
        queue.transition(body.intentId, "confirmed");
        break;
      case "reject":
        queue.transition(body.intentId, "rejected");
        break;
      case "preview":
        queue.transition(body.intentId, "previewed");
        break;
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 },
        );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
