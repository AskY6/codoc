import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const exampleWorkspace = join(repoRoot, "examples", "hello-cobook");
let postgresHarnessPromise = null;
const postgresHarness = await getPostgresHarness();
process.env.COBOOK_DATABASE_URL = postgresHarness.connectionString;

test.after(async () => {
  await postgresHarness.close();
});

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

  const workspaceSummary = runCli(runtime, workspace, ["chat", "workspace summary"]);
  assert.match(workspaceSummary.stdout, /"name": "hello-cobook"/);
  assert.match(workspaceSummary.stdout, /"entryCodocId": "dashboard"/);
  assert.match(workspaceSummary.stdout, /"defaultContextCodocIds": \[\s*"dashboard",\s*"user"\s*\]/);

  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");
  const refactoredChat = runCli(runtime, workspace, ["chat", "refactor codoc user"]);
  assert.match(refactoredChat.stdout, /Refactoring "user\.codoc"/);
  assert.match(
    refactoredChat.stdout,
    /Refactored codoc "user" to the canonical workspace format\./
  );
  assert.match(refactoredChat.stdout, /\[artifact\] user\.codoc/);

  const refactoredUserCodoc = await readFile(userCodocPath, "utf8");
  assert.notEqual(refactoredUserCodoc, originalUserCodoc);
  assert.match(refactoredUserCodoc, /\$source: static/);
  assert.match(refactoredUserCodoc, /value: editor/);

  const resolvedDashboardAfterRefactor = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"]).stdout
  );
  assert.deepEqual(resolvedDashboardAfterRefactor.value, {
    name: "Ada",
    role: "editor"
  });

  const generatedChat = runCli(runtime, workspace, [
    "chat",
    "create note codoc idea at notes/idea.codoc about Capture the next product direction"
  ]);
  assert.match(generatedChat.stdout, /Build succeeded\./);
  assert.match(generatedChat.stdout, /\[artifact\] notes\/idea\.codoc/);

  const resolvedIdea = parseJsonOutput(runCli(runtime, workspace, ["resolve", "idea:data"]).stdout);
  assert.deepEqual(resolvedIdea.value, {
    title: "Idea",
    summary: "Capture the next product direction",
    relatedCodocs: ["dashboard", "user"]
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
    summary: "Validate rpc transport",
    relatedCodocs: ["dashboard", "user"]
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
    summary: "Validate stdio transport",
    relatedCodocs: ["dashboard", "user"]
  });
});

test("http data sources resolve remote payloads", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-source-");
  const sourceServer = await createSourceServer();
  let http = null;

  t.after(async () => {
    await Promise.all([
      cleanup(runtime, workspace),
      sourceServer.close(),
      http ? http.close() : Promise.resolve()
    ]);
  });

  await writeFile(
    join(workspace, "http-profile.codoc"),
    [
      'codoc: "0.1"',
      'id: "http-profile"',
      "",
      "data:",
      "  profile:",
      '    $source: http',
      `    url: "http://127.0.0.1:${sourceServer.port}/lookup.json"`,
      '    method: "POST"',
      "    headers:",
      '      x-cobook-auth: "secret-token"',
      '    body: "{\\"user\\":\\"ada\\"}"',
      '    format: "json"',
      "",
      "view: |",
      "  {data.profile.name} ({data.profile.role})",
      ""
    ].join("\n"),
    "utf8"
  );

  http = await createHttpHarness(runtime, workspace);

  const document = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/http-profile/document"
    })
  );
  assert.deepEqual(document.resolvedData, {
    profile: {
      name: "Ada",
      role: "editor",
      source: "http"
    }
  });
  assert.equal(document.renderedView.children[0].content.trim(), "Ada (editor)");
});

test("rss data sources resolve feed items", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-rss-source-");
  const rssServer = await createRssSourceServer();
  let http = null;

  t.after(async () => {
    await Promise.all([
      cleanup(runtime, workspace),
      rssServer.close(),
      http ? http.close() : Promise.resolve()
    ]);
  });

  await writeFile(
    join(workspace, "rss-feed.codoc"),
    [
      'codoc: "0.1"',
      'id: "rss-feed"',
      "",
      "data:",
      "  items:",
      '    $source: rss',
      `    url: "http://127.0.0.1:${rssServer.port}/feed.xml"`,
      "    limit: 2",
      "",
      "view:",
      "  type: table",
      '  title: "Feed"',
      "  columns:",
      '    - key: "title"',
      '      label: "Title"',
      '    - key: "publishedAt"',
      '      label: "Published"',
      "  rows: '{data.items}'",
      ""
    ].join("\n"),
    "utf8"
  );

  http = await createHttpHarness(runtime, workspace);

  const document = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/rss-feed/document"
    })
  );
  assert.deepEqual(document.resolvedData, {
    items: [
      {
        title: "First item",
        link: "https://example.com/first",
        description: "First summary",
        publishedAt: "Mon, 01 Apr 2024 10:00:00 GMT",
        id: "first-item"
      },
      {
        title: "Second item",
        link: "https://example.com/second",
        description: "Second summary",
        publishedAt: "Tue, 02 Apr 2024 11:30:00 GMT",
        id: "second-item"
      }
    ]
  });
  assert.equal(document.renderedView.children[0].type, "table");
  assert.deepEqual(document.renderedView.children[0].rows[0].cells, [
    "First item",
    "Mon, 01 Apr 2024 10:00:00 GMT"
  ]);
  assert.deepEqual(document.renderedView.children[0].rows[1].cells, [
    "Second item",
    "Tue, 02 Apr 2024 11:30:00 GMT"
  ]);
});

