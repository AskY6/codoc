import { Conversation } from "./Conversation.js";
import { SessionHeader } from "./SessionHeader.js";
import { registerScopedComponents } from "../../index.js";

registerScopedComponents("claude-code", { Conversation, SessionHeader });
