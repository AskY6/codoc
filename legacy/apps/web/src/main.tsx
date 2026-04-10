import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { registerClaudeCodeLogSource } from "./sources/claude-code-log-source.js";
import "./lib/codoc-generators.js"; // registers codoc generators (side effect)
import "./components/codoc/agents/index.js"; // registers agent-scoped components (side effect)
import "./index.css";

// Register client-side source providers
registerClaudeCodeLogSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
