import type { ChatEvent } from "@cobook/service";

export async function collectChatTranscript(
  events: AsyncIterable<ChatEvent>
): Promise<string[]> {
  const lines: string[] = [];

  for await (const event of events) {
    switch (event.kind) {
      case "status":
        lines.push(`[status] ${event.status}${event.message ? ` ${event.message}` : ""}`);
        break;
      case "message":
        lines.push(event.content);
        break;
      case "artifact":
        lines.push(`[artifact] ${event.filePath}`);
        break;
    }
  }

  return lines;
}
