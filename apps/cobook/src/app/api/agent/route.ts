import { getClient, getModel } from "@/lib/ai";
import { PRESET_AGENTS, type AgentDef } from "@/lib/agents";
import { gatherDocContext } from "../_context";

// ---------------------------------------------------------------------------
// Agent system prompts
// ---------------------------------------------------------------------------

const WRITE_SUGGESTION_INSTRUCTIONS = `

If you have concrete values to write into codoc fields, include each one as a fenced code block with language "write-suggestion":
\`\`\`write-suggestion
{"docId": "the-doc.codoc", "field": "/fieldPath", "value": "the new value"}
\`\`\`
Only include write suggestions when you have a specific, improved value ready to write.`;

const SYSTEM_PROMPTS: Record<string, string> = {
  summary: `You are a knowledge summarization assistant inside Cobook.
Given the schema and current field values of one or more codocs, generate a clear, structured summary.
Use markdown. Be concise but thorough. Highlight key facts, relationships between codocs, and any stale/missing data.${WRITE_SUGGESTION_INSTRUCTIONS}`,
  "info-check": `You are a knowledge verification assistant inside Cobook.
Given the schema and current field values of one or more codocs, check for:
- Internal inconsistencies between fields
- Potentially outdated information
- Missing or empty fields that should have values
- Broken or suspicious cross-document references
Output a structured report in markdown.`,
  polish: `You are a text editing assistant inside Cobook.
Given the schema and current field values of one or more codocs, improve the text quality of text fields:
- Fix grammar, spelling, and punctuation
- Improve clarity and readability
- Preserve the original meaning and schema structure
For each field you improve, include a write suggestion so the user can confirm the change.${WRITE_SUGGESTION_INSTRUCTIONS}`,
};

interface WriteSuggestion {
  targetDocId: string;
  targetField: string;
  value: unknown;
  confirmed: boolean;
}

function parseWriteSuggestions(text: string): {
  cleanText: string;
  suggestions: WriteSuggestion[];
} {
  const suggestions: WriteSuggestion[] = [];
  const cleanText = text
    .replace(/```write-suggestion\n([\s\S]*?)```/g, (_, json: string) => {
      try {
        const parsed = JSON.parse(json.trim());
        suggestions.push({
          targetDocId: parsed.docId,
          targetField: parsed.field,
          value: parsed.value,
          confirmed: false,
        });
      } catch {
        /* skip malformed */
      }
      return "";
    })
    .trim();
  return { cleanText, suggestions };
}

// ---------------------------------------------------------------------------
// POST /api/agent  { agentId, docIds, extraPrompt? }
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body = (await req.json()) as {
    agentId: string;
    docIds: string[];
    extraPrompt?: string;
  };

  const { agentId, docIds, extraPrompt } = body;

  const agent: AgentDef | undefined = PRESET_AGENTS.find(
    (a) => a.id === agentId,
  );
  if (!agent) {
    return new Response(JSON.stringify({ error: "Unknown agent" }), {
      status: 400,
    });
  }
  if (docIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "No documents referenced" }),
      { status: 400 },
    );
  }

  const systemPrompt =
    SYSTEM_PROMPTS[agentId] ??
    "You are a helpful knowledge assistant inside Cobook.";

  const context = await gatherDocContext(docIds);

  const userMessage = extraPrompt
    ? `${extraPrompt}\n\n---\n\nHere are the referenced codocs:\n\n${context}`
    : `Run **${agent.name}** on the following codocs:\n\n${context}`;

  const client = getClient();

  try {
    const res = await client.messages.create({
      model: getModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    let rawText = "";
    for (const block of res.content) {
      if (block.type === "text") rawText += block.text;
    }

    const { cleanText, suggestions } = parseWriteSuggestions(rawText);

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: cleanText })}\n\n`),
        );
        for (const s of suggestions) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ write: s })}\n\n`),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(readable, {
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
