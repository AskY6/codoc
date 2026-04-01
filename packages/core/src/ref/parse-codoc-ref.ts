import type { CodocRef } from "./types.js";

export function parseCodocRef(raw: string): CodocRef {
  const [targetPart = "", pointerPart = ""] = raw.split("#", 2);
  const codocPath = targetPart.length > 0 ? targetPart : null;
  const pointer = normalizePointer(pointerPart);

  return {
    raw,
    codocPath,
    pointer
  };
}

function normalizePointer(pointer: string): string {
  if (pointer.length === 0) {
    return "/";
  }

  return pointer.startsWith("/") ? pointer : `/${pointer}`;
}
