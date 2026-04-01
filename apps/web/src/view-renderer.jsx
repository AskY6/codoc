function MarkdownBlock({ content }) {
  const blocks = parseMarkdown(content);

  return (
    <div className="markdown-block">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h1":
            return <h1 key={`${block.type}-${index}`}>{block.content}</h1>;
          case "h2":
            return <h2 key={`${block.type}-${index}`}>{block.content}</h2>;
          case "list":
            return (
              <ul key={`${block.type}-${index}`}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${index}-${itemIndex}`}>{item}</li>
                ))}
              </ul>
            );
          default:
            return <p key={`${block.type}-${index}`}>{block.content}</p>;
        }
      })}
    </div>
  );
}

function HeroCard({ eyebrow, title, subtitle }) {
  return (
    <section className="component-card hero-card">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h3>{title ?? "Untitled"}</h3>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </section>
  );
}

function LocalHeroCard({ eyebrow, title, subtitle }) {
  return (
    <section className="component-card local-hero-card">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h3>{title ?? "Untitled"}</h3>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </section>
  );
}

function UnsupportedComponent({ source, component, alias }) {
  return (
    <section className="component-card unsupported-component">
      <strong>Unsupported component</strong>
      <div>{alias ? `${alias} -> ` : ""}{component}</div>
      <div className="muted">source: {source}</div>
    </section>
  );
}

const builtinComponents = {
  hero: HeroCard
};

const localComponents = {
  "panels/hero-card": LocalHeroCard
};

export function ViewRenderer({ document }) {
  if (!document || !Array.isArray(document.children) || document.children.length === 0) {
    return <p className="empty-state">No view node.</p>;
  }

  return <RenderedNode node={document} />;
}

function RenderedNode({ node }) {
  switch (node.type) {
    case "stack":
      return (
        <div className={`view-stack gap-${node.gap ?? "md"}`}>
          {node.children.map((child, index) => (
            <RenderedNode key={`${child.type}-${index}`} node={child} />
          ))}
        </div>
      );
    case "grid":
      return (
        <div className={`view-grid columns-${node.columns} gap-${node.gap ?? "md"}`}>
          {node.children.map((child, index) => (
            <RenderedNode key={`${child.type}-${index}`} node={child} />
          ))}
        </div>
      );
    case "markdown":
      return <MarkdownBlock content={node.content} />;
    case "text":
      return <p className={`view-text tone-${node.tone ?? "default"}`}>{node.content}</p>;
    case "json":
      return (
        <section className="render-json">
          {node.title ? <h3>{node.title}</h3> : null}
          <pre className="viewer">{JSON.stringify(node.value, null, 2)}</pre>
        </section>
      );
    case "table":
      return (
        <section className="render-table">
          {node.title ? <h3>{node.title}</h3> : null}
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  {node.columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {row.cells.map((cell, cellIndex) => (
                      <td key={`cell-${rowIndex}-${cellIndex}`}>{formatCellValue(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case "component": {
      const Component = resolveComponent(node);
      return <Component {...node.props} source={node.source} component={node.component} alias={node.alias} />;
    }
    default:
      return null;
  }
}

function formatCellValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function resolveComponent(node) {
  if (node.source === "builtin") {
    return builtinComponents[node.component] ?? UnsupportedComponent;
  }

  if (node.source === "local") {
    return localComponents[node.component] ?? UnsupportedComponent;
  }

  return UnsupportedComponent;
}

function parseMarkdown(content) {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd());
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push({
        type: "h1",
        content: line.slice(2)
      });
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({
        type: "h2",
        content: line.slice(3)
      });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items = [];
      while (index < lines.length) {
        const current = lines[index]?.trim() ?? "";
        if (!current.startsWith("- ")) {
          break;
        }

        items.push(current.slice(2));
        index += 1;
      }

      blocks.push({
        type: "list",
        items
      });
      continue;
    }

    const paragraph = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? "";
      if (
        current.length === 0 ||
        current.startsWith("# ") ||
        current.startsWith("## ") ||
        current.startsWith("- ")
      ) {
        break;
      }

      paragraph.push(current);
      index += 1;
    }

    blocks.push({
      type: "p",
      content: paragraph.join(" ")
    });
  }

  return blocks;
}
