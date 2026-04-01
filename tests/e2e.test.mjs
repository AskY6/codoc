import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const exampleWorkspace = join(repoRoot, "examples", "hello-cobook");

test("local transport end-to-end", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-local-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const list = runCli(runtime, workspace, ["list"]);
  const listedCodocs = parseJsonOutput(list.stdout);
  assert.deepEqual(
    listedCodocs.map((codoc) => codoc.id),
    ["dashboard", "user"]
  );

  const validate = runCli(runtime, workspace, ["validate"]);
  const validateResult = parseJsonOutput(validate.stdout);
  assert.equal(validateResult.success, true);

  const resolvedCurrentUser = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"]).stdout
  );
  assert.deepEqual(resolvedCurrentUser.value, {
    name: "Ada",
    role: "editor"
  });

  const diagnostics = parseJsonOutput(runCli(runtime, workspace, ["diagnose"]).stdout);
  assert.equal(diagnostics.build.success, true);
  assert.ok(
    diagnostics.nodes.some(
      (entry) => entry.node.id === "user:data/name" && entry.state.status === "idle"
    )
  );

  const invalidation = parseJsonOutput(
    runCli(runtime, workspace, ["invalidate", "user:data/name"]).stdout
  );
  assert.ok(invalidation.dirtiedNodes.includes("user:data/name"));
  assert.ok(invalidation.dirtiedNodes.includes("dashboard:data/currentUser"));

  const generatedChat = runCli(runtime, workspace, [
    "chat",
    "create note codoc idea at notes/idea.codoc about Capture the next product direction"
  ]);
  assert.match(generatedChat.stdout, /Build succeeded\./);
  assert.match(generatedChat.stdout, /\[artifact\] notes\/idea\.codoc/);

  const resolvedIdea = parseJsonOutput(runCli(runtime, workspace, ["resolve", "idea:data"]).stdout);
  assert.deepEqual(resolvedIdea.value, {
    title: "Idea",
    summary: "Capture the next product direction"
  });

  const updateMessage = [
    "update codoc user",
    "```yaml",
    'codoc: "0.1"',
    'id: "user"',
    "",
    "data:",
    '  name: "Grace"',
    '  role: "editor"',
    "",
    "view: |",
    "  # User",
    "",
    "  {data.name} ({data.role})",
    "```"
  ].join("\n");
  const updatedChat = runCli(runtime, workspace, ["chat", updateMessage]);
  assert.match(updatedChat.stdout, /Writing "user\.codoc"/);
  assert.match(updatedChat.stdout, /Build succeeded\./);

  const resolvedDashboardAfterUpdate = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"]).stdout
  );
  assert.deepEqual(resolvedDashboardAfterUpdate.value, {
    name: "Grace",
    role: "editor"
  });
});

test("rpc transport end-to-end", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-rpc-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const list = parseJsonOutput(runCli(runtime, workspace, ["list"], "rpc").stdout);
  assert.deepEqual(
    list.map((codoc) => codoc.id),
    ["dashboard", "user"]
  );

  const resolvedCurrentUser = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"], "rpc").stdout
  );
  assert.deepEqual(resolvedCurrentUser.value, {
    name: "Ada",
    role: "editor"
  });

  const rpcChat = runCli(
    runtime,
    workspace,
    [
      "chat",
      "create note codoc rpc-note at notes/rpc-note.codoc about Validate rpc transport"
    ],
    "rpc"
  );
  assert.match(rpcChat.stdout, /\[artifact\] notes\/rpc-note\.codoc/);
  assert.match(rpcChat.stdout, /Build succeeded\./);

  const resolvedRpcNote = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "rpc-note:data"], "rpc").stdout
  );
  assert.deepEqual(resolvedRpcNote.value, {
    title: "Rpc Note",
    summary: "Validate rpc transport"
  });
});

test("stdio transport end-to-end", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-stdio-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const list = parseJsonOutput(runCli(runtime, workspace, ["list"], "stdio").stdout);
  assert.deepEqual(
    list.map((codoc) => codoc.id),
    ["dashboard", "user"]
  );

  const resolvedCurrentUser = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"], "stdio").stdout
  );
  assert.deepEqual(resolvedCurrentUser.value, {
    name: "Ada",
    role: "editor"
  });

  const stdioChat = runCli(
    runtime,
    workspace,
    [
      "chat",
      "create note codoc stdio-note at notes/stdio-note.codoc about Validate stdio transport"
    ],
    "stdio"
  );
  assert.match(stdioChat.stdout, /\[artifact\] notes\/stdio-note\.codoc/);
  assert.match(stdioChat.stdout, /Build succeeded\./);

  const resolvedStdioNote = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "stdio-note:data"], "stdio").stdout
  );
  assert.deepEqual(resolvedStdioNote.value, {
    title: "Stdio Note",
    summary: "Validate stdio transport"
  });
});

