import { DataTree } from "@codoc/core";
import type { FieldError } from "@codoc/core";
import { header } from "../helpers.js";

export async function run() {
  header("M0 · Cycle detection (runtime)");

  const tree = new DataTree({
    type: {
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
      },
    },
    data: {
      a: { $ref: "/b" },
      b: { $ref: "/c" },
      c: { $ref: "/a" },
    },
  });

  console.log("\nObserving /a (cycle: /a → /b → /c → /a)...");
  try {
    await tree.observe("/a");
  } catch (err) {
    const e = err as FieldError;
    console.log(`  Caught: [${e.kind}] ${e.message}`);
    if (e.kind === "cyclic_ref") {
      console.log(`  Cycle path: ${e.cycle.join(" → ")}`);
    }
  }
}
