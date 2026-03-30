import { DataTree } from "@codoc/core";
import { propagateDirty } from "@codoc/graph";
import { buildDAGFromTree, propagateAndInvalidate } from "@cobook/workspace";
import { header, printField } from "../helpers.js";

export async function run() {
  header("M1 · Dirty propagation");

  const tree = new DataTree({
    type: {
      properties: {
        price: { type: "number" },
        tax: { type: "number" },
        total: { type: "number" },
        independent: { type: "string" },
      },
    },
    data: {
      price: 100,
      tax: { $ref: "/price" },
      total: { $ref: "/tax" },
      independent: "I am unrelated",
    },
  });

  // Force all fields
  for (const path of tree.getAllPaths()) {
    try { await tree.observe(path); } catch {}
  }

  console.log("\nAll fields resolved:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }

  const dag = buildDAGFromTree(tree);

  console.log("\nGraphviz DOT (before dirty propagation):");
  console.log(dag.toDot({ title: "Before dirty" }));

  console.log("\nSimulating change to /price...");
  console.log("Propagating dirty downstream:");
  const dirtyPaths = propagateDirty(dag, ["/price"]);
  console.log(`  Dirty set (topo order): [${dirtyPaths.join(", ")}]`);

  propagateAndInvalidate(dag, tree, ["/price"]);

  console.log("\nGraphviz DOT (dirty nodes highlighted in red):");
  console.log(dag.toDot({ title: "After dirty", highlightDirty: dirtyPaths }));

  console.log("\nField states after propagation:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }

  console.log("\nRe-observing dirty fields...");
  for (const path of dirtyPaths) {
    const val = await tree.observe(path);
    console.log(`  ${path} → ${JSON.stringify(val)}`);
  }

  console.log("\nAll fields after re-observation:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }
}
