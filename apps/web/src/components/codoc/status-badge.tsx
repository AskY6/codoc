import { Badge } from "@/components/ui/badge";

const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "default",
  idle: "secondary",
  dirty: "outline",
  error: "destructive",
  computing: "outline",
};

export function StatusBadge({ state }: { state: string }) {
  const variant = variants[state] ?? "secondary";
  return (
    <Badge variant={variant} className="text-xs capitalize">
      {state}
    </Badge>
  );
}
