// LLM configuration port.
//
// Consumed by the `runAgentTurn` use case to construct an LLM
// client. The composition root (apps/server) reads these from
// environment variables; the test helper uses an empty config
// (tests supply a mock LlmClient directly).

export interface LlmConfig {
  readonly apiKey?: string | undefined;
  readonly baseURL?: string | undefined;
  readonly routerModel?: string | undefined;
  readonly defaultModel?: string | undefined;
}
