import { defineConfig } from "tsup";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Plugin } from "esbuild";

/**
 * Resolves `raw:./path/to/File.tsx` imports to the file's text content.
 * The .tsx files are real files with full editor support; this plugin
 * inlines them as strings at build time.
 */
const rawImportPlugin: Plugin = {
  name: "raw-import",
  setup(build) {
    // Resolve raw: imports relative to the importer
    build.onResolve({ filter: /^raw:/ }, (args) => {
      const filePath = args.path.slice("raw:".length);
      const resolved = resolve(dirname(args.importer), filePath);
      return { path: resolved, namespace: "raw" };
    });

    // Load as text
    build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => {
      const src = await readFile(args.path, "utf-8");
      return { contents: `export default ${JSON.stringify(src)};`, loader: "ts" };
    });
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  esbuildPlugins: [rawImportPlugin],
});
