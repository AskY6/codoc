export interface AgentDef {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const PRESET_AGENTS: AgentDef[] = [
  {
    id: "summary",
    name: "Summary",
    description: "Generate a structured summary from referenced codocs. Output conforms to the target codoc's schema.",
    icon: "FileText",
  },
  {
    id: "info-check",
    name: "Information Check",
    description: "Verify field consistency, timeliness, and reference validity across referenced codocs.",
    icon: "ShieldCheck",
  },
  {
    id: "polish",
    name: "Text Polish",
    description: "Improve text quality of codoc fields while preserving schema structure.",
    icon: "Sparkles",
  },
];
