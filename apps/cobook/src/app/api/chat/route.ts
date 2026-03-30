import { NextResponse } from "next/server";
import { getChatAbility, getSessionId } from "@/workspace/server/chat";
import { listCodocResources } from "@/codoc-use/index";
import { getWorkspace } from "@/workspace/server/workspace";

interface ChatRequest {
  content: string;
  mentionedParticipants?: string[];
  resourceRefs?: Array<{ kind: string; id: string; label?: string }>;
}

export async function POST(req: Request) {
  const body: ChatRequest = await req.json();
  const chat = await getChatAbility();
  const sessionId = await getSessionId();

  const msg = chat.sendMessage(sessionId, {
    sender: { id: "user", kind: "human" },
    content: body.content,
    mentionedParticipants: body.mentionedParticipants,
    resourceRefs: body.resourceRefs,
  });

  return NextResponse.json(msg);
}

export async function GET() {
  const chat = await getChatAbility();
  const sessionId = await getSessionId();

  const messages = chat.getMessages(sessionId);
  const participants = chat.getParticipants(sessionId);

  const workspace = await getWorkspace();
  const resources = listCodocResources(workspace);

  return NextResponse.json({ messages, participants, resources });
}
