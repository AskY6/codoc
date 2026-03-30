import type { CodataField, FieldError, ForceContext, LLMClient, LoaderFn } from "@codoc/core";

const TEMPLATE_VAR_RE = /\{([\w.]+)\}/g;
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

let llmClient: LLMClient | null = null;

export function setLLMClient(client: LLMClient): void {
  llmClient = client;
}

export function getLLMClient(): LLMClient | null {
  return llmClient;
}

/**
 * Extract field names referenced in a prompt template.
 * e.g. "Summarize: {weather} and {title}" -> ["weather", "title"]
 */
export function extractTemplateVars(template: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_VAR_RE.exec(template)) !== null) {
    vars.push(match[1]);
  }
  return vars;
}

export const promptLoader: LoaderFn = async (
  field: CodataField,
  context: ForceContext
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "prompt") {
    throw new Error(`promptLoader called on non-prompt field: ${field.path}`);
  }

  if (!llmClient) {
    const error: FieldError = {
      kind: "prompt",
      message: "No LLM client configured. Call setLLMClient() before using $prompt loader.",
      retryable: false,
    };
    throw error;
  }

  const { template, model } = decl.$prompt;

  const vars = extractTemplateVars(template);
  const resolved = new Map<string, string>();
  for (const varName of vars) {
    const path = `/${varName.replace(/\./g, "/")}`;
    const value = await context.force(path);
    resolved.set(varName, String(value));
  }

  const prompt = template.replace(TEMPLATE_VAR_RE, (_, name) => {
    return resolved.get(name) ?? `{${name}}`;
  });

  try {
    return await llmClient.generate({
      model: model ?? DEFAULT_MODEL,
      prompt,
      schema: field.meta.schema ?? {},
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "kind" in err) {
      throw err;
    }
    const error: FieldError = {
      kind: "prompt",
      message: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      cause: err,
    };
    throw error;
  }
};
