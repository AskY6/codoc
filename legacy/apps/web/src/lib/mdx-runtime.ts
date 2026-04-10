import { compile, run } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import type { ComponentType } from "react";

export interface CompileResult {
  /** The compiled JS function body string. */
  code: string;
  /** Exports extracted from the MDX module (excluding default). */
  exports: Record<string, unknown>;
  /** The React component to render. */
  Content: ComponentType<{ components?: Record<string, ComponentType<any>> }>;
}

/**
 * Compile and evaluate an MDX source string in the browser.
 *
 * `data` is injected as a module-level `const data = ...` so that
 * MDX `export` statements and JSX expressions can reference `data.xxx`.
 */
export async function compileMdx(
  source: string,
  data: Record<string, unknown>,
): Promise<CompileResult> {
  // Inject resolved data as a module-level constant.
  // Double-stringify so the JS code contains a JSON.parse("...") call.
  const dataDecl = `export const data = JSON.parse(${JSON.stringify(JSON.stringify(data))})\n\n`;
  const fullSource = dataDecl + source;

  const compiled = await compile(fullSource, {
    outputFormat: "function-body",
    development: false,
  });

  const code = String(compiled);

  const mod = await run(code, {
    ...runtime,
    baseUrl: import.meta.url,
  });

  const { default: Content, ...exports } = mod;

  return {
    code,
    exports: exports as Record<string, unknown>,
    Content: Content as CompileResult["Content"],
  };
}
