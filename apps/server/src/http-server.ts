import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { URL } from "node:url";

import { renderResolvedView } from "@cobook/core";
import type { ChatEvent, CobookService } from "@cobook/service";

export interface StartHttpServerOptions {
  service: CobookService;
  staticRoot: string;
  host?: string;
  port?: number;
}

export interface StartedHttpServer {
  host: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

export function createHttpRequestHandler(
  service: CobookService,
  staticRoot: string
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void handleHttpRequest(request, response, service, staticRoot);
  };
}

export async function startHttpServer(
  options: StartHttpServerOptions
): Promise<StartedHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = createServer(createHttpRequestHandler(options.service, options.staticRoot));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve HTTP server address.");
  }

  return {
    host: address.address,
    port: address.port,
    server,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: CobookService,
  staticRoot: string
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, service, method, pathname);
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      writeJson(response, 405, {
        error: "Method not allowed."
      });
      return;
    }

    await serveStaticFile(response, staticRoot, pathname);
  } catch (error) {
    if (response.headersSent) {
      if (!response.writableEnded) {
        response.end();
      }
      return;
    }

    writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: CobookService,
  method: string,
  pathname: string
): Promise<void> {
  if (method === "GET" && pathname === "/api/workspace") {
    writeJson(response, 200, await service.getWorkspace());
    return;
  }

  if (method === "GET" && pathname === "/api/codocs") {
    writeJson(response, 200, await service.listCodocs());
    return;
  }

  if (method === "GET" && pathname === "/api/diagnostics") {
    writeJson(response, 200, await service.diagnostics());
    return;
  }

  if (method === "GET" && pathname === "/api/graph") {
    writeJson(response, 200, await service.graph());
    return;
  }

  if (method === "POST" && pathname === "/api/chat") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.message !== "string") {
      writeJson(response, 400, {
        error: 'Chat requests must include a string field "message".'
      });
      return;
    }

    const events = await collectEvents(
      service.chat({
        message: body.message,
        ...(isStringArray(body.pinnedCodocIds) ? { pinnedCodocIds: body.pinnedCodocIds } : {})
      })
    );
    writeJson(response, 200, {
      events
    });
    return;
  }

  if (method === "GET" && pathname === "/api/events") {
    await handleEventStream(request, response, service);
    return;
  }

  const codocDocumentMatch = pathname.match(/^\/api\/codocs\/([^/]+)\/document$/);
  if (method === "GET" && codocDocumentMatch?.[1]) {
    const codocId = decodeURIComponent(codocDocumentMatch[1]);
    writeJson(response, 200, await buildCodocDocument(service, codocId));
    return;
  }

  const codocMatch = pathname.match(/^\/api\/codocs\/([^/]+)$/);
  if (method === "GET" && codocMatch?.[1]) {
    const codocId = decodeURIComponent(codocMatch[1]);
    writeJson(response, 200, await service.readCodoc(codocId));
    return;
  }

  writeJson(response, 404, {
    error: "API endpoint not found."
  });
}

async function buildCodocDocument(service: CobookService, codocId: string) {
  const codoc = await service.readCodoc(codocId);
  const workspace = await service.getWorkspace();
  const diagnostics = await service.diagnostics();
  const resolvedData = codoc.data ? (await service.resolve(`${codocId}:data`)).value : null;
  const resolvedView = codoc.view ? (await service.resolve(`${codocId}:view`)).value : null;

  return {
    codoc,
    resolvedData,
    resolvedView,
    renderedView: renderResolvedView({
      view: resolvedView,
      data: resolvedData,
      components: {
        ...workspace.componentRegistry,
        ...(codoc.component ?? {})
      },
      ...(codoc.meta?.component ? { componentMeta: codoc.meta.component } : {})
    }),
    nodeStates: diagnostics.nodes.filter((entry) => entry.node.codocId === codocId)
  };
}

async function handleEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  service: CobookService
): Promise<void> {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  response.write(": connected\n\n");

  const controller = new AbortController();
  const iterator = service.watch(controller.signal)[Symbol.asyncIterator]();
  let closed = false;

  const onClose = () => {
    closed = true;
    controller.abort();
  };
  request.on("close", onClose);

  try {
    while (!closed) {
      const next = await iterator.next();
      if (next.done || closed) {
        break;
      }

      response.write(`event: workspace\n`);
      response.write(`data: ${JSON.stringify(next.value)}\n\n`);
    }
  } finally {
    request.off("close", onClose);
    closed = true;
    controller.abort();

    try {
      await iterator.return?.();
    } catch {
      // Ignore iterator teardown failures during response shutdown.
    }

    if (!response.writableEnded) {
      response.end();
    }
  }
}

async function serveStaticFile(
  response: ServerResponse,
  staticRoot: string,
  pathname: string
): Promise<void> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(safePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolutePath = join(staticRoot, normalizedPath);
  const contentType = contentTypeForPath(absolutePath);

  try {
    const raw = await readFile(absolutePath);
    response.writeHead(200, {
      "Content-Type": contentType
    });
    response.end(raw);
  } catch {
    writeJson(response, 404, {
      error: "Static asset not found."
    });
  }
}

function contentTypeForPath(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  if (body.trim().length === 0) {
    return {};
  }

  return JSON.parse(body);
}

async function collectEvents(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
