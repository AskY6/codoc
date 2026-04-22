export const meta = {
  description: "Score card with label, numeric value, and color-coded indicator.",
  props: [
    { name: "label", type: "string", required: true },
    { name: "value", type: "number", required: true },
    { name: "max", type: "number", required: false },
  ],
  template: '<ScoreCard label="Score" value={data.FIELD} max={5} />',
  dataTypeHints: ["number"],
};

export default function ScoreCard({
  label,
  value,
  max = 5,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color =
    pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: "14px",
        }}
      >
        {value}
      </div>
      <div>
        <div style={{ fontSize: "12px", color: "#6b7280" }}>{label}</div>
        <div style={{ fontSize: "14px", fontWeight: 600 }}>
          {value} / {max}
        </div>
      </div>
    </div>
  );
}
