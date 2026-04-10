interface GridProps {
  columns?: number;
  children?: React.ReactNode;
}

export function Grid({ columns = 2, children }: GridProps) {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}
