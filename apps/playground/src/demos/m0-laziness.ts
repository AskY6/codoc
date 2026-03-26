import { DataTree } from "@codoc/core";
import { header, printField } from "../helpers.js";

export async function run() {
  header("M0 · Laziness — only observed fields are forced");

  const tree = new DataTree({
    type: {
      properties: {
        field_a: { type: "string" },
        field_b: { type: "string" },
        field_c: { type: "string" },
        field_d: { type: "string" },
      },
    },
    data: {
      field_a: "I will be observed",
      field_b: { $ref: "/field_a" },
      field_c: "I will NOT be observed",
      field_d: "Me neither",
    },
  });

  console.log("\nBefore any observation:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }

  await tree.observe("/field_b");

  console.log("\nAfter observing only /field_b:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }
}
