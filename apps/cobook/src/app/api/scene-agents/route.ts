import { NextResponse } from "next/server";
import { getAgentSystem } from "@/workspace/server/chat";

interface SceneAgentAction {
  agentId: string;
  action: "activate" | "deactivate" | "set-trust";
  trusted?: boolean;
}

export async function POST(req: Request) {
  let body: SceneAgentAction;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agentId || !body.action) {
    return NextResponse.json(
      { error: "Missing agentId or action" },
      { status: 400 },
    );
  }

  try {
    const { sceneRegistry } = await getAgentSystem();
    switch (body.action) {
      case "activate":
        sceneRegistry.activate(body.agentId);
        break;
      case "deactivate":
        sceneRegistry.deactivate(body.agentId);
        break;
      case "set-trust":
        sceneRegistry.setTrusted(body.agentId, body.trusted ?? false);
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
