 apps/cobook/src/                                                                                                                                                                                                                                      
  ├── agents/                                                                                                                              
  │   ├── index.ts                     # Barrel exports
  │   ├── register.ts                  # initAgentSystem() — single entry point, wires Router→SceneAgent→Queue
  │   ├── codoc-structure-agent.ts     # SceneAgent: codoc CRUD (create/rewrite/write-field/force-field)
  │   ├── claude-log-agent.ts          # SceneAgent: Claude Code log ingest + analysis
  │   └── utils.ts                     # parseIntentBlocks, stripIntentBlocks, formatContextForPrompt
  │
  ├── scene-agents/                    # Scene agent infrastructure (registry + routing)
  │   ├── index.ts                     # Barrel exports
  │   ├── types.ts                     # SceneAgent, IntentProposal (with structured payload), SceneAgentResult
  │   ├── registry.ts                  # SceneAgentRegistry — register/activate/deactivate/trust
  │   └── router.ts                    # NLRouter — keyword fast path + LLM fallback
  │
  ├── intent-queue/                    # Intent lifecycle (queue → execute)
  │   ├── index.ts                     # Barrel exports
  │   ├── types.ts                     # IntentRecord, IntentStatus, EnqueueParams
  │   ├── queue.ts                     # IntentQueue — enqueue, transition, merge, rate-limit
  │   ├── executor.ts                  # ★ Single canonical intent executor (replaces 3 duplicates)
  │   └── consumer.ts                  # IntentQueueConsumer — watches queue, calls executor
  │
  ├── codoc-use/                       # Chat↔Workspace bridge (context sources + events)
  │   ├── index.ts                     # initCodocUse() — registers context sources + event bridges
  │   ├── types.ts                     # CodocIntentKind, payload type definitions
  │   ├── context.ts                   # createCodocContextSource, createConnectorContextSource
  │   ├── events.ts                    # bridgeWorkspaceEvents, bridgeConnectorAuthErrors
  │   └── resource.ts                  # listCodocResources
  │
  ├── chat/                            # Domain-agnostic chat ability (clean, no codoc knowledge)
  │   ├── index.ts                     # createChatAbility(), ChatAbility interface
  │   ├── types.ts                     # Participant, Message, Intent, AgentHandler, ResponseMode...
  │   ├── bus.ts                       # HandlerRegistry — agent handler storage
  │   ├── session.ts                   # MessageTree, SessionData, buildMessage
  │   ├── context.ts                   # assembleContext() — matches requirements to sources
  │   └── events.ts                    # SessionEventEmitter
  │
  ├── shared/                          # Utilities shared across all modules
  │   ├── ai.ts                        # getClient(), getModel() — Anthropic API singleton
  │   ├── types.ts                     # HTTP contract types (FieldSnapshot, DocSnapshot, etc.)
  │   ├── utils.ts                     # cn() utility
  │   └── ui/                          # shadcn/ui primitives
  │       ├── avatar.tsx
  │       ├── badge.tsx
  │       ├── button.tsx
  │       ├── input.tsx
  │       ├── scroll-area.tsx
  │       ├── separator.tsx
  │       └── tooltip.tsx
  │
  ├── workspace/                       # UI layer + server init
  │   ├── server/
  │   │   ├── workspace.ts             # getWorkspace() singleton
  │   │   ├── chat.ts                  # getChatAbility(), getIntentQueue(), getAgentSystem()
  │   │   ├── register-connectors.ts   # registerAllConnectors()
  │   │   ├── connector-catalog.ts     # ConnectorCatalog — connector activation/status
  │   │   └── credentials.ts           # Credential loading/persistence
  │   ├── stores/
  │   │   ├── workspace-store.ts       # Client-side workspace state (docs, fields, graph)
  │   │   ├── intent-queue-store.ts    # Client-side intent queue state
  │   │   └── api-client.ts            # HTTP API calls (fetch*, create*, update*)
  │   ├── hooks/
  │   │   ├── use-workspace.ts         # useWorkspaceInit (SSE), useWorkspaceDocs, useWorkspaceGraph
  │   │   ├── use-intent-queue.ts      # useIntentRecords, confirmIntent, activateSceneAgent...
  │   │   ├── use-session.ts           # useChatMessages, useChatParticipants, useTypingAgents
  │   │   └── use-field-snapshot.ts    # useFieldSnapshot
  │   └── components/
  │       ├── WorkspaceShell.tsx        # Main shell layout
  │       ├── AgentsPanel.tsx           # Scene agent controls (activate/deactivate/trust)
  │       ├── IntentQueuePanel.tsx      # Pending intent review (confirm/reject)
  │       ├── DagGraphView.tsx          # Dependency graph visualization
  │       ├── chat/
  │       │   ├── ChatArea.tsx          # Chat message list
  │       │   ├── ChatInput.tsx         # Chat input box
  │       │   ├── MessageRow.tsx        # Single message rendering
  │       │   ├── IntentCard.tsx        # Inline intent card (confirm/reject)
  │       │   ├── CodocCard.tsx         # Inline codoc reference card
  │       │   └── ContextBar.tsx        # Active context display
  │       └── codoc/
  │           ├── CodocList.tsx         # Document list sidebar
  │           ├── CodataValue.tsx       # Field value renderer
  │           ├── ConnectorHealth.tsx   # Connector status display
  │           ├── SessionDetail.tsx     # Claude Code session detail view
  │           └── mdx-components.tsx    # MDX component registry for codoc views
  │
  └── app/                             # Next.js app router
      ├── layout.tsx                   # Root layout
      ├── page.tsx                     # Home page
      └── api/
          ├── workspace/route.ts       # GET workspace snapshot
          ├── docs/route.ts            # POST create doc
          ├── docs/[docId]/route.ts    # GET doc detail
          ├── docs/[docId]/field/route.ts   # POST write field
          ├── docs/[docId]/force/route.ts   # POST force-refresh field
          ├── chat/route.ts            # GET/POST chat messages
          ├── chat/intent/route.ts     # POST confirm/reject intent
          ├── chat/reference/route.ts  # POST add/remove resource ref
          ├── events/route.ts          # GET SSE event stream
          ├── discover/route.ts        # GET scan for Claude Code projects
          ├── ingest/route.ts          # POST ingest directory via skill name
          ├── intent-queue/route.ts    # ★ NEW: POST confirm/reject/preview queue intents
          ├── scene-agents/route.ts    # ★ NEW: POST activate/deactivate/trust scene agents
          ├── connectors/route.ts      # GET/POST connector statuses
          └── components/              # Component library API
              ├── route.ts             # GET list / POST register
              ├── [name]/route.ts      # GET component detail
              └── [name]/compat/route.ts  # GET compat check