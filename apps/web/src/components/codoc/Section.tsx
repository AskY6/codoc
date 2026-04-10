interface SectionProps {
  title?: string;
  children?: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <div className="rounded-lg border border-border/60">
      {title && (
        <div className="border-b border-border/40 px-4 py-2.5">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </div>
      )}
      <div className="px-4 py-3 space-y-3">{children}</div>
    </div>
  );
}