test("http app service persists generated codocs in postgresql instead of workspace files", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-postgres-store-");
  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await Promise.all([cleanup(runtime, workspace), http.close()]);
  });

  const chatResult = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "postgres-store-session",
        message:
          "create note codoc postgres-note at notes/postgres-note.codoc about Persist in postgres"
      })
    })
  );
  assert.ok(chatResult.events.some((event) => event.kind === "artifact"));
  assert.equal(existsSync(join(workspace, "notes", "postgres-note.codoc")), false);
  assert.equal(existsSync(join(workspace, ".cobook", "workspace.sqlite")), false);

  await http.close();

  const reloaded = await createHttpHarness(runtime, workspace);
  t.after(async () => {
    await reloaded.close();
  });

  const document = parseJsonBody(
    await reloaded.request({
      method: "GET",
      url: "/api/codocs/postgres-note/document"
    })
  );
  assert.deepEqual(document.resolvedData, {
    title: "Postgres Note",
    summary: "Persist in postgres",
    relatedCodocs: ["dashboard", "user"]
  });
});

test("http chat routes base and rss scene interactions through the web-oriented agent stack", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await mkdtemp(join(tmpdir(), "cobook-e2e-http-rss-scene-"));
  const rssServer = await createRssSourceServer();

  await writeFile(
    join(workspace, "cobook.yaml"),
    [
      'cobook: "0.1"',
      'name: "rss-scene-web"',
      "",
      "include:",
      '  - "**/*.codoc"',
      "",
      "exclude:",
      '  - "dist/**"',
      "",
      "agents:",
      "  rss:",
      '    name: "RSS Agent"',
      '    description: "Subscribe to feeds and discuss articles."',
      '    outputDir: "rss"',
      ""
    ].join("\n"),
    "utf8"
  );

  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await Promise.all([cleanup(runtime, workspace), rssServer.close(), http.close()]);
  });

  const workspaceSnapshot = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/workspace"
    })
  );
  assert.deepEqual(workspaceSnapshot.codocs, []);

  const abilityPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "rss-web-session",
        message: "你能做什么？"
      })
    })
  );
  const abilityMessage = abilityPayload.events.find((event) => event.kind === "message");
  assert.ok(abilityMessage, "Expected a message event from the base agent.");
  assert.match(abilityMessage.content, /我现在可以帮助你/);
  assert.match(abilityMessage.content, /RSS Agent/);

  const subscribePromptPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "rss-web-session",
        message: "帮我订阅某个 rss 源"
      })
    })
  );
  const subscribePrompt = subscribePromptPayload.events.find((event) => event.kind === "message");
  assert.ok(subscribePrompt, "Expected a message event asking for the feed URL.");
  assert.match(subscribePrompt.content, /RSS\/Atom 源链接/);

  const subscribePayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "rss-web-session",
        message: `请订阅这个源：http://127.0.0.1:${rssServer.port}/feed.xml`
      })
    })
  );
  const artifactEvent = subscribePayload.events.find((event) => event.kind === "artifact");
  assert.ok(artifactEvent, "Expected an artifact event from the RSS scene agent.");
  assert.equal(existsSync(join(workspace, artifactEvent.filePath)), false);

  const updatedWorkspace = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/workspace"
    })
  );
  assert.equal(updatedWorkspace.codocs.length, 1);
  const createdCodocId = updatedWorkspace.codocs[0].id;

  const rssDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: `/api/codocs/${encodeURIComponent(createdCodocId)}/document`
    })
  );
  assert.deepEqual(rssDocument.codoc.meta.scene, {
    kind: "rss-source",
    sourceUrl: `http://127.0.0.1:${rssServer.port}/feed.xml`
  });
  assert.equal(rssDocument.resolvedData.items.length, 3);
  assert.equal(rssDocument.renderedView.children[1].type, "table");
  assert.deepEqual(rssDocument.renderedView.children[1].rows[0].record, {
    title: "First item",
    link: "https://example.com/first",
    description: "First summary",
    publishedAt: "Mon, 01 Apr 2024 10:00:00 GMT",
    id: "first-item"
  });

  const discussPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sessionId: "rss-web-session",
        activeCodocId: createdCodocId,
        selectedResourceId: "first-item",
        message: "这篇文章讲了什么？"
      })
    })
  );
  const discussMessage = discussPayload.events.find((event) => event.kind === "message");
  assert.ok(discussMessage, "Expected a message event from article discussion.");
  assert.match(discussMessage.content, /First item/);
  assert.match(discussMessage.content, /First summary/);
});

test("local service tears down stale watch streams across workspace lifecycle", async (t) => {
  const runtime = await buildRuntime();
  const workspaceA = await cloneExampleWorkspace("cobook-e2e-local-watch-a-");
  const workspaceB = await cloneExampleWorkspace("cobook-e2e-local-watch-b-");

  t.after(async () => {
    await Promise.all([cleanup(runtime, workspaceA), rm(workspaceB, { recursive: true, force: true })]);
  });

  const serviceModule = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );
  const { LocalCobookService } = serviceModule;

  const service = new LocalCobookService();

  await service.openWorkspace(workspaceA);
  const firstWatch = service.watch()[Symbol.asyncIterator]();
  const firstWatchDone = withTimeout(
    firstWatch.next(),
    3000,
    "Old workspace watch did not stop after opening a new workspace."
  );

  await sleep(250);
  await service.openWorkspace(workspaceB);

  assert.deepEqual(await firstWatchDone, {
    done: true,
    value: undefined
  });

  const secondWatch = service.watch()[Symbol.asyncIterator]();
  const secondWatchDone = withTimeout(
    secondWatch.next(),
    3000,
    "Workspace watch did not stop after closeWorkspace()."
  );

  await sleep(250);
  await service.closeWorkspace();

  assert.deepEqual(await secondWatchDone, {
    done: true,
    value: undefined
  });
});