test("http web experience end-to-end", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-");
  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await cleanup(runtime, workspace);
    await http.close();
  });

  const pageResponse = await http.request({
    method: "GET",
    url: "/"
  });
  assert.equal(pageResponse.statusCode, 200);
  assert.match(pageResponse.text, /Workspace Console/);

  const workspaceSnapshot = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/workspace"
    })
  );
  assert.equal(workspaceSnapshot.config.name, "hello-cobook");

  const codocs = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs"
    })
  );
  assert.deepEqual(
    codocs.map((codoc) => codoc.id),
    ["dashboard", "user"]
  );

  const dashboardDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/dashboard/document"
    })
  );
  assert.equal(dashboardDocument.codoc.id, "dashboard");
  assert.deepEqual(dashboardDocument.resolvedData, {
    currentUser: {
      name: "Ada",
      role: "editor"
    }
  });

  const chatResult = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message:
          "create note codoc web-note at notes/web-note.codoc about Validate web experience"
      })
    })
  );
  assert.ok(chatResult.events.some((event) => event.kind === "artifact"));

  const webNoteDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/web-note/document"
    })
  );
  assert.deepEqual(webNoteDocument.resolvedData, {
    title: "Web Note",
    summary: "Validate web experience"
  });

  const eventStream = await http.openEventStream("/api/events");
  const eventPromise = eventStream.nextEvent();
  await sleep(800);
  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");
  await writeFile(userCodocPath, originalUserCodoc.replace("Ada", "Grace"), "utf8");

  const workspaceEvent = await eventPromise;
  await eventStream.close();
  assert.deepEqual(workspaceEvent.change, {
    kind: "updated",
    path: "user.codoc"
  });
  assert.equal(workspaceEvent.build.success, true);
});

test("watch rebuilds after workspace change", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-watch-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const watchResultPromise = watchForFirstEvent(runtime, workspace);
  await sleep(800);

  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");
  await writeFile(userCodocPath, originalUserCodoc.replace("Ada", "Grace"), "utf8");

  const watchResult = await watchResultPromise;
  const watchEvent = parseJsonOutput(watchResult.stdout);

  assert.deepEqual(watchEvent.change, {
    kind: "updated",
    path: "user.codoc"
  });
  assert.equal(watchEvent.build.success, true);
  assert.ok(watchEvent.build.affectedNodes.includes("user:data/name"));
  assert.ok(watchEvent.build.affectedNodes.includes("dashboard:data/currentUser"));

  const resolvedAfterWatch = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"]).stdout
  );
  assert.deepEqual(resolvedAfterWatch.value, {
    name: "Grace",
    role: "editor"
  });
});

