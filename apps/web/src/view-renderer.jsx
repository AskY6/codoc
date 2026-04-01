import React, { useEffect, useState } from "react";

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

function UnsupportedComponent({ source, component, alias, reason }) {
  return (
    <section className="component-card unsupported-component">
      <strong>Unsupported component</strong>
      <div>{alias ? `${alias} -> ` : ""}{component}</div>
      <div className="muted">source: {source}</div>
      {reason ? <div className="muted">{reason}</div> : null}
    </section>
  );
}

const builtinComponents = {
  hero: HeroCard
};

const localComponents = {
  "panels/hero-card": LocalHeroCard
};

const inlineComponentCache = new Map();
const remoteComponentCache = new Map();

export function ViewRenderer({
  document,
  codocs = [],
  currentCodoc = null,
  visitedCodocIds = []
}) {
  if (!document || !Array.isArray(document.children) || document.children.length === 0) {
    return <p className="empty-state">No view node.</p>;
  }

  return (
    <RenderedNode
      node={document}
      codocs={codocs}
      currentCodoc={currentCodoc}
      visitedCodocIds={visitedCodocIds}
    />
  );
}

function RenderedNode({ node, codocs, currentCodoc, visitedCodocIds }) {
  switch (node.type) {
    case "stack":
      return (
        <div className={`view-stack gap-${node.gap ?? "md"}`}>
          {node.children.map((child, index) => (
            <RenderedNode
              key={`${child.type}-${index}`}
              node={child}
              codocs={codocs}
              currentCodoc={currentCodoc}
              visitedCodocIds={visitedCodocIds}
            />
          ))}
        </div>
      );
    case "grid":
      return (
        <div className={`view-grid columns-${node.columns} gap-${node.gap ?? "md"}`}>
          {node.children.map((child, index) => (
            <RenderedNode
              key={`${child.type}-${index}`}
              node={child}
              codocs={codocs}
              currentCodoc={currentCodoc}
              visitedCodocIds={visitedCodocIds}
            />
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
      return (
        <RuntimeComponentNode
          node={node}
          codocs={codocs}
          currentCodoc={currentCodoc}
          visitedCodocIds={visitedCodocIds}
        />
      );
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

function RuntimeComponentNode({ node, codocs, currentCodoc, visitedCodocIds }) {
  if (node.runtime?.kind === "codoc") {
    return (
      <CodocRuntimeNode
        node={node}
        codocs={codocs}
        currentCodoc={currentCodoc}
        visitedCodocIds={visitedCodocIds}
      />
    );
  }

  if (node.runtime?.kind === "inline") {
    return (
      <AsyncRuntimeComponent
        node={node}
        cacheKey={node.runtime.code}
        loader={() => loadInlineComponent(node.runtime.code)}
      />
    );
  }

  if (node.runtime?.kind === "remote") {
    return (
      <AsyncRuntimeComponent
        node={node}
        cacheKey={JSON.stringify(node.runtime)}
        loader={() => loadRemoteComponent(node.runtime)}
      />
    );
  }

  const Component = resolveComponent(node);
  return <Component {...node.props} source={node.source} component={node.component} alias={node.alias} />;
}

function AsyncRuntimeComponent({ node, loader, cacheKey }) {
  const [Component, setComponent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setComponent(null);
    setError(null);

    loader().then(
      (resolved) => {
        if (!cancelled) {
          setComponent(() => resolved);
          setError(null);
        }
      },
      (loadError) => {
        if (!cancelled) {
          setComponent(null);
          setError(loadError);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  if (error) {
    return (
      <UnsupportedComponent
        source={node.source}
        component={node.component}
        alias={node.alias}
        reason={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  if (!Component) {
    return <LoadingComponent source={node.source} component={node.component} alias={node.alias} />;
  }

  return <Component {...node.props} source={node.source} component={node.component} alias={node.alias} />;
}

function CodocRuntimeNode({ node, codocs, currentCodoc, visitedCodocIds }) {
  const targetCodocId = resolveCodocComponentTarget(node.runtime?.ref, currentCodoc, codocs);
  const [document, setDocument] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!targetCodocId) {
      setDocument(null);
      setError(null);
      return undefined;
    }

    if (visitedCodocIds.includes(targetCodocId)) {
      setDocument(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setDocument(null);
    setError(null);
    void fetchJson(`/api/codocs/${encodeURIComponent(targetCodocId)}/document`).then(
      (payload) => {
        if (!cancelled) {
          setDocument(payload);
          setError(null);
        }
      },
      (loadError) => {
        if (!cancelled) {
          setDocument(null);
          setError(loadError);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [targetCodocId, visitedCodocIds]);

  if (!targetCodocId) {
    return (
      <UnsupportedComponent
        source={node.source}
        component={node.component}
        alias={node.alias}
        reason={`Could not resolve codoc component target "${node.runtime?.ref ?? node.component}".`}
      />
    );
  }

  if (visitedCodocIds.includes(targetCodocId)) {
    return (
      <UnsupportedComponent
        source={node.source}
        component={node.component}
        alias={node.alias}
        reason={`Recursive codoc component reference detected for "${targetCodocId}".`}
      />
    );
  }

  if (error) {
    return (
      <UnsupportedComponent
        source={node.source}
        component={node.component}
        alias={node.alias}
        reason={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  if (!document) {
    return <LoadingComponent source={node.source} component={node.component} alias={node.alias} />;
  }

  return (
    <section className="component-card component-embed">
      <ViewRenderer
        document={document.renderedView}
        codocs={codocs}
        currentCodoc={document.codoc}
        visitedCodocIds={[...visitedCodocIds, targetCodocId]}
      />
    </section>
  );
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

function LoadingComponent({ source, component, alias }) {
  return (
    <section className="component-card unsupported-component">
      <strong>Loading component</strong>
      <div>{alias ? `${alias} -> ` : ""}{component}</div>
      <div className="muted">source: {source}</div>
    </section>
  );
}

function loadInlineComponent(code) {
  const cached = inlineComponentCache.get(code);
  if (cached) {
    return cached;
  }

  const loader = Promise.resolve().then(() => {
    try {
      const component = new Function("React", `"use strict"; return (${code});`)(React);
      if (typeof component === "function") {
        return component;
      }
    } catch {
      // Fall through to the function-body variant.
    }

    const component = new Function("React", `"use strict"; ${code}`)(React);
    if (typeof component !== "function") {
      throw new Error("Inline component code must evaluate to a function.");
    }

    return component;
  });

  inlineComponentCache.set(code, loader);
  return loader;
}

function loadRemoteComponent(runtime) {
  const source = runtime.url ?? runtime.package;
  if (!source) {
    return Promise.reject(new Error("Remote component runtime requires a package or url."));
  }

  const cacheKey = JSON.stringify(runtime);
  const cached = remoteComponentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loader = import(/* @vite-ignore */ source).then((module) => {
    const exported = runtime.export ? module[runtime.export] : module.default ?? module;
    if (typeof exported !== "function") {
      throw new Error(`Remote component "${source}" did not export a renderable function.`);
    }

    return exported;
  });

  remoteComponentCache.set(cacheKey, loader);
  return loader;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed for ${url}`);
  }

  return payload;
}

function resolveCodocComponentTarget(rawRef, currentCodoc, codocs) {
  if (typeof rawRef !== "string" || rawRef.length === 0) {
    return null;
  }

  const [targetPart = ""] = rawRef.split("#", 2);
  const target = targetPart.length > 0 ? targetPart : currentCodoc?.id ?? null;
  if (!target) {
    return null;
  }

  if (codocs.some((codoc) => codoc.id === target)) {
    return target;
  }

  if (typeof currentCodoc?.filePath !== "string") {
    return null;
  }

  const normalizedTargetPath = normalizeWorkspacePath(currentCodoc.filePath, target);
  return codocs.find((codoc) => codoc.filePath === normalizedTargetPath)?.id ?? null;
}

function normalizeWorkspacePath(fromFilePath, targetPath) {
  const baseSegments = fromFilePath.split("/").slice(0, -1);
  const inputSegments = targetPath.split("/");
  const segments = targetPath.startsWith("/") ? [] : [...baseSegments];

  for (const segment of inputSegments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
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
