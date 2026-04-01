# Cobook Phase 1: CLI-First MVP

> Roadmap Phase 1 detailed plan  
> CLI-first, but server-shaped

## 1. Goal

The MVP should validate one core loop:

1. Load a workspace
2. Parse `.codoc` files
3. Build a field-level DAG
4. Resolve data across codocs
5. Let AI read/write codocs through a single service boundary

The CLI is the only UI for now.
That does **not** mean the CLI owns runtime, filesystem, DAG, or LLM logic.

## 2. Hard Rules

### Rule 1: `apps/cli` is presentation only

`apps/cli` may do:

- argument parsing
- interactive terminal UI
- output formatting
- streaming display

`apps/cli` may **not** do:

- direct `fs` reads/writes for workspace data
- direct `DagEngine` access
- direct `$source` resolution
- direct LLM calls

### Rule 2: core packages stay pure

`packages/core` should be deterministic and side-effect-light.
It owns parsing, IDs, refs, graph semantics, validation, and runtime state transitions.

### Rule 3: side effects are centralized

Workspace IO, watch, source execution, and LLM access should be owned by a service/runtime layer.

### Rule 4: local-first, transport-agnostic

The first implementation can run in-process, but the interface should already look like a future server API.

## 3. Proposed Layout

```text
cobook/
├── apps/
│   └── cli/
│       └── src/
│           ├── commands/
│           ├── tui/
│           ├── format/
│           └── index.ts
│
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── parser/
│   │       ├── schema/
│   │       ├── ref/
│   │       ├── ids/
│   │       ├── dag/
│   │       ├── runtime/
│   │       ├── source-spec/
│   │       └── index.ts
│   │
│   ├── workspace/
│   │   └── src/
│   │       ├── config/
│   │       ├── scanner/
│   │       ├── loader/
│   │       ├── watcher/
│   │       └── index.ts
│   │
│   ├── service/
│   │   └── src/
│   │       ├── cobook-service.ts
│   │       ├── local-cobook-service.ts
│   │       ├── workspace-session.ts
│   │       ├── source-executor/
│   │       ├── ai/
│   │       └── index.ts
│   │
│   └── agent/
│       └── src/
│           ├── base-agent.ts
│           ├── prompts/
│           └── index.ts
│
├── examples/
│   └── hello-cobook/
└── design.md
```

## 4. Dependency Direction

```text
apps/cli
  -> packages/service
  -> packages/agent

packages/service
  -> packages/workspace
  -> packages/core

packages/agent
  -> packages/service

packages/workspace
  -> packages/core

packages/core
  -> no app-level dependency
```

Important consequence:

- `cli` never imports `core` directly
- `agent` never edits files directly
- `agent` asks `service`
- `service` owns workspace mutations and runtime orchestration

## 5. Core Types

### 5.1 Parsed codoc

```ts
export interface ParsedCodoc {
  version: string;
  id: string;
  filePath: string;
  meta?: CodocMeta;
  data?: Record<string, DataSpec>;
  component?: Record<string, ComponentSpec>;
  view?: ViewSpec;
}
```

### 5.2 Source specs

```ts
export type DataSpec =
  | StaticSourceSpec
  | FileSourceSpec
  | CodocSourceSpec
  | ObjectShapeSpec;

export interface StaticSourceSpec {
  kind: "static";
  value: unknown;
}

export interface FileSourceSpec {
  kind: "file";
  path: string;
  format: "text" | "json" | "yaml";
}

export interface CodocSourceSpec {
  kind: "codoc";
  ref: CodocRef;
  defaultValue?: unknown;
}

export interface ObjectShapeSpec {
  kind: "object";
  fields: Record<string, DataSpec>;
}
```

### 5.3 Node identity

```ts
export type NodeKind = "data" | "view" | "codoc";

export interface NodeId {
  codocId: string;
  section: NodeKind;
  path: string[];
}
```

String form:

```ts
// dashboard:data/currentUser/name
export type NodeKey = string;
```

### 5.4 DAG engine

```ts
export interface DagEngine {
  build(codocs: ParsedCodoc[]): BuildResult;
  rebuildCodoc(codoc: ParsedCodoc): BuildResult;
  getNode(node: NodeKey): DagNode | null;
  getDeps(node: NodeKey): NodeKey[];
  getDependents(node: NodeKey): NodeKey[];
  resolve(node: NodeKey, opts?: ResolveOptions): Promise<ResolvedValue>;
  invalidate(node: NodeKey): InvalidationResult;
}
```

