import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Subtle, deterministic color palette for agent identity
const AGENT_COLORS = [
  { bg: "bg-blue-500/8 dark:bg-blue-400/10", text: "text-blue-600/70 dark:text-blue-400/70", dot: "bg-blue-500/50" },
  { bg: "bg-emerald-500/8 dark:bg-emerald-400/10", text: "text-emerald-600/70 dark:text-emerald-400/70", dot: "bg-emerald-500/50" },
  { bg: "bg-violet-500/8 dark:bg-violet-400/10", text: "text-violet-600/70 dark:text-violet-400/70", dot: "bg-violet-500/50" },
  { bg: "bg-amber-500/8 dark:bg-amber-400/10", text: "text-amber-600/70 dark:text-amber-400/70", dot: "bg-amber-500/50" },
  { bg: "bg-rose-500/8 dark:bg-rose-400/10", text: "text-rose-600/70 dark:text-rose-400/70", dot: "bg-rose-500/50" },
  { bg: "bg-cyan-500/8 dark:bg-cyan-400/10", text: "text-cyan-600/70 dark:text-cyan-400/70", dot: "bg-cyan-500/50" },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function agentColor(agentId: string) {
  return AGENT_COLORS[hashStr(agentId) % AGENT_COLORS.length]!;
}