test("rpc server manages multi-workspace session lifecycles", async (t) => {
  const runtime = await buildRuntime();
  const workspaceA = await cloneExampleWorkspace("cobook-e2e-session-a-");
  const workspaceB = await cloneExampleWorkspace("cobook-e2e-session-b-");

  t.after(async () => {
    await Promise.all([
      cleanup(runtime, workspaceA),
      rm(workspaceB, { recursive: true, force: true })
    ]);
  });

  const workspaceBUserPath = join(workspaceB, "user.codoc");
  const originalWorkspaceBUser = await readFile(workspaceBUserPath, "utf8");
  await writeFile(workspaceBUserPath, originalWorkspaceBUser.replace("Ada", "Lin"), "utf8");

  const serviceModule = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );
  const {
    LocalCobookService,
    RpcCobookService,
    createCobookRpcServer,
    createLoopbackServiceTransport
  } = serviceModule;

  const server = createCobookRpcServer({
    createService: () => new LocalCobookService()
  });
  const clientA1 = new RpcCobookService(createLoopbackServiceTransport(server));
  const clientA2 = new RpcCobookService(createLoopbackServiceTransport(server));
  const clientB = new RpcCobookService(createLoopbackServiceTransport(server));

  await clientA1.openWorkspace(workspaceA);
  await clientA2.openWorkspace(workspaceA);
  await clientB.openWorkspace(workspaceB);

  const workspaceAUserPath = join(workspaceA, "user.codoc");
  const originalWorkspaceAUser = await readFile(workspaceAUserPath, "utf8");
  await clientA1.writeCodoc({
    codocId: "user",
    filePath: "user.codoc",
    content: originalWorkspaceAUser.replace("Ada", "Grace"),
    overwrite: true
  });

  const resolvedSharedWorkspace = await clientA2.resolve("dashboard:data/currentUser");
  assert.deepEqual(resolvedSharedWorkspace.value, {
    name: "Grace",
    role: "editor"
  });

  const resolvedOtherWorkspace = await clientB.resolve("dashboard:data/currentUser");
  assert.deepEqual(resolvedOtherWorkspace.value, {
    name: "Lin",
    role: "editor"
  });

  await clientA1.closeWorkspace();
  await assert.rejects(clientA1.getWorkspace(), /Workspace is not open\./);

  const remainingLeaseStillWorks = await clientA2.resolve("dashboard:data/currentUser");
  assert.deepEqual(remainingLeaseStillWorks.value, {
    name: "Grace",
    role: "editor"
  });

  await clientA2.closeWorkspace();

  const clientA3 = new RpcCobookService(createLoopbackServiceTransport(server));
  await clientA3.openWorkspace(workspaceA);
  const reopenedWorkspace = await clientA3.resolve("dashboard:data/currentUser");
  assert.deepEqual(reopenedWorkspace.value, {
    name: "Grace",
    role: "editor"
  });

  await Promise.all([clientA3.closeWorkspace(), clientB.closeWorkspace()]);
});

test("rpc server serializes concurrent workspace mutations", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-concurrent-writes-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const serviceModule = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );
  const {
    LocalCobookService,
    RpcCobookService,
    createCobookRpcServer,
    createLoopbackServiceTransport
  } = serviceModule;

  let activeWrites = 0;
  let maxActiveWrites = 0;

  class InstrumentedLocalCobookService extends LocalCobookService {
    async writeCodoc(input) {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await sleep(50);

      try {
        return await super.writeCodoc(input);
      } finally {
        activeWrites -= 1;
      }
    }
  }

  const server = createCobookRpcServer({
    createService: () => new InstrumentedLocalCobookService()
  });
  const clientA = new RpcCobookService(createLoopbackServiceTransport(server));
  const clientB = new RpcCobookService(createLoopbackServiceTransport(server));

  await clientA.openWorkspace(workspace);
  await clientB.openWorkspace(workspace);

  await Promise.all([
    clientA.writeCodoc({
      codocId: "note-a",
      filePath: "notes/note-a.codoc",
      content: createNoteCodoc("note-a", "Note A", "Created by client A")
    }),
    clientB.writeCodoc({
      codocId: "note-b",
      filePath: "notes/note-b.codoc",
      content: createNoteCodoc("note-b", "Note B", "Created by client B")
    })
  ]);

  assert.equal(maxActiveWrites, 1);

  const codocs = await clientA.listCodocs();
  assert.ok(codocs.some((codoc) => codoc.id === "note-a"));
  assert.ok(codocs.some((codoc) => codoc.id === "note-b"));

  await Promise.all([clientA.closeWorkspace(), clientB.closeWorkspace()]);
});

test("local service rolls back failed writes", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-write-rollback-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const serviceModule = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );
  const { LocalCobookService } = serviceModule;

  const service = new LocalCobookService();
  await service.openWorkspace(workspace);

  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");

  await assert.rejects(
    service.writeCodoc({
      codocId: "dashboard",
      filePath: "user.codoc",
      content: [
        'codoc: "0.1"',
        'id: "dashboard"',
        "",
        "data:",
        "  currentUser:",
        '    $source: codoc',
        '    $ref: "./user.codoc#/data"'
      ].join("\n"),
      overwrite: true
    }),
    /Codoc id "dashboard" already exists at "dashboard\.codoc"\./
  );

  assert.equal(await readFile(userCodocPath, "utf8"), originalUserCodoc);

  const resolvedCurrentUser = await service.resolve("dashboard:data/currentUser");
  assert.deepEqual(resolvedCurrentUser.value, {
    name: "Ada",
    role: "editor"
  });

  await service.closeWorkspace();
});

