import { createContext, useContext } from "react";
import type { ViewAction } from "@/types.js";

interface CodocActionsContextValue {
  onAction: ((action: ViewAction) => void) | undefined;
}

const CodocActionsContext = createContext<CodocActionsContextValue>({
  onAction: undefined,
});

export function CodocActionsProvider({
  onAction,
  children,
}: {
  onAction?: ((action: ViewAction) => void) | undefined;
  children: React.ReactNode;
}) {
  return (
    <CodocActionsContext.Provider value={{ onAction }}>
      {children}
    </CodocActionsContext.Provider>
  );
}

export function useCodocActions() {
  return useContext(CodocActionsContext);
}
