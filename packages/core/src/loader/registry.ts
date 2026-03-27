import type { LoaderDeclaration, LoaderFn } from "../types.js";
import { literalLoader } from "./literal.js";
import { refLoader } from "./ref.js";
import { sourceLoader } from "./source.js";
import { promptLoader } from "./prompt.js";
import { externalLoader } from "./external.js";

const builtinLoaders: Record<string, LoaderFn> = {
  literal: literalLoader,
  ref: refLoader,
  source: sourceLoader,
  prompt: promptLoader,
  external: externalLoader,
};

const customLoaders = new Map<string, LoaderFn>();

export function getLoader(declaration: LoaderDeclaration): LoaderFn {
  const loader =
    customLoaders.get(declaration.type) ?? builtinLoaders[declaration.type];
  if (!loader) {
    throw new Error(`No loader registered for type: ${declaration.type}`);
  }
  return loader;
}

export function registerLoader(type: string, loader: LoaderFn): void {
  customLoaders.set(type, loader);
}
