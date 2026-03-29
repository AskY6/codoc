import { getWorkspace } from "@/workspace/api/_workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial heartbeat
      send("ping", { ts: Date.now() });

      const unsub = ws.onFieldChange((event) => {
        // Look up the current field state to include value/error
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

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          send("ping", { ts: Date.now() });
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      cleanup = () => {
        unsub();
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
