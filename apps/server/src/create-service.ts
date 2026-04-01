import { RouterAgent, RssSceneAgent, RuleBasedBaseAgent } from "@cobook/agent";
import { LocalCobookService, PostgresCodocStore, createPostgresRepositories } from "@cobook/service";

export function createAppService(): LocalCobookService {
  const agent = new RouterAgent(new RuleBasedBaseAgent(), [new RssSceneAgent()]);
  const repositories = createPostgresRepositories();

  return new LocalCobookService({
    chatHandler: (input, boundService) => agent.run(input, boundService),
    codocStore: new PostgresCodocStore(),
    repositories
  });
}
