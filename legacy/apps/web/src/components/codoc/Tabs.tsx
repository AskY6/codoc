interface TabProps {
  label: string;
  children?: React.ReactNode;
}

export function Tab({ label, children }: TabProps) {
  return (
    <div data-tab-label={label}>
      {children}
    </div>
  );
}

interface TabsProps {
  children?: React.ReactNode;
}

export function Tabs({ children }: TabsProps) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <div className="space-y-2">
      {items.map((child, i) => {
        const label =
          child?.props?.["data-tab-label"] ??
          child?.props?.label ??
          `Tab ${i + 1}`;
        return (
          <details
            key={i}
            open={i === 0}
            className="group/tab rounded-lg border border-border/60"
          >
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 rounded-lg transition-colors group-open/tab:rounded-b-none">
              {label}
            </summary>
            <div className="px-4 py-3 border-t border-border/40">{child}</div>
          </details>
        );
      })}
    </div>
  );
}
