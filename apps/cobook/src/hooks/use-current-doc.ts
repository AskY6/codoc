"use client";

import { createContext, useContext } from "react";

const CurrentDocContext = createContext<string | null>(null);

export const CurrentDocProvider = CurrentDocContext.Provider;

export function useCurrentDocId(): string {
  const docId = useContext(CurrentDocContext);
  if (!docId) throw new Error("useCurrentDocId must be used within a CurrentDocProvider");
  return docId;
}
