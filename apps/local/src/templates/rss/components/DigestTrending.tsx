import { SourceBadge } from "./SourceBadge";

interface Item {
  title?: string;
  source?: string;
  link?: string;
}

interface DigestTrendingProps {
  items?: Item[];
}

export function DigestTrending({ items = [] }: DigestTrendingProps) {
  if (items.length === 0) return null;

  return (
    <div className="not-prose mt-2 border-t border-neutral-200 pt-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Trending
      </div>
      <div className="divide-y divide-neutral-100">
        {items.map((item, i) => {
          const Tag: "a" | "div" = item.link ? "a" : "div";
          return (
            <Tag
              key={i}
              {...(item.link
                ? { href: item.link, target: "_blank", rel: "noreferrer" }
                : {})}
              className="group -mx-2 flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50"
            >
              <SourceBadge source={item.source} compact />
              <span className="flex-1 truncate text-xs text-neutral-600 group-hover:text-blue-600">
                {item.title ?? "Untitled"}
              </span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

export default DigestTrending;
