import { DataTree } from "@codoc/core";
import { header, printField } from "../helpers.js";

export async function run() {
  header("M0 · Literals + $ref");

  const tree = new DataTree({
    type: {
      properties: {
        title: { type: "string" },
        count: { type: "number" },
        summary: { type: "string" },
      },
    },
    data: {
      title: "Hello CoDoc",
      count: 42,
      summary: { $ref: "/title" },
    },
  });

  console.log("\nAll fields:", tree.getAllPaths());
  console.log("\nBefore observe (all idle):");
  printField(tree, "/title");
  printField(tree, "/count");
  printField(tree, "/summary");

  console.log("\nObserving /summary (which $ref → /title)...");
  const summary = await tree.observe("/summary");
  console.log(`  Result: ${JSON.stringify(summary)}`);

  console.log("\nAfter observe:");
  printField(tree, "/title");
  printField(tree, "/count");
  printField(tree, "/summary");
}
