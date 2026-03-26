import { DataTree } from "@codoc/core";
import { header, printField } from "../helpers.js";

export async function run() {
  header("M0 · Nested tree + cross-references");

  const tree = new DataTree({
    type: {
      properties: {
        user: {
          type: "object",
          properties: {
            profile: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
            },
          },
        },
        greeting: { type: "string" },
        bio: { type: "string" },
      },
    },
    data: {
      user: {
        profile: {
          name: "Alice",
          age: 30,
        },
      },
      greeting: { $ref: "/user/profile/name" },
      bio: { $ref: "/greeting" },
    },
  });

  console.log("\nAll fields:", tree.getAllPaths());

  console.log("\nObserving /bio (chain: /bio → /greeting → /user/profile/name)...");
  const bio = await tree.observe("/bio");
  console.log(`  Result: ${JSON.stringify(bio)}`);

  console.log("\nField states after observe:");
  for (const path of tree.getAllPaths()) {
    printField(tree, path);
  }
}
