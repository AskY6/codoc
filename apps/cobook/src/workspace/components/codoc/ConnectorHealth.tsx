"use client";

import { useState } from "react";
import { useConnectorStatuses } from "@/workspace/hooks/use-workspace";
import { setConnectorActive } from "@/workspace/stores/api-client";
import { getStore } from "@/workspace/hooks/use-workspace";
import { Plug, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";

export function ConnectorHealth() {
  const connectors = useConnectorStatuses();
  const [toggling, setToggling] = useState<string | null>(null);

  if (connectors.length === 0) return null;

  const handleToggle = async (name: string, currentlyActive: boolean) => {
    setToggling(name);
    try {
      const updated = await setConnectorActive(name, !currentlyActive);
      getStore().hydrateConnectors(updated);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="px-3 py-3 border-t border-sidebar-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Connectors
      </h3>
      <div className="space-y-0.5">
        {connectors.map((c) => {
          const isToggling = toggling === c.name;
          return (
            <Tooltip key={c.name}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleToggle(c.name, c.active)}
                  disabled={isToggling}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                    c.active
                      ? "bg-sidebar-accent/50 hover:bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/30 opacity-60 hover:opacity-100",
                    isToggling && "opacity-50",
                  )}
                >
                  <Plug className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 truncate text-sidebar-foreground text-xs text-left">
                    {c.displayName}
                  </span>
                  {isToggling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                  ) : c.active ? (
                    c.authConfigured ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                    )
                  ) : (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      启用
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">{c.displayName}</p>
                <p className="text-xs text-muted-foreground max-w-48">
                  {c.description}
                </p>
                <p className="text-xs mt-1">
                  {c.active
                    ? c.authConfigured
                      ? "已启用 · 认证已配置"
                      : "已启用 · 认证未配置"
                    : "未启用 · 点击启用"}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
