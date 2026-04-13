// http-json source provider.
//
// Fetches a URL and returns the parsed JSON body. Params:
//   url  — required, the HTTP(S) endpoint to GET
//   path — optional dot-separated key path to extract a nested value
//          (e.g. "data.items" extracts `response.data.items`)

import type { SourceProvider } from "../ports/source.js";

export const httpJsonProvider: SourceProvider = {
  name: "http-json",

  async execute(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const url = params["url"];
    if (typeof url !== "string" || !url) {
      throw new Error('http-json: "url" param is required and must be a string');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`http-json: ${response.status} ${response.statusText} from ${url}`);
    }

    const json: unknown = await response.json();

    const path = params["path"];
    if (typeof path === "string" && path) {
      return extractPath(json, path);
    }

    return json;
  },
};

function extractPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
