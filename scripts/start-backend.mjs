import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/cobook_dev";

async function main() {
  const parsed = parseArgs(argv.slice(2));
  const runtimeEnv = ensureDatabaseEnv(env);
  const runtimeDir = await prepareRuntimeDirectory(parsed.runtimeDir);
  const workspaceRoot = resolve(repoRoot, parsed.root);
  const staticRoot = resolve(repoRoot, "apps", "web", "public");
  const serverPath = join(runtimeDir, "apps", "server", "src", "main.js");

  stdout.write(`Building runtime into ${runtimeDir}\n`);
  buildRuntime(runtimeDir);
  await linkWorkspacePackages(runtimeDir);

  stdout.write(
    [
      "Starting Cobook Backend",
      `workspace: ${workspaceRoot}`,
      `api: http://${parsed.host}:${parsed.port}`
    ].join("\n") + "\n"
  );

  const child = spawn(
    process.execPath,
    [
      serverPath,
      "http",
      "--root",
      workspaceRoot,
      "--host",
      parsed.host,
      "--port",
      String(parsed.port),
      "--static-root",
      staticRoot
    ],
    {
      cwd: repoRoot,
      env: runtimeEnv,
      stdio: "inherit"
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      exit(1);
      return;
    }

    exit(code ?? 0);
  });
}

function ensureDatabaseEnv(currentEnv) {
  if (currentEnv.COBOOK_DATABASE_URL?.trim()) {
    return currentEnv;
  }

  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "dev-postgres.mjs"), "up"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("Failed to start the local PostgreSQL container.");
  }

  return {
    ...currentEnv,
    COBOOK_DATABASE_URL: DEFAULT_DATABASE_URL
  };
}

function parseArgs(rawArgv) {
  let root = "examples/hello-cobook";
  let host = "127.0.0.1";
  let port = 4310;
  let runtimeDir = join(tmpdir(), "cobook-http-runtime");

  for (let index = 0; index < rawArgv.length; index += 1) {
    const entry = rawArgv[index];
    if (!entry || entry === "--") {
      continue;
    }

    if (entry === "--root") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--root".');
      }

      root = next;
      index += 1;
      continue;
    }

    if (entry === "--host") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--host".');
      }

      host = next;
      index += 1;
      continue;
    }

    if (entry === "--port") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--port".');
      }

      const parsedPort = Number.parseInt(next, 10);
      if (Number.isNaN(parsedPort)) {
        throw new Error(`Invalid port "${next}".`);
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    if (entry === "--runtime-dir") {
      const next = rawArgv[index + 1];
      if (!next) {
        throw new Error('Missing value for "--runtime-dir".');
      }

      runtimeDir = resolve(cwd(), next);
      index += 1;
    }
  }

  return {
    root,
    host,
    port,
    runtimeDir
  };
}

function buildRuntime(runtimeDir) {
  const tscPath = join(repoRoot, "node_modules", ".bin", "tsc");
  const compile = spawnSync(
    tscPath,
    ["-p", "tsconfig.json", "--noEmit", "false", "--outDir", runtimeDir],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  if (compile.status === 0) {
    return;
  }

  throw new Error(
    [
      "TypeScript build failed.",
      compile.stdout ? `stdout:\n${compile.stdout}` : "",
      compile.stderr ? `stderr:\n${compile.stderr}` : ""
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

async function prepareRuntimeDirectory(runtimeDir) {
  await rm(runtimeDir, {
    recursive: true,
    force: true
  });
  await mkdir(runtimeDir, {
    recursive: true
  });
  await writeFile(join(runtimeDir, "package.json"), '{"type":"module"}\n', "utf8");
  return runtimeDir;
}

async function linkWorkspacePackages(runtimeDir) {
  const cobookNodeModulesDir = join(runtimeDir, "node_modules", "@cobook");
  await mkdir(cobookNodeModulesDir, {
    recursive: true
  });

  for (const pkg of ["core", "workspace", "service", "agent"]) {
    await symlink(join(runtimeDir, "packages", pkg, "src"), join(cobookNodeModulesDir, pkg), "dir");
  }

  for (const pkg of ["yaml", "pg"]) {
    const packageDir = await findPackageDir(pkg);
    await symlink(packageDir, join(runtimeDir, "node_modules", pkg), "dir");
  }
}

async function findPackageDir(packageName) {
  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  const entries = await readdir(pnpmDir);
  const packageEntry = entries.find((entry) => entry.startsWith(`${packageName}@`));
  if (!packageEntry) {
    throw new Error(`Could not locate "${packageName}" package under node_modules/.pnpm.`);
  }

  const packageDir = join(pnpmDir, packageEntry, "node_modules", packageName);
  if (!existsSync(packageDir)) {
    throw new Error(`Resolved package path does not exist: ${packageDir}`);
  }

  return packageDir;
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
