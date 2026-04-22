interface BadgeProps {
  value?: string | number | boolean;
  label?: string;
  color?: "blue" | "green" | "red" | "amber" | "purple" | "neutral";
}

const colors: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  purple: "bg-purple-100 text-purple-700",
  neutral: "bg-neutral-100 text-neutral-700",
};

export function Badge({ value, label, color = "blue" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color] ?? colors.blue}`}
    >
      {label && <span className="opacity-60">{label}</span>}
      {String(value ?? "")}
    </span>
  );
}
