import { DataTree } from "@codoc/core";
import type { FieldError } from "@codoc/core";

// ─── Helpers ─────────────────────────────────────────────

function header(title: string) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(50)}`);
}

function printField(tree: DataTree, path: string) {
  const field = tree.getField(path);
  if (!field) {
    console.log(`  ${path} → (not found)`);
    return;
  }
  const { status } = field.state;
  if (status === "resolved") {
    console.log(`  ${path} → ${JSON.stringify(field.state.value)}`);
  } else {
    console.log(`  ${path} → [${status}]`);
  }
}

// ─── Demo 1: Basic literals + $ref ───────────────────────

async function demo1() {
  header("Demo 1: Literals + $ref");

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
  printField(tree, "/title");   // resolved (forced as dependency)
  printField(tree, "/count");   // still idle (never observed)
  printField(tree, "/summary"); // resolved
}

// ─── Demo 2: Nested 3-level tree + cross-refs ───────────

async function demo2() {
  header("Demo 2: Nested tree + cross-references");

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

// ─── Demo 3: Cycle detection ────────────────────────────

async function demo3() {
  header("Demo 3: Cycle detection");

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

// ─── Demo 4: Schema validation error ────────────────────

async function demo4() {
  header("Demo 4: Schema validation");

  const tree = new DataTree({
    type: {
      properties: {
        name: { type: "string" },
        score: { type: "number" },
      },
    },
    data: {
      name: "Alice",
      score: "not-a-number",  // type mismatch!
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

// ─── Demo 5: Laziness proof ─────────────────────────────

async function demo5() {
  header("Demo 5: Laziness — only observed fields are forced");

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

// ─── Run all ─────────────────────────────────────────────

async function main() {
  console.log("🔬 CoDoc M0 — Codata Kernel Playground\n");

  await demo1();
  await demo2();
  await demo3();
  await demo4();
  await demo5();

  console.log(`\n${"═".repeat(50)}`);
  console.log("  All demos complete.");
  console.log(`${"═".repeat(50)}\n`);
}

main().catch(console.error);
