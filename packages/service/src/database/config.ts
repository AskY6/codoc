const DEFAULT_POSTGRES_URL = "postgresql://postgres:postgres@127.0.0.1:55432/cobook_dev";

export interface ResolvePostgresConnectionStringOptions {
  connectionString?: string | undefined;
}

export function resolvePostgresConnectionString(
  options: ResolvePostgresConnectionStringOptions = {}
): string {
  const explicit = options.connectionString?.trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.COBOOK_DATABASE_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return DEFAULT_POSTGRES_URL;
}

export function getDefaultPostgresConnectionString(): string {
  return DEFAULT_POSTGRES_URL;
}
