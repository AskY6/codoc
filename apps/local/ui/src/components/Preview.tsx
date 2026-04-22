import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PreviewProps {
  view: { kind: "mdx"; source: string } | { kind: "empty" };
}

export function Preview({ view }: PreviewProps) {
  if (view.kind === "empty") {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        No document body
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none p-4">
      <Markdown remarkPlugins={[remarkGfm]}>{view.source}</Markdown>
    </div>
  );
}
