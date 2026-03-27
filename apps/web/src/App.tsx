import { useState, type ComponentType } from "react";
import type { MultiDocRuntime, CodocRuntime } from "./runtime.js";
import { OpsBar } from "./OpsBar.js";
import { DocPanel } from "./DocPanel.js";
import { DAGPanel } from "./DAGPanel.js";

interface DocEntry {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  MDXContent: ComponentType<{ components: Record<string, ComponentType<{ path: string }>> }>;
}

export function App({
  multi,
  docs,
}: {
  multi: MultiDocRuntime;
  docs: DocEntry[];
}) {
  const [selectedDoc, setSelectedDoc] = useState(docs[0].docId);

  const runtimes = new Map<string, CodocRuntime>();
  for (const doc of docs) {
    runtimes.set(doc.docId, doc.runtime);
  }

  return (
    <>
      <OpsBar multi={multi} />

      <div className="inspector-layout">
        <div className="docs-column">
          {docs.map((doc) => (
            <DocPanel
              key={doc.docId}
              docId={doc.docId}
              runtime={doc.runtime}
              rawSource={doc.rawSource}
              MDXContent={doc.MDXContent}
              selected={selectedDoc === doc.docId}
              onSelect={() => setSelectedDoc(doc.docId)}
            />
          ))}
        </div>

        <DAGPanel
          selectedDocId={selectedDoc}
          runtimes={runtimes}
          registry={multi.registry}
        />
      </div>
    </>
  );
}
