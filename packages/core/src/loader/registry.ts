import type { LoaderDeclaration, LoaderFn } from "../model/types.js";
import { literalLoader } from "./literal.js";
import { refLoader } from "./ref.js";

const builtinLoaders: Record<string, LoaderFn> = {
  literal: literalLoader,
  ref: refLoader,
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