test("chat write failures save a recovery draft and keep the workspace healthy", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-chat-recovery-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");
  const failingUpdate = [
    "update codoc dashboard at user.codoc",
    "```yaml",
    'codoc: "0.1"',
    'id: "dashboard"',
    "",
    "data:",
    "  currentUser:",
    '    $source: codoc',
    '    $ref: "./user.codoc#/data"',
    "```"
  ].join("\n");

  const failedChat = runCli(runtime, workspace, ["chat", failingUpdate]);
  assert.match(
    failedChat.stdout,
    /Failed to write "user\.codoc"\. Workspace changes were rolled back\./
  );
  assert.match(
    failedChat.stdout,
    /Codoc id "dashboard" already exists at "dashboard\.codoc"\./
  );

  const recoveryMatch = failedChat.stdout.match(/\[artifact\] (\.cobook\/recovery\/[^\n]+\.txt)/);
  assert.ok(recoveryMatch, `Expected recovery artifact in chat output.\n${failedChat.stdout}`);

  const recoveryFilePath = recoveryMatch[1];
  const recoveryDraft = await readFile(join(workspace, recoveryFilePath), "utf8");
  assert.match(recoveryDraft, /id: "dashboard"/);

  assert.equal(await readFile(userCodocPath, "utf8"), originalUserCodoc);

  const resolvedCurrentUser = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "dashboard:data/currentUser"]).stdout
  );
  assert.deepEqual(resolvedCurrentUser.value, {
    name: "Ada",
    role: "editor"
  });
});

test("rpc server shares workspace watch streams across clients", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-shared-watch-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const serviceModule = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );
  const {
    LocalCobookService,
    RpcCobookService,
    createCobookRpcServer,
    createLoopbackServiceTransport
  } = serviceModule;

  let watchStarts = 0;

  class InstrumentedLocalCobookService extends LocalCobookService {
    async *watch(signal) {
      watchStarts += 1;
      yield* super.watch(signal);
    }
  }

  const server = createCobookRpcServer({
    createService: () => new InstrumentedLocalCobookService()
  });
  const clientA = new RpcCobookService(createLoopbackServiceTransport(server));
  const clientB = new RpcCobookService(createLoopbackServiceTransport(server));

  await clientA.openWorkspace(workspace);
  await clientB.openWorkspace(workspace);

  const watchAController = new AbortController();
  const watchBController = new AbortController();
  const watchA = clientA.watch(watchAController.signal)[Symbol.asyncIterator]();
  const watchB = clientB.watch(watchBController.signal)[Symbol.asyncIterator]();
  const eventAPromise = withTimeout(
    watchA.next(),
    6000,
    "watch A did not receive a shared workspace event."
  );
  const eventBPromise = withTimeout(
    watchB.next(),
    6000,
    "watch B did not receive a shared workspace event."
  );

  await sleep(800);

  const userCodocPath = join(workspace, "user.codoc");
  const originalUserCodoc = await readFile(userCodocPath, "utf8");
  await writeFile(userCodocPath, originalUserCodoc.replace("Ada", "Grace"), "utf8");

  const [eventA, eventB] = await Promise.all([eventAPromise, eventBPromise]);

  assert.equal(watchStarts, 1);
  assert.equal(eventA.done, false);
  assert.equal(eventB.done, false);
  assert.deepEqual(eventA.value, eventB.value);
  assert.deepEqual(eventA.value.change, {
    kind: "updated",
    path: "user.codoc"
  });

  watchAController.abort();
  watchBController.abort();
  await Promise.all([
    withTimeout(clientA.closeWorkspace(), 6000, "client A failed to close its workspace session."),
    withTimeout(clientB.closeWorkspace(), 6000, "client B failed to close its workspace session.")
  ]);
});

test("http event stream closes cleanly after watch failure", async (t) => {
  const runtime = await buildRuntime();

  t.after(async () => {
    await cleanup(runtime);
  });

  const { createHttpRequestHandler } = await import(
    pathToFileURL(join(runtime.dir, "apps", "server", "src", "http-server.js")).href
  );

  const handler = createHttpRequestHandler(
    {
      async *watch() {
        throw new Error("Simulated watch failure.");
      }
    },
    join(repoRoot, "apps", "web", "public")
  );

  const request = createMockRequest({
    method: "GET",
    url: "/api/events"
  });
  const response = createMockResponse({
    stream: true
  });
  const finished = withTimeout(
    response.finished(),
    4000,
    "HTTP SSE response did not close after the watch failed."
  );

  handler(request, response);
  request.end();
  await finished;

  assert.equal(response.statusCode, 200);
  assert.equal(response.writableEnded, true);
  assert.match(response.body, /: connected/);
});

test("http chat normalizes pinned codoc context", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-pinned-context-");
  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await cleanup(runtime, workspace);
    await http.close();
  });

  const contextPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "show me the current context",
        pinnedCodocIds: ["user", "missing", "dashboard", "user"]
      })
    })
  );
  const contextMessage = contextPayload.events.find((event) => event.kind === "message");
  assert.ok(contextMessage, "Expected a message event from the chat response.");

  const contextBody = JSON.parse(contextMessage.content);
  assert.deepEqual(contextBody.context, {
    agentPinnedCodocIds: [],
    requestedPinnedCodocIds: ["user", "missing", "dashboard", "user"],
    pinnedCodocIds: ["dashboard", "user"],
    ignoredPinnedCodocIds: ["missing"],
    contextCodocIds: ["dashboard", "user"]
  });
  assert.deepEqual(
    contextBody.pinned.map((entry) => entry.codocId),
    ["dashboard", "user"]
  );

  parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message:
          "create note codoc pinned-context-note at notes/pinned-context-note.codoc about Normalize pinned context",
        pinnedCodocIds: ["user", "missing", "dashboard", "user"]
      })
    })
  );

  const contextNoteDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/pinned-context-note/document"
    })
  );
  assert.deepEqual(contextNoteDocument.resolvedData, {
    title: "Pinned Context Note",
    summary: "Normalize pinned context",
    relatedCodocs: ["dashboard", "user"]
  });
});

