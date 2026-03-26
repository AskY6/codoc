import { DataTree } from "@codoc/core";
import type { FieldError } from "@codoc/core";
import { header } from "../helpers.js";

export async function run() {
  header("M0 · Schema validation");

  const tree = new DataTree({
    type: {
      properties: {
        name: { type: "string" },
        score: { type: "number" },
      },
    },
    data: {
      name: "Alice",
      score: "not-a-number",
    },
  });

  console.log("\nObserving /name (valid string)...");
  const name = await tree.observe("/name");
  console.log(`  Result: ${JSON.stringify(name)}`);

  console.log("\nObserving /score (string where number expected)...");
  try {
    await tree.observe("/score");
  } catch (err) {
    const e = err as FieldError;
    console.log(`  Caught: [${e.kind}] ${e.message}`);
  }
}
