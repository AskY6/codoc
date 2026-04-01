import { useEffect, useState } from "react";

import { ViewRenderer } from "./view-renderer.jsx";

const initialSnapshot = {
  workspace: null,
  diagnostics: null,
  codocs: []
};

export default function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedCodocId, setSelectedCodocId] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [events, setEvents] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [message, setMessage] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      setLoadingSnapshot(true);
      try {
        const [workspace, codocs, diagnostics] = await Promise.all([
          fetchJson("/api/workspace"),
          fetchJson("/api/codocs"),
          fetchJson("/api/diagnostics")
        ]);

        if (cancelled) {
          return;
        }

        setSnapshot({
          workspace,
          codocs,
          diagnostics
        });
        setSelectedCodocId((current) => {
          if (current && codocs.some((codoc) => codoc.id === current)) {
            return current;
          }

          const preferred = selectPreferredCodoc(workspace, codocs);
          return preferred?.id ?? null;
        });
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(formatError(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedCodocId) {
      setSelectedDocument(null);
      return;
    }

    let cancelled = false;

    async function loadDocument() {
      setLoadingDocument(true);
      try {
        const documentPayload = await fetchJson(
          `/api/codocs/${encodeURIComponent(selectedCodocId)}/document`
        );

        if (cancelled) {
          return;
        }

        setSelectedDocument(documentPayload);
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(formatError(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoadingDocument(false);
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [selectedCodocId, snapshot.codocs]);

  useEffect(() => {
    const source = new EventSource("/api/events");

    const handleWorkspaceEvent = (event) => {
      const payload = JSON.parse(event.data);
      setEvents((current) => [...current.slice(-11), payload]);
      setRefreshToken((current) => current + 1);
    };

    source.addEventListener("workspace", handleWorkspaceEvent);

    return () => {
      source.removeEventListener("workspace", handleWorkspaceEvent);
      source.close();
    };
  }, []);

  const buildSuccess = snapshot.diagnostics?.build?.success ?? false;
  const resolvedData = selectedDocument?.resolvedData ?? {};
  const renderedView = selectedDocument?.renderedView ?? null;
  const nodeStates = selectedDocument?.nodeStates ?? [];

  async function handleChatSubmit(submitEvent) {
    submitEvent.preventDefault();
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return;
    }

    setSending(true);
    try {
      const payload = await fetchJson("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: trimmedMessage,
          ...(selectedCodocId ? { pinnedCodocIds: [selectedCodocId] } : {})
        })
      });

      setTranscript((current) => [...current, ...payload.events].slice(-18));
      setMessage("");
      setRefreshToken((current) => current + 1);
      setError("");
    } catch (submitError) {
      setError(formatError(submitError));
    } finally {
      setSending(false);
    }
  }

  function refreshNow() {
    setRefreshToken((current) => current + 1);
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Cobook</p>
          <h1>Workspace Console</h1>
          <p className="muted hero-copy">
            React dev surface over the same service boundary used by the CLI and API server.
          </p>
        </div>

        <div className="workspace-meta">
          <span className="workspace-name">
            {snapshot.workspace
              ? `${snapshot.workspace.config.name} · ${snapshot.workspace.root}`
              : "Loading workspace..."}
          </span>
          <span className={`status-pill ${buildSuccess ? "good" : "warn"}`}>
            {loadingSnapshot ? "Loading" : buildSuccess ? "Build Ready" : "Build Error"}
          </span>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="layout">
        <aside className="panel codoc-panel">
          <div className="panel-head">
            <div>
              <h2>Codocs</h2>
              <p className="muted">Workspace graph entrypoints and leaf notes.</p>
            </div>
            <button type="button" onClick={refreshNow}>
              Refresh
            </button>
          </div>

          <ul className="codoc-list">
            {snapshot.codocs.map((codoc) => (
              <li key={codoc.id}>
                <button
                  type="button"
                  className={codoc.id === selectedCodocId ? "active" : ""}
                  onClick={() => {
                    setSelectedCodocId(codoc.id);
                  }}
                >
                  <span className="codoc-id">{codoc.id}</span>
                  <span className="muted">{codoc.filePath}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel detail-panel">
          <div className="panel-head">
            <div>
              <p className="muted">{selectedDocument?.codoc?.filePath ?? "Select a codoc"}</p>
              <h2>{selectedDocument?.codoc?.id ?? "No codoc selected"}</h2>
            </div>
            {loadingDocument ? <span className="muted">Resolving…</span> : null}
          </div>

          <div className="detail-grid">
            <section className="subpanel">
              <h3>View</h3>
              <div className="render-surface">
                <ViewRenderer
                  document={renderedView}
                  codocs={snapshot.codocs}
                  currentCodoc={selectedDocument?.codoc ?? null}
                />
              </div>
            </section>

            <section className="subpanel">
              <h3>Data</h3>
              <pre className="viewer">{JSON.stringify(resolvedData, null, 2)}</pre>
            </section>
          </div>

          <section className="subpanel node-state-panel">
            <h3>Node States</h3>
            <div className="state-list">
              {nodeStates.length === 0 ? (
                <p className="empty-state">No node state available for this codoc yet.</p>
              ) : (
                nodeStates.map((entry) => (
                  <article key={entry.node.id} className="state-item">
                    <code>{entry.node.id}</code>
                    <div>
                      Status: <strong>{entry.state.status}</strong>
                    </div>
                    <div>Dependents: {entry.dependents.join(", ") || "(none)"}</div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="panel chat-panel">
          <div className="panel-head">
            <div>
              <h2>Chat</h2>
              <p className="muted">Creates or updates codocs through the bound agent.</p>
            </div>
            {sending ? <span className="muted">Sending…</span> : null}
          </div>

          <form className="chat-form" onSubmit={handleChatSubmit}>
            <textarea
              name="message"
              rows="8"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              placeholder="Try: create note codoc weekly-note at notes/weekly-note.codoc about Capture this week's decisions"
            />
            <button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </form>

          <div className="subpanel transcript-panel">
            <h3>Transcript</h3>
            <div className="transcript">
              {transcript.length === 0 ? (
                <p className="empty-state">Chat events will appear here after a write operation.</p>
              ) : (
                transcript
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <article
                      key={`${entry.kind}-${index}`}
                      className={`transcript-entry ${entry.kind === "status" ? "status" : ""} ${
                        entry.kind === "artifact" ? "artifact" : ""
                      }`}
                    >
                      {entry.kind === "status" ? (
                        <>
                          <strong>{entry.status}</strong>
                          <div>{entry.message ?? ""}</div>
                        </>
                      ) : null}
                      {entry.kind === "artifact" ? (
                        <>
                          <strong>artifact</strong>
                          <div>{entry.filePath}</div>
                        </>
                      ) : null}
                      {entry.kind === "message" ? <div>{entry.content}</div> : null}
                    </article>
                  ))
              )}
            </div>
          </div>

          <div className="subpanel event-panel">
            <h3>Events</h3>
            <div className="event-log">
              {events.length === 0 ? (
                <p className="empty-state">Workspace file events will stream here.</p>
              ) : (
                events
                  .slice()
                  .reverse()
                  .map((event, index) => (
                    <article key={`${event.change.path}-${index}`} className="event-entry">
                      <strong>{event.change.kind}</strong>
                      <div>{event.change.path}</div>
                      <div className="muted">{event.build.affectedNodes.join(", ") || "(none)"}</div>
                    </article>
                  ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed for ${url}`);
  }

  return payload;
}

function selectPreferredCodoc(workspace, codocs) {
  if (!workspace?.config?.entry) {
    return codocs[0] ?? null;
  }

  return (
    codocs.find((codoc) => codoc.filePath === workspace.config.entry.replace(/^\.\//, "")) ??
    codocs[0] ??
    null
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
