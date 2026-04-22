import type { ComponentMeta, RegisteredComponent } from "./builtin/index.ts";

interface ComponentPanelProps {
  builtinRegistry: readonly RegisteredComponent[];
  customRegistry: readonly RegisteredComponent[];
  errors: Array<{ name: string; error: string }>;
}

export function ComponentPanel({ builtinRegistry, customRegistry, errors }: ComponentPanelProps) {
  return (
    <div className="flex h-full flex-col bg-neutral-50/50">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-800">Component Library</span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500 uppercase">
            {builtinRegistry.length + customRegistry.length} Items
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Built-in */}
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
            Standard
          </span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {builtinRegistry.map((entry) => (
            <ComponentCard key={entry.meta.name} meta={entry.meta} />
          ))}
        </div>

        {/* Custom */}
        {(customRegistry.length > 0 || errors.length > 0) && (
          <>
            <div className="mb-3 mt-8 flex items-center gap-2">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                Custom
              </span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customRegistry.map((entry) => (
                <ComponentCard key={entry.meta.name} meta={entry.meta} isCustom />
              ))}

              {errors.map((err) => (
                <div
                  key={err.name}
                  className="rounded-lg border border-red-200 bg-red-50 p-2.5 ring-1 ring-red-100"
                >
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-red-700">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {err.name}.tsx
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-red-600 opacity-80">{err.error}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ComponentCard({
  meta,
  isCustom,
}: {
  meta: ComponentMeta;
  isCustom?: boolean;
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-3 transition-all hover:border-blue-300 hover:shadow-md hover:shadow-blue-50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-bold text-blue-600">
            <span className="opacity-40">{"<"}</span>
            {meta.name}
            <span className="opacity-40">{" />"}</span>
          </span>
          {isCustom && (
            <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight text-purple-600 ring-1 ring-purple-100">
              custom
            </span>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 line-clamp-2">
        {meta.description}
      </p>

      {meta.props.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
            Props
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {meta.props.map((p) => (
              <div 
                key={p.name} 
                className="flex items-center gap-1 rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] ring-1 ring-neutral-100"
                title={`${p.name}${p.required ? "*" : ""}: ${p.type}`}
              >
                <span className="font-mono font-bold text-neutral-700">{p.name}</span>
                <span className="text-neutral-400 scale-90">{p.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-3">
        <div className="rounded-lg bg-neutral-50 p-2 ring-1 ring-neutral-100 transition-colors group-hover:bg-blue-50/50 group-hover:ring-blue-100">
          <code className="block truncate font-mono text-[10px] text-neutral-400 group-hover:text-blue-500">
            {meta.template}
          </code>
        </div>
      </div>
    </div>
  );
}
