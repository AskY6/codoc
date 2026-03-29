import type { ChatAbility } from "../chat/index.js";
import { codocAgentParticipant, createCodocAgentHandler } from "./codoc-agent.js";
import {
  summaryAgentParticipant,
  createSummaryAgentHandler,
} from "./summary-agent.js";
import {
  infoCheckAgentParticipant,
  createInfoCheckAgentHandler,
} from "./info-check-agent.js";
import {
  polishAgentParticipant,
  createPolishAgentHandler,
} from "./polish-agent.js";

export const presetAgents = [
  codocAgentParticipant,
  summaryAgentParticipant,
  infoCheckAgentParticipant,
  polishAgentParticipant,
];

export function registerPresetAgents(
  chat: ChatAbility,
  sessionId: string,
): void {
  for (const agent of presetAgents) {
    chat.registerParticipant(sessionId, agent);
  }
}

export function registerPresetAgentHandlers(
  chat: ChatAbility,
  sessionId: string,
): void {
  chat.registerAgentHandler(sessionId, "codoc-agent", createCodocAgentHandler());
  chat.registerAgentHandler(sessionId, "summary-agent", createSummaryAgentHandler());
  chat.registerAgentHandler(sessionId, "info-check-agent", createInfoCheckAgentHandler());
  chat.registerAgentHandler(sessionId, "polish-agent", createPolishAgentHandler());
}
