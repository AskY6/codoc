import type {
  ContextData,
  ContextRequirement,
  ContextSource,
  ContextSourceFactory,
  ResourceRef,
} from "./types.js";

/**
 * Assemble context for an agent based on its requirements.
 *
 * 1. Match each requirement against registered sources and factories
 * 2. Resolve matched sources (async)
 * 3. Trim optional sources if total tokens exceed budget
 *
 * Returns resolved ContextData[] ordered: required first, then optional.
 */
export async function assembleContext(
  requirements: ContextRequirement[],
  sources: ContextSource[],
  factories: ContextSourceFactory[],
  activeResourceRefs: ResourceRef[],
  totalTokenBudget?: number,
): Promise<ContextData[]> {
  const required: Array<{ req: ContextRequirement; source: ContextSource }> =
    [];
  const optional: Array<{ req: ContextRequirement; source: ContextSource }> =
    [];

  for (const req of requirements) {
    const matched = findSources(req.sourceKind, sources, factories, activeResourceRefs);
    const bucket = req.priority === "required" ? required : optional;
    for (const src of matched) {
      bucket.push({ req, source: src });
    }
  }

  // Resolve all sources in parallel
  const resolvedRequired = await resolveAll(required);
  const resolvedOptional = await resolveAll(optional);

  // Apply per-requirement token limits
  for (const item of [...resolvedRequired, ...resolvedOptional]) {
    if (item.req.maxTokens !== undefined && item.data.tokens !== undefined) {
      if (item.data.tokens > item.req.maxTokens) {
        item.data = trimToTokens(item.data, item.req.maxTokens);
      }
    }
  }

  // If total budget specified, trim optional sources
  if (totalTokenBudget !== undefined) {
    const requiredTokens = sumTokens(resolvedRequired.map((r) => r.data));
    let remainingBudget = totalTokenBudget - requiredTokens;

    const keptOptional: ContextData[] = [];
    for (const item of resolvedOptional) {
      const tokens = item.data.tokens ?? 0;
      if (tokens <= remainingBudget) {
        keptOptional.push(item.data);
        remainingBudget -= tokens;
      }
      // skip optional sources that don't fit
    }

    return [
      ...resolvedRequired.map((r) => r.data),
      ...keptOptional,
    ];
  }

  return [
    ...resolvedRequired.map((r) => r.data),
    ...resolvedOptional.map((r) => r.data),
  ];
}

function findSources(
  sourceKind: string,
  sources: ContextSource[],
  factories: ContextSourceFactory[],
  resourceRefs: ResourceRef[],
): ContextSource[] {
  const result: ContextSource[] = [];

  // Direct source match
  for (const src of sources) {
    if (src.kind === sourceKind) {
      result.push(src);
    }
  }

  // Factory match: create sources from active resource refs
  for (const factory of factories) {
    if (factory.kind === sourceKind) {
      for (const ref of resourceRefs) {
        result.push(factory.create(ref));
      }
    }
  }

  return result;
}

interface ResolvedItem {
  req: ContextRequirement;
  data: ContextData;
}

async function resolveAll(
  items: Array<{ req: ContextRequirement; source: ContextSource }>,
): Promise<ResolvedItem[]> {
  const results = await Promise.all(
    items.map(async ({ req, source }) => ({
      req,
      data: await source.resolve(),
    })),
  );
  return results;
}

function sumTokens(data: ContextData[]): number {
  return data.reduce((sum, d) => sum + (d.tokens ?? 0), 0);
}

function trimToTokens(data: ContextData, maxTokens: number): ContextData {
  // Simple proportional truncation based on token estimate.
  // Real implementation might use a tokenizer; this is a reasonable approximation.
  if (!data.tokens || data.tokens <= maxTokens) return data;
  const ratio = maxTokens / data.tokens;
  const trimmedLength = Math.floor(data.content.length * ratio);
  return {
    kind: data.kind,
    content: data.content.slice(0, trimmedLength),
    tokens: maxTokens,
  };
}
