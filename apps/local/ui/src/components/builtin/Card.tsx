import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  value?: string | number;
  description?: string;
  children?: ReactNode;
}

export function Card({ title, value, description, children }: CardProps) {
  return (
    <div className="not-prose rounded-lg border border-neutral-200 bg-white p-4">
      {title && (
        <div className="text-xs font-medium text-neutral-500">{title}</div>
      )}
      {value != null && (
        <div className="mt-1 text-2xl font-semibold">{String(value)}</div>
      )}
      {description && (
        <div className="mt-1 text-sm text-neutral-600">{description}</div>
      )}
      {children}
    </div>
  );
}
