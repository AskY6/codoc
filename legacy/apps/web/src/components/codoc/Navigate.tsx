import { useCodocActions } from "./codoc-context.js";
import type { NavigateGenerate } from "@/types.js";

interface NavigateProps {
  to: string;
  generate?: NavigateGenerate;
  children?: React.ReactNode;
}

export function Navigate({ to, generate, children }: NavigateProps) {
  const { onAction } = useCodocActions();

  return (
    <button
      type="button"
      onClick={() => {
        const action = generate
          ? { type: "navigate" as const, path: to, generate }
          : { type: "navigate" as const, path: to };
        onAction?.(action);
      }}
      className="w-full text-left cursor-pointer rounded-md ring-primary/30 transition-shadow hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
    >
      {children}
    </button>
  );
}
