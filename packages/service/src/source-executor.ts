export interface StaticSource {
  type: "static";
  value: unknown;
}

export type Source = StaticSource;

/**
 * Execute a data source and return its resolved value.
 */
export async function executeSource(source: Source): Promise<unknown> {
  switch (source.type) {
    case "static":
      return source.value;
  }
}
