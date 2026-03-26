import { DataTree, DAG } from "@codoc/core";
import { header } from "../helpers.js";

export async function run() {
  header("M1 · Static cycle detection (before any force)");

  const tree = new DataTree({
    type: {
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
        safe: { type: "number" },
      },
    },
    data: {
      a: { $ref: "/b" },
      b: { $ref: "/c" },
      c: { $ref: "/a" },
      safe: 42,
    },
  });

  const dag = DAG.buildFromTree(tree);
  const cycle = dag.detectCycle();

  if (cycle) {
    console.log(`\n  Cycle detected (without forcing any fields)!`);
    console.log(`  Kind: ${cycle.kind}`);
    console.log(`  Path: ${cycle.cycle.join(" → ")}`);
    console.log(`  Message: ${cycle.message}`);
  } else {
    console.log("\n  No cycle detected.");
  }
}
