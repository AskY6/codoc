import { readdir } from "node:fs/promises";
import type { CodocFile } from "@codoc/core";
import type { Skill } from "./types.js";

/**
 * Claude Code Log skill.
 *
 * Identifies directories containing Claude Code session JSONL files
 * and maps each session file to a codoc with:
 * - meta.data: JSON Schema for session messages
 * - data: $source pointing to the local-file connector with jsonl parser
 * - view: MDX template for rendering a conversation timeline
 */
export const claudeCodeLogSkill: Skill = {
  name: "claude-code-log",
  extension: ".jsonl",

  async identify(dirPath: string): Promise<boolean> {
    try {
      const entries = await readdir(dirPath);
      // Claude Code project directories contain .jsonl session files
      return entries.some((e) => e.endsWith(".jsonl"));
    } catch {
      return false;
    }
  },

  mapToCodoc(filePath: string, fileName: string): CodocFile {
    const sessionId = fileName.replace(/\.jsonl$/, "");

    return {
      type: sessionLogSchema,
      meta: {
        data: sessionLogSchema,
      },
      data: {
        messages: {
          $source: {
            connector: "local-file",
            path: filePath,
            parser: "jsonl",
          },
        },
      },
      view: buildViewTemplate(sessionId),
    };
  },
};

/**
 * JSON Schema describing a Claude Code session log.
 * Each entry is a JSONL line with varying types.
 */
const sessionLogSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      description: "Claude Code session messages (JSONL entries)",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Message type: user, assistant, system, progress, file-history-snapshot",
          },
          uuid: { type: "string" },
          parentUuid: { type: ["string", "null"] },
          timestamp: { type: "string" },
          sessionId: { type: "string" },
          message: {
            type: "object",
            description: "Message payload (role + content)",
            properties: {
              role: { type: "string" },
              content: {},
            },
          },
        },
      },
    },
  },
  required: ["messages"],
};

function buildViewTemplate(sessionId: string): string {
  return `# Session: ${sessionId}

<CodataValue path="/messages" />
`;
}
