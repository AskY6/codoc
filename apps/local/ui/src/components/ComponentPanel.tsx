import { registry } from "./builtin/index.ts";
import type { ComponentMeta } from "./builtin/index.ts";

interface ComponentPanelProps {
  onInsert: (snippet: string) => void;
}

export function ComponentPanel({ onInsert }: ComponentPanelProps) {
  return (
    <div className="overflow-auto p-4">
      <p className="mb-4 text-xs text-neutral-500">
        Built-in components available in MDX. Click <b>Insert</b> to add the
        template to your editor.
      </p>

      <div className="space-y-4">
        {registry.map((entry) => (
          <ComponentCard
            key={entry.meta.name}
            meta={entry.meta}
            onInsert={onInsert}
          />
        ))}
      </div>
    </div>
  );
}

function ComponentCard({
  meta,
  onInsert,
}: {
  meta: ComponentMeta;
  onInsert: (snippet: string) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-blue-700">
          {"<"}
          {meta.name}
          {" />"}
        </span>
        <button
          type="button"
          className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
          onClick={() => onInsert(`\n${meta.template}\n`)}
        >
          Insert
        </button>
      </div>

      <p className="mt-1 text-xs text-neutral-600">{meta.description}</p>

      <div className="mt-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          Props
        </div>
        <div className="mt-1 space-y-0.5">
          {meta.props.map((p) => (
            <div key={p.name} className="flex items-baseline gap-1 text-xs">
              <span className="font-mono text-neutral-700">{p.name}</span>
              {p.required && (
                <span className="text-red-400">*</span>
              )}
              <span className="text-neutral-400">{p.type}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 rounded bg-neutral-50 p-2">
        <code className="text-[11px] text-neutral-600">{meta.template}</code>
      </div>
    </div>
  );
}
