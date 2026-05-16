import { useState, useEffect, useCallback } from "react";
import { api } from "../../api.ts";
import type { RssSubscription } from "../../api.ts";
import { subscribe } from "../../lib/event-bus.ts";
import { FeedStatusBadge } from "./FeedStatusBadge.tsx";
import { SubscriptionForm } from "./SubscriptionForm.tsx";

interface SubscriptionsPanelProps {
  onSelectCodoc: (path: string) => void;
}

export function SubscriptionsPanel({ onSelectCodoc }: SubscriptionsPanelProps) {
  const [subs, setSubs] = useState<RssSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RssSubscription | undefined>();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.rss.subscriptions();
      setSubs(data);
    } catch {
      // Silent — empty list shown; user can retry via refresh.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Reload when workspace data changes (via shared event bus, single SSE in App).
  useEffect(() => subscribe("workspace-updated", () => { void load(); }), [load]);

  async function handleRefresh(slug: string) {
    setRefreshing(slug);
    setActionError(null);
    try {
      await api.rss.refreshFeed(slug);
      await load();
    } catch (err) {
      setActionError(`Refresh failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setRefreshing(null);
    }
  }

  async function handleDelete(slug: string) {
    if (!confirm(`Delete subscription "${slug}"?`)) return;
    setDeleting(slug);
    setActionError(null);
    try {
      await api.rss.deleteSubscription(slug);
      await load();
    } catch (err) {
      setActionError(`Delete failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDeleting(null);
    }
  }

  function handleEdit(sub: RssSubscription) {
    setEditing(sub);
    setFormOpen(true);
  }

  function handleAdd() {
    setEditing(undefined);
    setFormOpen(true);
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-800">Subscriptions</span>
          {!loading && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500 uppercase">
              {subs.length} {subs.length === 1 ? "Feed" : "Feeds"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          + Add feed
        </button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{actionError}</span>
          <button type="button" className="ml-2 rounded p-0.5 hover:bg-red-100" onClick={() => setActionError(null)}>
            <XSmallIcon />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-400">
            <span className="text-sm">Loading...</span>
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
            <RssEmptyIcon />
            <p className="mt-3 text-sm font-medium">No subscriptions yet</p>
            <p className="mt-1 text-xs opacity-60">Add your first RSS feed to get started.</p>
            <button
              type="button"
              onClick={handleAdd}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
            >
              + Add feed
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {subs.map((sub) => (
              <div
                key={sub.slug}
                className="group rounded-lg border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-sm font-semibold text-neutral-800 hover:text-blue-600 hover:underline"
                        onClick={() => onSelectCodoc(sub.codocPath)}
                        title={`Open ${sub.codocPath}`}
                      >
                        {sub.title || sub.slug}
                      </button>
                      <FeedStatusBadge status={sub.status} lastError={sub.lastError} />
                    </div>

                    <p className="mt-0.5 truncate text-xs text-neutral-400">{sub.feedUrl}</p>

                    {sub.whyFollow && (
                      <p className="mt-1 text-xs text-neutral-500 italic truncate">{sub.whyFollow}</p>
                    )}

                    {/* Stats */}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
                      <span>
                        <strong className="text-neutral-600">{sub.articleCount}</strong> articles
                      </span>
                      {sub.unreadCount > 0 && (
                        <span>
                          <strong className="text-blue-600">{sub.unreadCount}</strong> unread
                        </span>
                      )}
                      {sub.starredCount > 0 && (
                        <span>
                          <strong className="text-amber-600">{sub.starredCount}</strong> starred
                        </span>
                      )}
                      <span>every {sub.intervalMinutes}m</span>
                      {sub.lastFetchedAt && (
                        <span title={sub.lastFetchedAt}>
                          fetched {formatRelative(sub.lastFetchedAt)}
                        </span>
                      )}
                    </div>

                    {/* Error detail */}
                    {sub.lastError && (
                      <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[10px] text-red-600 line-clamp-2">
                        {sub.lastError}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <ActionButton
                      title="Refresh"
                      disabled={refreshing === sub.slug}
                      onClick={() => handleRefresh(sub.slug)}
                    >
                      {refreshing === sub.slug ? <SpinnerSmall /> : <RefreshIcon />}
                    </ActionButton>
                    <ActionButton title="Edit" onClick={() => handleEdit(sub)}>
                      <EditSmallIcon />
                    </ActionButton>
                    <ActionButton
                      title="Unsubscribe"
                      danger
                      disabled={deleting === sub.slug}
                      onClick={() => handleDelete(sub.slug)}
                    >
                      <TrashSmallIcon />
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SubscriptionForm
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(undefined); }}
        editing={editing}
        existing={subs}
        onDone={load}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function ActionButton({
  children,
  title,
  danger,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${
        danger
          ? "text-neutral-400 hover:bg-red-50 hover:text-red-500"
          : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function RssEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-200">
      <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function EditSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SpinnerSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