test("cli chat applies configured scene agents", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-cli-scene-agent-");
  const configPath = join(workspace, "cobook.yaml");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  await writeFile(
    join(workspace, "sources.codoc"),
    [
      'codoc: "0.1"',
      'id: "sources"',
      "",
      "data:",
      "  topics:",
      "    $source: static",
      "    value:",
      '      - "Ship notes"',
      '      - "Open questions"',
      "",
      "view: |",
      "  # Sources",
      "",
      "  {data.topics.0}",
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    configPath,
    [
      (await readFile(configPath, "utf8")).trimEnd(),
      "",
      "agents:",
      "  research:",
      '    name: "Research Scout"',
      '    description: "Draft research codocs from a focused scene context."',
      '    prompt: "Prefer sources, open questions, and unresolved risk."',
      "    pinnedCodocIds:",
      '      - "sources"',
      '    outputDir: "research"'
    ].join("\n") + "\n",
    "utf8"
  );

  const chat = runCli(runtime, workspace, [
    "--agent",
    "research",
    "chat",
    "create note codoc cli-market-scan about Validate cli scene agent"
  ]);
  assert.match(chat.stdout, /Used configured agent "research" \(Research Scout\)\./);
  assert.match(chat.stdout, /\[artifact\] research\/cli-market-scan\.codoc/);

  const document = parseJsonOutput(
    runCli(runtime, workspace, ["resolve", "cli-market-scan:data"]).stdout
  );
  assert.deepEqual(document.value, {
    title: "Cli Market Scan",
    summary: "Validate cli scene agent",
    relatedCodocs: ["sources", "dashboard", "user"]
  });
});

test("http chat applies configured scene agents", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-scene-agent-");
  const configPath = join(workspace, "cobook.yaml");
  const sourcesCodocPath = join(workspace, "sources.codoc");

  await writeFile(
    sourcesCodocPath,
    [
      'codoc: "0.1"',
      'id: "sources"',
      "",
      "data:",
      "  topics:",
      "    $source: static",
      "    value:",
      '      - "Ship notes"',
      '      - "Open questions"',
      "",
      "view: |",
      "  # Sources",
      "",
      "  {data.topics.0}",
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    configPath,
    [
      (await readFile(configPath, "utf8")).trimEnd(),
      "",
      "agents:",
      "  research:",
      '    name: "Research Scout"',
      '    description: "Draft research codocs from a focused scene context."',
      '    prompt: "Prefer sources, open questions, and unresolved risk."',
      "    pinnedCodocIds:",
      '      - "sources"',
      '    outputDir: "research"'
    ].join("\n") + "\n",
    "utf8"
  );

  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await cleanup(runtime, workspace);
    await http.close();
  });

  const contextPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "show me the current context",
        agentId: "research"
      })
    })
  );
  const contextMessage = contextPayload.events.find((event) => event.kind === "message");
  assert.ok(contextMessage, "Expected a message event from the scene agent response.");

  const contextBody = JSON.parse(contextMessage.content);
  assert.deepEqual(contextBody.activeAgent, {
    id: "research",
    name: "Research Scout",
    description: "Draft research codocs from a focused scene context.",
    prompt: "Prefer sources, open questions, and unresolved risk.",
    pinnedCodocIds: ["sources"],
    outputDir: "research"
  });
  assert.deepEqual(contextBody.context, {
    agentPinnedCodocIds: ["sources"],
    requestedPinnedCodocIds: [],
    pinnedCodocIds: ["sources"],
    ignoredPinnedCodocIds: [],
    contextCodocIds: ["sources", "dashboard", "user"]
  });

  const writePayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "create note codoc market-scan about Map the open questions",
        agentId: "research"
      })
    })
  );
  assert.ok(
    writePayload.events.some(
      (event) => event.kind === "artifact" && event.filePath === "research/market-scan.codoc"
    )
  );

  const marketScanDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/market-scan/document"
    })
  );
  assert.equal(marketScanDocument.codoc.filePath, "research/market-scan.codoc");
  assert.deepEqual(marketScanDocument.codoc.meta.agent, {
    id: "research",
    name: "Research Scout"
  });
  assert.deepEqual(marketScanDocument.resolvedData, {
    title: "Market Scan",
    summary: "Map the open questions",
    relatedCodocs: ["sources", "dashboard", "user"]
  });
});

test("http chat executes configured workflows", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-http-workflow-");
  const configPath = join(workspace, "cobook.yaml");

  await writeFile(
    join(workspace, "sources.codoc"),
    [
      'codoc: "0.1"',
      'id: "sources"',
      "",
      "data:",
      "  topics:",
      "    $source: static",
      "    value:",
      '      - "Ship notes"',
      '      - "Open questions"',
      "",
      "view: |",
      "  # Sources",
      "",
      "  {data.topics.0}",
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    configPath,
    [
      (await readFile(configPath, "utf8")).trimEnd(),
      "",
      "agents:",
      "  research:",
      '    name: "Research Scout"',
      "    pinnedCodocIds:",
      '      - "sources"',
      '    outputDir: "research"',
      "",
      "workflows:",
      "  market-digest:",
      '    name: "Market Digest"',
      '    description: "Review the latest market signals."',
      '    agent: "research"',
      "    pinnedCodocIds:",
      '      - "sources"',
      "    dataRefs:",
      '      sourceTopics: "sources:data/topics"',
      '      currentUser: "dashboard:data/currentUser"',
      '    outputDir: "digests"'
    ].join("\n") + "\n",
    "utf8"
  );

  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await cleanup(runtime, workspace);
    await http.close();
  });

  const listPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "list workflows"
      })
    })
  );
  const listMessage = listPayload.events.find((event) => event.kind === "message");
  assert.ok(listMessage, "Expected a message event from the workflow list response.");

  const workflowList = JSON.parse(listMessage.content);
  assert.deepEqual(workflowList.workflows, [
    {
      id: "market-digest",
      name: "Market Digest",
      description: "Review the latest market signals.",
      agentId: "research",
      pinnedCodocIds: ["sources"],
      dataRefs: {
        sourceTopics: "sources:data/topics",
        currentUser: "dashboard:data/currentUser"
      },
      outputDir: "digests"
    }
  ]);

  const writePayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "run workflow market-digest as april-digest"
      })
    })
  );
  assert.ok(
    writePayload.events.some(
      (event) => event.kind === "artifact" && event.filePath === "digests/april-digest.codoc"
    )
  );

  const digestDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/april-digest/document"
    })
  );
  assert.deepEqual(digestDocument.codoc.meta, {
    agent: {
      id: "research",
      name: "Research Scout"
    },
    workflow: {
      id: "market-digest",
      name: "Market Digest"
    }
  });
  assert.deepEqual(digestDocument.resolvedData, {
    title: "April Digest",
    summary: "Review the latest market signals.",
    relatedCodocs: ["sources", "dashboard", "user"],
    workflowInputs: {
      sourceTopics: ["Ship notes", "Open questions"],
      currentUser: {
        name: "Ada",
        role: "editor"
      }
    }
  });
});

