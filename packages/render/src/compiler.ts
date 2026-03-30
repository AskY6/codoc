// MDX compilation module.
// Wraps @mdx-js/mdx to compile .codoc view templates into executable modules.
// Dependencies (@mdx-js/mdx, react) will be added when this is implemented.

export interface CompileOptions {
  /** MDX source string */
  source: string;
}

export interface CompiledView {
  /** The compiled module code */
  code: string;
}

export async function compile(_options: CompileOptions): Promise<CompiledView> {
  throw new Error("@codoc/render compiler not yet implemented — add @mdx-js/mdx dependency first");
}
