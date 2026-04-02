const colors: Record<string, string> = {
  ready: "bg-green-100 text-green-800",
  idle: "bg-gray-100 text-gray-600",
  dirty: "bg-yellow-100 text-yellow-800",
  error: "bg-red-100 text-red-800",
  computing: "bg-blue-100 text-blue-800",
};

export function StatusPill({ state }: { state: string }) {
  const cls = colors[state] ?? colors.idle;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {state}
    </span>
  );
}