test("workspace plugins contribute sources components and agents", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-plugin-");
  const configPath = join(workspace, "cobook.yaml");
  const pluginPath = join(workspace, "plugins", "research-plugin.yaml");
  const sourceServer = await createRssSourceServer();

  t.after(async () => {
    await Promise.all([cleanup(runtime, workspace), sourceServer.close()]);
  });

  await mkdir(join(workspace, "plugins"), { recursive: true });
  await writeFile(
    join(workspace, "sources.codoc"),
    [
      'codoc: "0.1"',
      'id: "sources"',
      "",
      "data:",
      "  status:",
      "    $source: static",
      '    value: "active"',
      "",
      "view: |",
      "  # Sources",
      "",
      "  {data.status}",
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    pluginPath,
    [
      'cobookPlugin: "0.1"',
      'name: "research-plugin"',
      "",
      "components:",
      "  researchHero:",
      '    $source: builtin',
      '    name: "hero"',
      "",
      "agents:",
      "  research:",
      '    name: "Plugin Research"',
      "    pinnedCodocIds:",
      '      - "sources"',
      "",
      "sources:",
      "  marketFeed:",
      '    $source: rss',
      `    url: "http://127.0.0.1:${sourceServer.port}/feed.xml"`,
      "    limit: 2",
      ""
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    configPath,
    [
      (await readFile(configPath, "utf8")).trimEnd(),
      "",
      "plugins:",
      '  - "./plugins/research-plugin.yaml"'
    ].join("\n") + "\n",
    "utf8"
  );

  await writeFile(
    join(workspace, "plugin-preset.codoc"),
    [
      'codoc: "0.1"',
      'id: "plugin-preset"',
      "",
      "data:",
      "  feed:",
      '    $source: preset',
      '    name: "marketFeed"',
      "",
      "view:",
      '  type: "stack"',
      "  children:",
      '    - type: "component"',
      '      component: "researchHero"',
      "      props:",
      '        title: "Plugin feed"',
      '        subtitle: "{data.feed.0.title}"',
      '    - type: "table"',
      "      columns:",
      '        - key: "title"',
      '        - key: "publishedAt"',
      '      rows: "{data.feed}"',
      ""
    ].join("\n"),
    "utf8"
  );

  const http = await createHttpHarness(runtime, workspace);

  t.after(async () => {
    await http.close();
  });

  const workspaceSnapshot = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/workspace"
    })
  );
  assert.deepEqual(workspaceSnapshot.componentRegistry.researchHero, {
    kind: "builtin",
    name: "hero"
  });
  assert.equal(workspaceSnapshot.config.agents.research.name, "Plugin Research");
  assert.equal(workspaceSnapshot.config.sources.marketFeed.kind, "rss");

  const agentPayload = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "list agents"
      })
    })
  );
  const agentMessage = agentPayload.events.find((event) => event.kind === "message");
  assert.ok(agentMessage, "Expected a message event from plugin agent listing.");
  assert.deepEqual(JSON.parse(agentMessage.content).agents, [
    {
      id: "research",
      name: "Plugin Research",
      pinnedCodocIds: ["sources"]
    }
  ]);

  const pluginDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/plugin-preset/document"
    })
  );
  assert.deepEqual(pluginDocument.resolvedData.feed, [
    {
      title: "First item",
      link: "https://example.com/first",
      description: "First summary",
      publishedAt: "Mon, 01 Apr 2024 10:00:00 GMT",
      id: "first-item"
    },
    {
      title: "Second item",
      link: "https://example.com/second",
      description: "Second summary",
      publishedAt: "Tue, 02 Apr 2024 11:30:00 GMT",
      id: "second-item"
    }
  ]);
  assert.equal(pluginDocument.renderedView.children[0].type, "component");
  assert.equal(pluginDocument.renderedView.children[0].source, "builtin");
  assert.equal(pluginDocument.renderedView.children[0].alias, "researchHero");
  assert.equal(pluginDocument.renderedView.children[0].component, "hero");

  const pluginChat = parseJsonBody(
    await http.request({
      method: "POST",
      url: "/api/chat",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "create note codoc plugin-note about Validate plugin agent context",
        agentId: "research"
      })
    })
  );
  assert.ok(
    pluginChat.events.some(
      (event) => event.kind === "artifact" && event.filePath === "plugin-note.codoc"
    )
  );
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
  assert.deepEqual(workspaceSnapshot.componentRegistry, {
    hero: {
      kind: "builtin",
      name: "hero"
    },
    profileHero: {
      kind: "local",
      path: "panels/hero-card"
    }
  });

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
  assert.equal(dashboardDocument.renderedView.type, "stack");
  assert.equal(dashboardDocument.renderedView.children[1].type, "grid");
  assert.equal(dashboardDocument.renderedView.children[1].columns, 2);
  assert.equal(dashboardDocument.renderedView.children[1].children[0].type, "component");
  assert.equal(dashboardDocument.renderedView.children[1].children[0].component, "hero");
  assert.equal(dashboardDocument.renderedView.children[1].children[0].props.subtitle, "Ada (editor)");
  assert.deepEqual(dashboardDocument.renderedView.children[1].children[1].value, {
    name: "Ada",
    role: "editor"
  });
  assert.equal(dashboardDocument.renderedView.children[2].type, "table");
  assert.deepEqual(dashboardDocument.renderedView.children[2].rows[0].cells, ["Name", "Ada"]);
  assert.deepEqual(dashboardDocument.renderedView.children[2].rows[1].cells, ["Role", "editor"]);

  const userDocument = parseJsonBody(
    await http.request({
      method: "GET",
      url: "/api/codocs/user/document"
    })
  );
  assert.equal(userDocument.renderedView.children[0].type, "section");
  assert.equal(userDocument.renderedView.children[0].eyebrow, "User");
  assert.equal(userDocument.renderedView.children[0].title, "Profile snapshot");
  assert.equal(userDocument.renderedView.children[0].children[0].type, "grid");
  assert.equal(userDocument.renderedView.children[0].children[0].children[0].type, "component");
  assert.equal(userDocument.renderedView.children[0].children[0].children[0].source, "local");
  assert.equal(
    userDocument.renderedView.children[0].children[0].children[0].component,
    "panels/hero-card"
  );
  assert.deepEqual(userDocument.renderedView.children[0].children[0].children[0].runtime, {
    kind: "local",
    path: "panels/hero-card"
  });
  assert.equal(userDocument.renderedView.children[0].children[0].children[0].props.title, "Ada");
  assert.equal(userDocument.renderedView.children[0].children[1].type, "table");
  assert.deepEqual(userDocument.renderedView.children[0].children[1].rows[1].cells, ["Role", "editor"]);
  assert.equal(userDocument.renderedView.children[1].type, "tabs");
  assert.equal(userDocument.renderedView.children[1].tabs[0].id, "runtimes");
  assert.equal(userDocument.renderedView.children[1].tabs[0].label, "Runtime components");
  assert.equal(userDocument.renderedView.children[1].tabs[0].children[0].type, "grid");
  assert.equal(userDocument.renderedView.children[1].tabs[0].children[0].children[0].source, "inline");
  assert.equal(userDocument.renderedView.children[1].tabs[0].children[0].children[0].runtime.kind, "inline");
  assert.deepEqual(userDocument.renderedView.children[1].tabs[0].children[0].children[0].propsSchema, {
    type: "object",
    properties: {
      eyebrow: {
        type: "string"
      },
      title: {
        type: "string"
      },
      subtitle: {
        type: "string"
      }
    },
    required: ["title"]
  });
  assert.match(
    userDocument.renderedView.children[1].tabs[0].children[0].children[0].runtime.code,
    /React\.createElement/
  );
  assert.equal(userDocument.renderedView.children[1].tabs[0].children[0].children[1].source, "remote");
  assert.deepEqual(userDocument.renderedView.children[1].tabs[0].children[0].children[1].runtime, {
    kind: "remote",
    url: "/components/remote-greeting.mjs",
    export: "RemoteGreeting"
  });
  assert.deepEqual(userDocument.renderedView.children[1].tabs[0].children[0].children[1].propsSchema, {
    type: "object",
    properties: {
      eyebrow: {
        type: "string"
      },
      title: {
        type: "string"
      },
      subtitle: {
        type: "string"
      }
    },
    required: ["title"]
  });
  assert.equal(userDocument.renderedView.children[1].tabs[1].id, "embeds");
  assert.equal(userDocument.renderedView.children[1].tabs[1].children[0].type, "component");
  assert.equal(userDocument.renderedView.children[1].tabs[1].children[0].source, "codoc");
  assert.deepEqual(userDocument.renderedView.children[1].tabs[1].children[0].runtime, {
    kind: "codoc",
    ref: "dashboard"
  });
  assert.deepEqual(userDocument.renderedView.children[1].tabs[1].children[0].propsSchema, {
    type: "object",
    properties: {}
  });
  assert.equal(userDocument.renderedView.children[2].type, "timeline");
  assert.equal(userDocument.renderedView.children[2].items[0].id, "joined");
  assert.equal(userDocument.renderedView.children[2].items[0].title, "Joined workspace");
  assert.equal(userDocument.renderedView.children[2].items[0].body, "Ada is active as editor.");
  assert.equal(userDocument.renderedView.children[2].items[1].title, "Runtime coverage");

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
    summary: "Validate web experience",
    relatedCodocs: ["dashboard", "user"]
  });
  assert.equal(webNoteDocument.renderedView.type, "stack");
  assert.equal(webNoteDocument.renderedView.children[0].type, "markdown");

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

  const watchResultPromise = watchForFirstEvent(runtime, workspace, "local");
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

