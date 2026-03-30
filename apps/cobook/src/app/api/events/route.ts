import { getWorkspace } from "@/workspace/server/workspace";
import { onChatMessage, onIntentStatusChange, onTypingChange, getChatAbility } from "@/workspace/server/chat";
import { getConnectorCatalog } from "@/workspace/server/connector-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();
  // Ensure chat is initialized so we can subscribe to events
  await getChatAbility();

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      // Send initial heartbeat
      send("ping", { ts: Date.now() });

      // Field change events
      const unsubField = ws.onFieldChange((event) => {
        try {
          const { tree } = ws.loadDoc(event.docId);
          const field = tree.getField(event.fieldPath);
          const payload: Record<string, unknown> = {
            docId: event.docId,
            path: event.fieldPath,
            status: field?.state.status ?? "idle",
            ts: event.timestamp,
          };
          if (field?.state.status === "resolved") {
            payload.value = field.state.value;
          }
          if (field?.state.status === "error") {
            payload.error = field.state.error.message;
          }
          send("field", payload);
        } catch {
          // Doc not loaded yet, skip
        }
      });

      // Chat message events
      const unsubChat = onChatMessage((msg) => {
        send("chat-message", msg);
      });

      // Intent status change events
      const unsubIntent = onIntentStatusChange((msgId, intentIdx, status) => {
        send("chat-intent", { msgId, intentIdx, status });
      });

      // Typing indicator events
      const unsubTyping = onTypingChange((agentId, isTyping) => {
        send("chat-typing", { agentId, isTyping });
      });

      // Connector activation/deactivation events
      const unsubConnectors = getConnectorCatalog().onChange(() => {
        send("connector-status", getConnectorCatalog().getStatuses());
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          send("ping", { ts: Date.now() });
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      cleanup = () => {
        unsubField();
        unsubChat();
        unsubIntent();
        unsubTyping();
        unsubConnectors();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
