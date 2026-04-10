import { DEFAULT_HOST, DEFAULT_PORT, PROTOCOL_VERSION } from '../shared/types'

export function adminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Local Connector — Grants</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.25rem; font-weight: 500; margin-bottom: 0.25rem; }
  .subtitle { font-size: 0.8rem; color: #737373; margin-bottom: 1.5rem; }
  .status { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 9999px; margin-bottom: 1.5rem; }
  .status.connected { background: #052e16; color: #4ade80; }
  .status.disconnected { background: #450a0a; color: #f87171; }
  .status.connecting { background: #422006; color: #fbbf24; }
  .dot { width: 6px; height: 6px; border-radius: 50%; }
  .connected .dot { background: #4ade80; }
  .disconnected .dot { background: #f87171; }
  .connecting .dot { background: #fbbf24; }
  .card { border: 1px solid #262626; border-radius: 0.5rem; padding: 1rem; margin-bottom: 0.75rem; background: #111; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
  .card-title { font-size: 0.85rem; font-weight: 500; word-break: break-all; }
  .card-meta { font-size: 0.75rem; color: #737373; margin-top: 0.35rem; }
  .card-meta span { margin-right: 1rem; }
  .badge { font-size: 0.65rem; padding: 0.15rem 0.5rem; border-radius: 9999px; background: #1c1c1c; color: #a3a3a3; border: 1px solid #262626; }
  button.revoke { font-size: 0.75rem; padding: 0.3rem 0.7rem; border-radius: 0.375rem; border: 1px solid #7f1d1d; background: transparent; color: #f87171; cursor: pointer; white-space: nowrap; }
  button.revoke:hover { background: #450a0a; }
  .empty { text-align: center; padding: 3rem 1rem; color: #525252; font-size: 0.85rem; }
  .error-banner { background: #450a0a; border: 1px solid #7f1d1d; color: #fca5a5; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.8rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<h1>Local Connector</h1>
<p class="subtitle">Manage filesystem access grants</p>
<div id="status" class="status disconnected"><span class="dot"></span><span id="status-text">Disconnected</span></div>
<div id="error"></div>
<div id="grants"></div>

<script>
const WS_URL = "ws://${DEFAULT_HOST}:${DEFAULT_PORT}";
const PROTOCOL_VERSION = ${PROTOCOL_VERSION};
const CLIENT_ID = "local-connector-admin";
const PRODUCT_NAME = "Local Connector Admin";

let ws = null;
let pending = new Map();
let sessionReady = false;

function setStatus(state, text) {
  const el = document.getElementById("status");
  const textEl = document.getElementById("status-text");
  el.className = "status " + state;
  textEl.textContent = text;
}

function showError(msg) {
  const el = document.getElementById("error");
  if (!msg) { el.innerHTML = ""; return; }
  el.innerHTML = '<div class="error-banner">' + escapeHtml(msg) + '</div>';
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type: "request", method, params }));
  });
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function renderGrants(grants) {
  const el = document.getElementById("grants");
  if (!grants.length) {
    el.innerHTML = '<div class="empty">No grants</div>';
    return;
  }
  el.innerHTML = "";
  grants.forEach(function(g) {
    const card = document.createElement("div");
    card.className = "card";
    const perms = g.capability.permissions.join(", ");
    card.innerHTML =
      '<div class="card-header">' +
        '<div>' +
          '<div class="card-title">' + escapeHtml(g.capability.rootPath) + '</div>' +
          '<div class="card-meta">' +
            '<span>' + escapeHtml(g.productName) + '</span>' +
            '<span>' + escapeHtml(g.origin) + '</span>' +
            '<span>' + relTime(g.updatedAt) + '</span>' +
          '</div>' +
          '<div style="margin-top:0.35rem"><span class="badge">' + escapeHtml(perms) + '</span></div>' +
        '</div>' +
        '<button class="revoke">Revoke</button>' +
      '</div>';
    card.querySelector(".revoke").addEventListener("click", function() {
      revokeGrant(g.origin, g.clientId);
    });
    el.appendChild(card);
  });
}

async function loadGrants() {
  if (!sessionReady) return;
  try {
    const res = await send("grants.list");
    renderGrants(res.grants);
    showError(null);
  } catch (e) {
    showError("Failed to load grants: " + e.message);
  }
}

async function revokeGrant(origin, clientId) {
  try {
    await send("grants.revoke", { origin, clientId });
    await loadGrants();
  } catch (e) {
    showError("Failed to revoke: " + e.message);
  }
}

function connect() {
  sessionReady = false;
  setStatus("connecting", "Connecting...");
  showError(null);

  ws = new WebSocket(WS_URL);

  ws.onopen = async function() {
    try {
      const res = await send("session.hello", {
        protocolVersion: PROTOCOL_VERSION,
        clientId: CLIENT_ID,
        productName: PRODUCT_NAME,
        requestedCapabilities: [{ type: "filesystem", permissions: ["read"] }]
      });
      sessionReady = true;
      setStatus("connected", "Connected");
      await loadGrants();
    } catch(e) {
      showError("Hello failed: " + e.message);
    }
  };

  ws.onmessage = function(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "response" && msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error?.message || "Unknown error"));
    }

    if (msg.type === "event" && msg.event === "session.ready") {
      sessionReady = true;
      setStatus("connected", "Connected");
      loadGrants();
    }

    if (msg.type === "event" && msg.event === "session.ping") {
      send("session.pong").catch(function(){});
    }
  };

  ws.onclose = function() {
    sessionReady = false;
    setStatus("disconnected", "Disconnected");
    for (const p of pending.values()) p.reject(new Error("Disconnected"));
    pending.clear();
    setTimeout(connect, 3000);
  };

  ws.onerror = function() {};
}

connect();
</script>
</body>
</html>`;
}
