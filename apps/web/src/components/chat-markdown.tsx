// Markdown renderer for chat messages.
//
// Wraps react-markdown + remark-gfm with prose-like styling that
// matches the monochrome design tokens. Lighter than MDX — no JSX
// component mapping, just standard markdown features.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface ChatMarkdownProps {
  readonly content: string;
}

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

// Custom component overrides for styling within chat bubbles.
// Uses Tailwind classes matching the monochrome theme rather than
// relying on @tailwindcss/typography prose classes.

const markdownComponents: Record<string, React.ComponentType<any>> = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 first:mt-0 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 first:mt-0 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-2.5 first:mt-0 text-sm font-semibold">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="mb-2 overflow-x-auto rounded-md bg-muted px-3 py-2 last:mb-0">
          <code className="text-xs font-mono">{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="underline text-foreground hover:opacity-70"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold bg-muted">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
};