test("rpc watch rebuilds after workspace change", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-rpc-watch-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const watchResultPromise = watchForFirstEvent(runtime, workspace, "rpc");
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
});

test("stdio watch rebuilds after workspace change", async (t) => {
  const runtime = await buildRuntime();
  const workspace = await cloneExampleWorkspace("cobook-e2e-stdio-watch-");

  t.after(async () => {
    await cleanup(runtime, workspace);
  });

  const watchResultPromise = watchForFirstEvent(runtime, workspace, "stdio");
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

  for (const pkg of ["yaml", "pg"]) {
    const packageDir = await findPackageDir(pkg);
    await symlink(packageDir, join(runtimeDir, "node_modules", pkg), "dir");
  }

  return {
    dir: runtimeDir,
    cliPath: join(runtimeDir, "apps", "cli", "src", "main.js"),
    serverPath: join(runtimeDir, "apps", "server", "src", "main.js")
  };
}

async function findPackageDir(packageName) {
  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  const entries = await readdir(pnpmDir);
  const packageEntry = entries.find((entry) => entry.startsWith(`${packageName}@`));
  assert.ok(packageEntry, `Could not locate ${packageName} package under node_modules/.pnpm.`);

  const packageDir = join(pnpmDir, packageEntry, "node_modules", packageName);
  assert.ok(existsSync(packageDir), `Resolved package path does not exist: ${packageDir}`);
  return packageDir;
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

async function watchForFirstEvent(runtime, workspace, transport = "local") {
  const child = spawn(
    process.execPath,
    [runtime.cliPath, "--transport", transport, "--root", workspace, "watch"],
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

function createNoteCodoc(codocId, title, summary) {
  return [
    'codoc: "0.1"',
    `id: "${codocId}"`,
    "",
    "data:",
    `  title: "${title}"`,
    `  summary: "${summary}"`,
    "",
    "view: |",
    `  # ${title}`,
    "",
    "  {data.summary}",
    ""
  ].join("\n");
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

async function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(message);
    })
  ]);
}

