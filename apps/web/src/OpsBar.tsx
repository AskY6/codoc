import type { MultiDocRuntime } from "./runtime.js";

interface Op {
  label: string;
  action: () => void;
}

export function OpsBar({ multi }: { multi: MultiDocRuntime }) {
  const ops: Op[] = [
    { label: 'update /projectName → "SuperDoc"', action: () => multi.update("B.codoc", "/projectName", "SuperDoc") },
    { label: 'update /version → "1.0.0"', action: () => multi.update("B.codoc", "/version", "1.0.0") },
    { label: 'update /status → "Released!"', action: () => multi.update("B.codoc", "/status", "Released!") },
    { label: "forceAll()", action: () => multi.forceAll() },
  ];

  return (
    <div className="ops-bar">
      <div className="ops-bar-title">Cross-Doc Operations</div>
      <div className="ops-bar-buttons">
        {ops.map((op) => (
          <button key={op.label} className="ops-btn" onClick={op.action}>
            {op.label}
          </button>
        ))}
      </div>
    </div>
  );
}
