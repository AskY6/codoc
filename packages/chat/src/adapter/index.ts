// adapter/ — translation between @cobook/core's ChatMessage ADT and
// @cobook/chat's ChatState / ChatEvent shapes.
//
// Inbound: a thread's ChatMessage[] + metadata → a fresh ChatState.
// Outbound: the stream of ChatEvents a turn produced → the
// ChatMessage[] the thread should persist.

export { buildInitialState, eventsToAssistantMessages } from "./adapter.js";
