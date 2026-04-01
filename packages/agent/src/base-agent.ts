import type { ChatEvent, ChatInput, CobookService } from "@cobook/service";

export interface BaseAgent {
  run(input: ChatInput, service: CobookService): AsyncIterable<ChatEvent>;
}

export class StubBaseAgent implements BaseAgent {
  async *run(_input: ChatInput, _service: CobookService): AsyncIterable<ChatEvent> {
    yield {
      kind: "status",
      status: "thinking",
      message: "Base agent is not implemented yet."
    };
    yield {
      kind: "message",
      content: "Base agent will be added after the runtime and workspace loader exist."
    };
    yield {
      kind: "status",
      status: "done"
    };
  }
}
