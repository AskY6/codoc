import type { ReactNode } from "react";

interface CalloutProps {
  type?: "info" | "warning" | "success" | "error";
  title?: string;
  children?: ReactNode;
}

const styles: Record<string, string> = {
  info: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  warning: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  success: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
  error: "border-red-400 bg-red-50 dark:bg-red-950/30",
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  return (
    <div className={`rounded-lg border-l-4 px-4 py-3 ${styles[type] ?? styles.info}`}>
      {title && (
        <div className="text-sm font-medium text-foreground mb-1">{title}</div>
      )}
      {children && (
        <div className="text-sm text-muted-foreground">{children}</div>
      )}
    </div>
  );
}
