import type { ComponentsBody } from "@codoc/core";
import type { ResolvedComponent } from "./bundle-resolver.js";

export interface CompileOptions {
  /** MDX source string */
  source: string;
  /** Resolved component implementations to inject into MDX scope */
  components?: Record<string, ResolvedComponent>;
  /** Resolved field data to make available as `data` in MDX scope */
  data?: Record<string, unknown>;
}

export interface CompiledView {
  /** The compiled module code */
  code: string;
  /** Component names that were injected into scope */
  scopedComponents: string[];
}

/**
 * Compile an MDX view template into executable module code.
 *
 * This function wraps @mdx-js/mdx. When the dependency is not installed,
 * it falls back to a passthrough that preserves the raw MDX source.
 */
export async function compile(options: CompileOptions): Promise<CompiledView> {
  const { source, components = {} } = options;
  const scopedComponents = Object.keys(components);

  try {
    // Dynamic import — @mdx-js/mdx is an optional dependency.
    // Use a variable to bypass TS static module resolution.
    const mdxModuleId = "@mdx-js/mdx";
    const mdxModule = await import(/* webpackIgnore: true */ mdxModuleId) as {
      compile: (source: string, options?: Record<string, unknown>) => Promise<{ toString(): string }>;
    };
    const mdxCompile = mdxModule.compile;

    const result = await mdxCompile(source, {
      outputFormat: "function-body",
      // Preserve JSX for the runtime to handle
      jsx: false,
    });

    return {
      code: String(result),
      scopedComponents,
    };
  } catch (err: unknown) {
    // If @mdx-js/mdx is not installed, return a basic compilation
    // that wraps the source in a simple component function
    if (
      err instanceof Error &&
      (err.message.includes("Cannot find module") ||
        err.message.includes("ERR_MODULE_NOT_FOUND"))
    ) {
      return {
        code: buildFallbackCode(source, scopedComponents),
        scopedComponents,
      };
    }
    throw err;
  }
}

/**
 * Fallback compilation when @mdx-js/mdx is not available.
 * Generates a simple function that returns the raw MDX source as text.
 */
function buildFallbackCode(source: string, components: string[]): string {
  const escaped = JSON.stringify(source);
  return [
    `// Fallback: @mdx-js/mdx not installed`,
    `// Scoped components: ${components.join(", ") || "none"}`,
    `export default function MDXContent(props) {`,
    `  return ${escaped};`,
    `}`,
  ].join("\n");
}
