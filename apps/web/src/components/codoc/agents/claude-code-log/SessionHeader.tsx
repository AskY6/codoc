import { GitBranch, Clock, Cpu, MessageSquare, Wrench, User } from "lucide-react";

interface SessionData {
  stats?: {
    messageCount?: number;
    toolCallCount?: number;
    userMessageCount?: number;
  };
  model?: string;
  gitBranch?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortModel(model: string): string {
  // "claude-sonnet-4-20250514" → "Sonnet 4"
  // "claude-opus-4-..." → "Opus 4"
  const m = model.match(/claude-(\w+)-(\d+)/);
  if (m && m[1] && m[2]) {
    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return `${name} ${m[2]}`;
  }
  return model;
}

export function SessionHeader({ session }: { session?: SessionData }) {
  if (!session) return null;

  const stats = session.stats;

  return (
    <div className="space-y-3">
      {/* Metadata badges */}
      <div className="flex flex-wrap gap-2">
        {session.startedAt && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1">
            <Clock className="h-3 w-3" />
            {formatDateTime(session.startedAt)}
            {session.durationMs != null && (
              <span className="text-foreground font-medium ml-1">
                ({formatDuration(session.durationMs)})
              </span>
            )}
          </span>
        )}
        {session.model && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1">
            <Cpu className="h-3 w-3" />
            {shortModel(session.model)}
          </span>
        )}
        {session.gitBranch && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1">
            <GitBranch className="h-3 w-3" />
            {session.gitBranch}
          </span>
        )}
      </div>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
          value={stats?.messageCount ?? 0}
          label="Messages"
        />
        <StatCard
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          value={stats?.toolCallCount ?? 0}
          label="Tool Calls"
        />
        <StatCard
          icon={<User className="h-4 w-4 text-muted-foreground" />}
          value={stats?.userMessageCount ?? 0}
          label="User Msgs"
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="flex-1 min-w-[120px] rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-2xl font-semibold text-foreground">{value}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