### 5.5 Runtime state

```ts
export interface NodeState {
  status: "idle" | "computing" | "ready" | "error" | "dirty";
  version: number;
  value: unknown;
  error: Error | null;
}

export interface ResolveOptions {
  force?: boolean;
  signal?: AbortSignal;
}
```

## 6. Service Boundary

This is the most important interface in the MVP.

```ts
export interface CobookService {
  openWorkspace(root: string): Promise<WorkspaceSnapshot>;
  getWorkspace(): Promise<WorkspaceSnapshot>;

  build(): Promise<BuildResult>;
  rebuildCodoc(codocId: string): Promise<BuildResult>;

  listCodocs(): Promise<CodocSummary[]>;
  readCodoc(codocId: string): Promise<ParsedCodoc>;
  writeCodoc(input: WriteCodocInput): Promise<WriteCodocResult>;

  resolve(node: NodeKey, opts?: ResolveOptions): Promise<ResolvedValue>;
  graph(): Promise<GraphSnapshot>;

  chat(input: ChatInput): AsyncIterable<ChatEvent>;
}
```

For MVP, implement:

```ts
export class LocalCobookService implements CobookService {}
```

Later, add:

```ts
export class RpcCobookService implements CobookService {}
```

The CLI should be able to swap these with minimal changes.

## 7. Workspace Session

The service should manage a workspace through a long-lived session object.

```ts
export interface WorkspaceSession {
  root: string;
  config: CobookConfig;
  codocs: Map<string, ParsedCodoc>;
  dag: DagEngine;
  runtime: RuntimeContext;
}
```

This is where we keep loaded codocs, graph state, and future watch subscriptions.

## 8. AI Placement

For MVP, there is only one agent: `base-agent`.

The base agent should not call `fs` directly.
It should only call `CobookService`.

```ts
export interface BaseAgent {
  run(input: AgentInput, service: CobookService): AsyncIterable<AgentEvent>;
}
```

Typical allowed actions:

- inspect workspace summary
- read a codoc
- resolve a node
- create a codoc
- update a codoc

This keeps AI behavior aligned with the same boundary the CLI uses.

## 9. Request Flows

### 9.1 CLI command flow

```text
CLI command
  -> CobookService
  -> WorkspaceSession
  -> core/workspace modules
  -> formatted result back to CLI
```

Example:

```text
cobook resolve dashboard:data/currentUser
  -> service.resolve(...)
  -> dag.resolve(...)
  -> source executor resolves upstream nodes
  -> CLI prints result
```

### 9.2 AI flow

```text
CLI chat
  -> base-agent
  -> CobookService
  -> workspace/dag/runtime
  -> codoc mutation
  -> rebuild
  -> stream result back
```

Example:

```text
"Turn this discussion into a note codoc"
  -> agent inspects current workspace
  -> agent reads pinned codocs
  -> agent proposes codoc content
  -> service.writeCodoc(...)
  -> service.rebuildCodoc(...)
  -> CLI shows created artifact
```

## 10. MVP Command Set

The CLI only needs a few commands at first:

- `cobook validate`
- `cobook list`
- `cobook graph`
- `cobook resolve <node>`
- `cobook chat`

These are enough to prove the runtime and AI loop.

## 11. First Implementation Slice

Build in this order:

1. `packages/core`
   - parser
   - ids
   - ref normalization
   - minimal dag
   - resolve state machine

2. `packages/workspace`
   - read `cobook.yaml`
   - scan `.codoc`
   - load parsed codocs

3. `packages/service`
   - `LocalCobookService`
   - workspace session
   - source execution for `static`, `file`, `codoc`

4. `apps/cli`
   - `list`
   - `validate`
   - `resolve`

5. `packages/agent`
   - minimal `base-agent`
   - read/write codoc through service only

## 12. Non-Goals for MVP

Do not build these yet:

- web app
- websocket transport
- multi-agent routing
- RSS agent
- remote components
- full MDX runtime
- source plugin marketplace
- live watch-driven push recomputation

## 13. Review Checklist

Before we start coding, these questions should have exactly one answer each:

- Is `service` the only mutation boundary?
- Can CLI work without importing `core` directly?
- Can a future web client use the same `CobookService` contract?
- Can the base agent do everything it needs through service calls?
- Are source side effects outside `packages/core`?

If the answer to any of these becomes "no", the architecture is drifting.