async function createHttpHarness(runtime, workspace) {
  const postgres = await getPostgresHarness();
  process.env.COBOOK_DATABASE_URL = postgres.connectionString;
  const { closeAllPostgresDatabases } = await import(
    pathToFileURL(join(runtime.dir, "packages", "service", "src", "index.js")).href
  );

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
      await service.closeWorkspace();
      await closeAllPostgresDatabases();
    }
  };
}

async function getPostgresHarness() {
  if (!postgresHarnessPromise) {
    postgresHarnessPromise = startPostgresHarness();
  }

  return postgresHarnessPromise;
}

async function startPostgresHarness() {
  const containerName = `cobook-test-postgres-${Date.now().toString(36)}`;
  const run = spawnSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish-all",
      "--env",
      "POSTGRES_DB=cobook_test",
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "postgres:15"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
  assert.equal(run.status, 0, `Failed to start PostgreSQL test container.\n${run.stderr}`);

  const portResult = spawnSync("docker", ["port", containerName, "5432/tcp"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    portResult.status,
    0,
    `Failed to discover PostgreSQL test port.\n${portResult.stderr}`
  );

  const published = portResult.stdout.trim();
  const hostPort = published.slice(published.lastIndexOf(":") + 1);
  assert.ok(hostPort.length > 0, `Unexpected docker port output: ${published}`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = spawnSync(
      "docker",
      ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "cobook_test"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    if (ready.status === 0) {
      await waitForTcpPort(hostPort);
      return {
        connectionString: `postgresql://postgres:postgres@127.0.0.1:${hostPort}/cobook_test`,
        async close() {
          spawnSync("docker", ["rm", "--force", containerName], {
            cwd: repoRoot,
            encoding: "utf8"
          });
        }
      };
    }
  }

  spawnSync("docker", ["rm", "--force", containerName], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  throw new Error("Timed out waiting for the PostgreSQL test container to become ready.");
}

async function waitForTcpPort(port) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({
        host: "127.0.0.1",
        port: Number.parseInt(port, 10)
      });

      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for PostgreSQL to accept host connections on port ${port}.`);
}

async function createSourceServer() {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/lookup.json") {
      response.writeHead(404, {
        "content-type": "application/json"
      });
      response.end(JSON.stringify({
        error: "Not found."
      }));
      return;
    }

    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }

    if (request.headers["x-cobook-auth"] !== "secret-token" || body !== '{"user":"ada"}') {
      response.writeHead(401, {
        "content-type": "application/json"
      });
      response.end(JSON.stringify({
        error: "Unauthorized."
      }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end(JSON.stringify({
      name: "Ada",
      role: "editor",
      source: "http"
    }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    port: address.port,
    close() {
      return new Promise((resolve, reject) => {
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

async function createRssSourceServer() {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/feed.xml") {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "content-type": "application/rss+xml; charset=utf-8"
    });
    response.end([
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<rss version=\"2.0\">",
      "  <channel>",
      "    <title>Example feed</title>",
      "    <item>",
      "      <title>First item</title>",
      "      <link>https://example.com/first</link>",
      "      <description><![CDATA[First summary]]></description>",
      "      <pubDate>Mon, 01 Apr 2024 10:00:00 GMT</pubDate>",
      "      <guid>first-item</guid>",
      "    </item>",
      "    <item>",
      "      <title>Second item</title>",
      "      <link>https://example.com/second</link>",
      "      <description>Second summary</description>",
      "      <pubDate>Tue, 02 Apr 2024 11:30:00 GMT</pubDate>",
      "      <guid>second-item</guid>",
      "    </item>",
      "    <item>",
      "      <title>Third item</title>",
      "      <link>https://example.com/third</link>",
      "      <description>Third summary</description>",
      "      <pubDate>Wed, 03 Apr 2024 09:15:00 GMT</pubDate>",
      "      <guid>third-item</guid>",
      "    </item>",
      "  </channel>",
      "</rss>"
    ].join("\n"));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    port: address.port,
    close() {
      return new Promise((resolve, reject) => {
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
  let headersSent = false;
  let writableEnded = false;
  let chunkBuffer = "";

  Object.defineProperty(stream, "headersSent", {
    configurable: true,
    get() {
      return headersSent;
    }
  });

  Object.defineProperty(stream, "writableEnded", {
    configurable: true,
    get() {
      return writableEnded;
    }
  });

  stream.writeHead = (statusCode, headers = {}) => {
    if (headersSent) {
      throw new Error("Cannot write headers after they are sent to the client.");
    }

    stream.statusCode = statusCode;
    stream.headers = {
      ...stream.headers,
      ...headers
    };
    headersSent = true;
    return stream;
  };

  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    headersSent = true;
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
      writableEnded = true;
      return originalEnd(undefined, undefined, resolvedCallback);
    }

    writableEnded = true;
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
