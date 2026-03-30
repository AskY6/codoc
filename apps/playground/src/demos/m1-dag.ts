import { DataTree } from "@codoc/core";
import { topoSort, topoLayers } from "@codoc/graph";
import { buildDAGFromTree } from "@cobook/workspace";
import { header } from "../helpers.js";

export async function run() {
  header("M1 · DAG construction + topological layers");

  const tree = new DataTree({
    type: {
      properties: {
        source: { type: "string" },
        derived_a: { type: "string" },
        derived_b: { type: "string" },
        combined: { type: "string" },
      },
    },
    data: {
      source: "origin",
      derived_a: { $ref: "/source" },
      derived_b: { $ref: "/source" },
      combined: { $ref: "/derived_a" },
    },
  });

  const dag = buildDAGFromTree(tree);

  console.log("\nDAG nodes:", dag.getNodes().sort());
  console.log("\nDependency edges:");
  for (const node of dag.getNodes().sort()) {
    const deps = dag.getDirectDeps(node);
    const dependents = dag.getDependents(node);
    console.log(`  ${node}`);
    if (deps.length) console.log(`    depends on: ${deps.join(", ")}`);
    if (dependents.length) console.log(`    depended by: ${dependents.join(", ")}`);
  }

  console.log("\nTopological sort:", topoSort(dag));

  const layers = topoLayers(dag);
  console.log("\nTopological layers (parallel groups):");
  layers.forEach((layer, i) => {
    console.log(`  Layer ${i}: [${layer.join(", ")}]`);
  });

  console.log("\nGraphviz DOT output (paste into https://dreampuf.github.io/GraphvizOnline):");
  console.log(dag.toDot({ title: "M1 — DAG" }));
}
