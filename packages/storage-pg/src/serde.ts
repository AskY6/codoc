import type {
  AgentId,
  AssistantMetadata,
  ChatMessage,
  CodocAST,
  CodocMeta,
  DataField,
  FieldName,
  FieldSchema,
  MessageId,
  ThreadId,
  View,
} from "@cobook/core";

// ---------------------------------------------------------------------------
// CodocAST ↔ jsonb
// ---------------------------------------------------------------------------

type SerializedMeta = {
  title: string | null;
  description: string | null;
  tags: readonly string[];
  schema: Record<string, FieldSchema>;
};

type SerializedAST = {
  meta: SerializedMeta;
  data: Record<string, DataField>;
  view: View;
};

export function serializeAst(ast: CodocAST): unknown {
  const out: SerializedAST = {
    meta: {
      title: ast.meta.title,
      description: ast.meta.description,
      tags: ast.meta.tags,
      schema: Object.fromEntries(ast.meta.schema),
    },
    data: Object.fromEntries(ast.data),
    view: ast.view,
  };
  return out;
}

export function deserializeAst(raw: unknown): CodocAST {
  const s = raw as SerializedAST;
  const meta: CodocMeta = {
    title: s.meta.title,
    description: s.meta.description,
    tags: s.meta.tags,
    schema: new Map(
      Object.entries(s.meta.schema).map(([k, v]) => [k as FieldName, v]),
    ),
  };
  return {
    meta,
    data: new Map(
      Object.entries(s.data).map(([k, v]) => [k as FieldName, v]),
    ),
    view: s.view,
  };
}

// ---------------------------------------------------------------------------
// ChatMessage ↔ flat columns
// ---------------------------------------------------------------------------

export interface MessageColumns {
  id: string;
  threadId: string;
  kind: string;
  content: string;
  agentId: string | null;
  metadata: unknown;
}

export function serializeMessage(msg: ChatMessage): MessageColumns {
  const base = {
    id: msg.id as string,
    threadId: msg.threadId as string,
    kind: msg.kind,
    content: msg.content,
    agentId: null as string | null,
    metadata: null as unknown,
  };
  if (msg.kind === "assistant") {
    base.agentId = msg.agentId as string;
    base.metadata = msg.metadata;
  }
  return base;
}

export function deserializeMessage(cols: MessageColumns): ChatMessage {
  const id = cols.id as MessageId;
  const threadId = cols.threadId as ThreadId;

  switch (cols.kind) {
    case "user":
      return { kind: "user", id, threadId, content: cols.content };
    case "assistant":
      return {
        kind: "assistant",
        id,
        threadId,
        content: cols.content,
        agentId: cols.agentId! as AgentId,
        metadata: cols.metadata as AssistantMetadata,
      };
    case "system":
      return { kind: "system", id, threadId, content: cols.content };
    default:
      throw new Error(`Unknown message kind: ${cols.kind}`);
  }
}
