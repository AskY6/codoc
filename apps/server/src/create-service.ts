import { RuleBasedBaseAgent } from "@cobook/agent";
import { LocalCobookService } from "@cobook/service";

export function createAppService(): LocalCobookService {
  const agent = new RuleBasedBaseAgent();

  return new LocalCobookService({
    chatHandler: (input, boundService) => agent.run(input, boundService)
  });
}
