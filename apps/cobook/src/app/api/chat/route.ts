import { getClient, getModel } from "@/lib/ai";
import { gatherDocContext } from "../_context";

export async function POST(req: Request) {
  const { messages, system, references } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    system?: string;
    references?: string[];
  };

  const client = getClient();

  let systemPrompt =
    system ?? "You are a helpful knowledge assistant inside Cobook.";

  if (references && references.length > 0) {
    const context = await gatherDocContext(references);
    systemPrompt += `\n\nThe user has referenced the following codocs. Use their schema and field values to inform your responses:\n\n${context}`;
  }

  try {
    const res = await client.messages.create({
      model: getModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    let text = "";
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
