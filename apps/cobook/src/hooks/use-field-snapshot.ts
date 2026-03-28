"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getStore } from "./use-workspace";
import type { FieldSnapshot } from "@/lib/types";

const EMPTY: FieldSnapshot = { status: "idle", loaderType: "unknown" };

export function useFieldSnapshot(docId: string, path: string): FieldSnapshot {
  const store = getStore();

  const subscribe = useCallback(
    (cb: () => void) => store.subscribeField(docId, path, cb),
    [store, docId, path],
  );

  const getSnapshot = useCallback(
    () => store.getFieldSnapshot(docId, path) ?? EMPTY,
    [store, docId, path],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
