import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../api.ts";
import type { RssSubscription } from "../../api.ts";

interface SubscriptionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the form is in edit mode. */
  editing?: RssSubscription;
  /** Existing subscriptions for duplicate URL detection. */
  existing: RssSubscription[];
  onDone: () => void;
}

export function SubscriptionForm({
  open,
  onOpenChange,
  editing,
  existing,
  onDone,
}: SubscriptionFormProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [whyFollow, setWhyFollow] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = !!editing;

  // Sync form fields when dialog opens or editing target changes.
  useEffect(() => {
    if (open) {
      setUrl(editing?.feedUrl ?? "");
      setTitle(editing?.title ?? "");
      setWhyFollow(editing?.whyFollow ?? "");
      setRefreshInterval(String(editing?.intervalMinutes ?? 30));
      setError(null);
    }
  }, [open, editing]);

  function resetAndClose() {
    setUrl("");
    setTitle("");
    setWhyFollow("");
    setRefreshInterval("30");
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isEdit) {
      // Validate URL
      try {
        new URL(url);
      } catch {
        setError("Invalid URL");
        return;
      }

      // Duplicate check
      const normalUrl = url.replace(/\/+$/, "");
      if (existing.some((s) => s.feedUrl.replace(/\/+$/, "") === normalUrl)) {
        setError("Already subscribed to this feed");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await api.rss.editSubscription(editing.slug, {
          title: title || undefined,
          whyFollow: whyFollow || undefined,
          intervalMinutes: Number(refreshInterval) || undefined,
        });
      } else {
        await api.rss.subscribe({
          url,
          title: title || undefined,
          whyFollow: whyFollow || undefined,
          intervalMinutes: Number(refreshInterval) || undefined,
        });
      }
      resetAndClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit subscription" : "Add feed"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isEdit && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                Feed URL <span className="text-red-400">*</span>
              </label>
              <Input
                type="url"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                autoFocus
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Title</label>
            <Input
              placeholder="Display name (auto-detected if empty)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={isEdit}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">Why follow?</label>
            <Input
              placeholder="Short reason for subscribing"
              value={whyFollow}
              onChange={(e) => setWhyFollow(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Refresh interval (minutes)
            </label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (isEdit ? "Saving..." : "Subscribing...") : isEdit ? "Save" : "Subscribe"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
