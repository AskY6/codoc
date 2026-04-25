// Prompt — actionable prompt button for MDX documents.
//
// Renders a clickable chip that publishes a "send-prompt" event
// via the event bus. Any subscriber (e.g. ChatPanel) can pick it up.

import { publish } from "../../lib/event-bus.ts";

export function Prompt({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => publish("send-prompt", { prompt: label })}
      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:border-blue-400 hover:bg-blue-100 cursor-pointer my-1 mr-2"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
      {label}
    </button>
  );
}
