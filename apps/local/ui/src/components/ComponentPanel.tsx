import type { ComponentMeta, RegisteredComponent } from "./builtin/index.ts";

interface ComponentPanelProps {
  builtinRegistry: readonly RegisteredComponent[];
  customRegistry: readonly RegisteredComponent[];
  errors: Array<{ name: string; error: string }>;
  onInsert: (snippet: string) => void;
}

export function ComponentPanel({ builtinRegistry, customRegistry, errors, onInsert }: ComponentPanelProps) {

  return (
    <div className="overflow-auto p-4">
      {/* Built-in section */}
      <p className="mb-4 text-xs text-neutral-500">
        Built-in components available in MDX. Click <b>Insert</b> to add the
        template to your editor.
      </p>

      <div className="space-y-4">
        {builtinRegistry.map((entry) => (
          <ComponentCard
            key={entry.meta.name}
            meta={entry.meta}
            onInsert={onInsert}
          />
        ))}
      </div>

      {/* Custom section */}
      {(customRegistry.length > 0 || errors.length > 0) && (
        <>
          <div className="mb-3 mt-6 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Custom
            </span>
            <span className="text-[10px] text-neutral-400">
              .codoc/components/
            </span>
          </div>

          <div className="space-y-4">
            {customRegistry.map((entry) => (
              <ComponentCard
                key={entry.meta.name}
                meta={entry.meta}
                onInsert={onInsert}
                isCustom
              />
            ))}

            {errors.map((err) => (
              <div
                key={err.name}
                className="rounded-lg border border-red-200 bg-red-50 p-3"
              >
                <span className="font-mono text-sm font-semibold text-red-700">
                  {err.name}.tsx
                </span>
                <p className="mt-1 text-xs text-red-600">{err.error}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ComponentCard({
  meta,
  onInsert,
  isCustom,
}: {
  meta: ComponentMeta;
  onInsert: (snippet: string) => void;
  isCustom?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-blue-700">
            {"<"}
            {meta.name}
            {" />"}
          </span>
          {isCustom && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
              custom
            </span>
          )}
        </div>
        <button
          type="button"
          className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
          onClick={() => onInsert(`\n${meta.template}\n`)}
        >
          Insert
        </button>
      </div>

      <p className="mt-1 text-xs text-neutral-600">{meta.description}</p>

      {meta.props.length > 0 && (
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
      )}

      <div className="mt-2 rounded bg-neutral-50 p-2">
        <code className="text-[11px] text-neutral-600">{meta.template}</code>
      </div>
    </div>
  );
}