async function buildRuntime() {
  const runtimeDir = await mkdtemp(join(tmpdir(), "cobook-e2e-runtime-"));
  await writeFile(join(runtimeDir, "package.json"), '{"type":"module"}\n', "utf8");

  const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");
  const compile = spawnSync(
    tscPath,
    ["-p", "tsconfig.json", "--noEmit", "false", "--outDir", runtimeDir],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  assert.equal(
    compile.status,
    0,
    `TypeScript build failed.\nstdout:\n${compile.stdout}\nstderr:\n${compile.stderr}`
  );

  const cobookNodeModulesDir = join(runtimeDir, "node_modules", "@cobook");
  await mkdir(cobookNodeModulesDir, { recursive: true });

  for (const pkg of ["core", "workspace", "service", "agent"]) {
    await symlink(
      join(runtimeDir, "packages", pkg, "src"),
      join(cobookNodeModulesDir, pkg),
      "dir"
    );
  }

  const yamlDir = await findYamlPackageDir();
  await symlink(yamlDir, join(runtimeDir, "node_modules", "yaml"), "dir");

  return {
    dir: runtimeDir,
    cliPath: join(runtimeDir, "apps", "cli", "src", "main.js"),
    serverPath: join(runtimeDir, "apps", "server", "src", "main.js")
  };
}

async function findYamlPackageDir() {
  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  const entries = await readdir(pnpmDir);
  const yamlEntry = entries.find((entry) => entry.startsWith("yaml@"));
  assert.ok(yamlEntry, "Could not locate yaml package under node_modules/.pnpm.");

  const yamlDir = join(pnpmDir, yamlEntry, "node_modules", "yaml");
  assert.ok(existsSync(yamlDir), `Resolved yaml package path does not exist: ${yamlDir}`);
  return yamlDir;
}

async function cloneExampleWorkspace(prefix) {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  await cp(exampleWorkspace, workspace, { recursive: true });
  return workspace;
}

function runCli(runtime, workspace, args, transport = "local") {
  const result = spawnSync(
    process.execPath,
    [runtime.cliPath, "--transport", transport, "--root", workspace, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(
    result.status,
    0,
    `CLI command failed: ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );

  return result;
}

async function watchForFirstEvent(runtime, workspace) {
  const child = spawn(
    process.execPath,
    [runtime.cliPath, "--transport", "local", "--root", workspace, "watch"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Timed out waiting for watch output.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    }, 8000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!settled && stdout.includes('"change"')) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        resolve({ stdout, stderr });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      clearTimeout(timeout);
      settled = true;
      reject(
        new Error(
          `Watch process exited before producing output. code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
}

function parseJsonOutput(output) {
  return JSON.parse(output.trim());
}

function parseJsonBody(response) {
  assert.equal(
    response.statusCode >= 200 && response.statusCode < 300,
    true,
    `HTTP handler returned ${response.statusCode}: ${response.text}`
  );
  return JSON.parse(response.text);
}

async function cleanup(runtime, workspace) {
  await Promise.all([
    runtime ? rm(runtime.dir, { recursive: true, force: true }) : Promise.resolve(),
    workspace ? rm(workspace, { recursive: true, force: true }) : Promise.resolve()
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createHttpHarness(runtime, workspace) {
  const { createAppService } = await import(
    pathToFileURL(join(runtime.dir, "apps", "server", "src", "create-service.js")).href
  );
  const { createHttpRequestHandler } = await import(
    pathToFileURL(join(runtime.dir, "apps", "server", "src", "http-server.js")).href
  );

  const service = createAppService();
  await service.openWorkspace(workspace);
  const handler = createHttpRequestHandler(service, join(repoRoot, "apps", "web", "public"));

  return {
    async request({ method, url, headers, body }) {
      return invokeHttpHandler(handler, {
        method,
        url,
        headers,
        body
      });
    },
    async openEventStream(url) {
      return openEventStream(handler, url);
    },
    async close() {
      return Promise.resolve();
    }
  };
}

async function invokeHttpHandler(handler, { method, url, headers, body }) {
  const request = createMockRequest({
    method,
    url,
    headers,
    body
  });
  const response = createMockResponse();
  const finished = response.finished();

  handler(request, response);
  request.end(body ?? "");
  await finished;

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    text: response.body
  };
}

async function openEventStream(handler, url) {
  const request = createMockRequest({
    method: "GET",
    url
  });
  const response = createMockResponse({
    stream: true
  });

  handler(request, response);
  request.end();

  return {
    nextEvent() {
      return response.waitForEvent();
    },
    async close() {
      request.emit("close");
      response.end();
    }
  };
}

function createMockRequest({ method, url, headers, body }) {
  const request = new PassThrough();
  request.method = method;
  request.url = url;
  request.headers = headers ?? {};
  return request;
}

function createMockResponse(options = {}) {
  const stream = new PassThrough();
  stream.setEncoding("utf8");
  stream.statusCode = 200;
  stream.headers = {};
  stream.body = "";
  let chunkBuffer = "";

  stream.writeHead = (statusCode, headers = {}) => {
    stream.statusCode = statusCode;
    stream.headers = {
      ...stream.headers,
      ...headers
    };
    return stream;
  };

  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    const text = bufferToString(chunk);
    stream.body += text;
    chunkBuffer += text;
    stream.emit("chunk", text);
    return originalWrite(chunk, encoding, callback);
  };

  const originalEnd = stream.end.bind(stream);
  stream.end = (chunk, encoding, callback) => {
    let resolvedEncoding = encoding;
    let resolvedCallback = callback;

    if (typeof resolvedEncoding === "function") {
      resolvedCallback = resolvedEncoding;
      resolvedEncoding = undefined;
    }

    if (chunk !== undefined && chunk !== null) {
      stream.write(chunk, resolvedEncoding);
      return originalEnd(undefined, undefined, resolvedCallback);
    }

    return originalEnd(undefined, undefined, resolvedCallback);
  };

  stream.finished = () =>
    new Promise((resolve) => {
      stream.once("finish", resolve);
    });

  stream.waitForEvent = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for SSE payload.\nBody so far:\n${stream.body}`));
      }, 8000);

      const onChunk = () => {
        const match = chunkBuffer.match(/data:\s*(\{.*\})/);
        if (!match?.[1]) {
          return;
        }

        cleanup();
        resolve(JSON.parse(match[1]));
      };

      const onFinish = () => {
        cleanup();
        reject(new Error(`SSE stream finished before event arrived.\nBody so far:\n${stream.body}`));
      };

      function cleanup() {
        clearTimeout(timer);
        stream.off("chunk", onChunk);
        stream.off("finish", onFinish);
      }

      stream.on("chunk", onChunk);
      stream.on("finish", onFinish);
    });

  return stream;
}

function bufferToString(chunk) {
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}
