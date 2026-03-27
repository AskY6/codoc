import { run as m0Literals } from "./demos/m0-literals.js";
import { run as m0Nested } from "./demos/m0-nested.js";
import { run as m0Cycle } from "./demos/m0-cycle.js";
import { run as m0Validation } from "./demos/m0-validation.js";
import { run as m0Laziness } from "./demos/m0-laziness.js";
import { run as m1Dag } from "./demos/m1-dag.js";
import { run as m1CycleStatic } from "./demos/m1-cycle-static.js";
import { run as m1Dirty } from "./demos/m1-dirty.js";
import { run as m1Visual } from "./demos/m1-visual.js";

const demos: Record<string, { milestone: string; run: () => Promise<void> }> = {
  "m0-literals":      { milestone: "m0", run: m0Literals },
  "m0-nested":        { milestone: "m0", run: m0Nested },
  "m0-cycle":         { milestone: "m0", run: m0Cycle },
  "m0-validation":    { milestone: "m0", run: m0Validation },
  "m0-laziness":      { milestone: "m0", run: m0Laziness },
  "m1-dag":           { milestone: "m1", run: m1Dag },
  "m1-cycle-static":  { milestone: "m1", run: m1CycleStatic },
  "m1-dirty":         { milestone: "m1", run: m1Dirty },
  "m1-visual":        { milestone: "m1", run: m1Visual },
};

function printUsage() {
  console.log("Usage: pnpm start [filter]\n");
  console.log("Filters:");
  console.log("  (none)    Run all demos");
  console.log("  m0        Run all M0 demos");
  console.log("  m1        Run all M1 demos");
  console.log("  <name>    Run a specific demo\n");
  console.log("Available demos:");
  for (const [name, { milestone }] of Object.entries(demos)) {
    console.log(`  ${name.padEnd(20)} (${milestone})`);
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const filter = args[0];

  if (filter === "--help" || filter === "-h") {
    printUsage();
    return;
  }

  let selected: [string, () => Promise<void>][];

  if (!filter) {
    selected = Object.entries(demos).map(([name, d]) => [name, d.run]);
  } else if (filter === "m0" || filter === "m1") {
    selected = Object.entries(demos)
      .filter(([, d]) => d.milestone === filter)
      .map(([name, d]) => [name, d.run]);
  } else if (demos[filter]) {
    selected = [[filter, demos[filter].run]];
  } else {
    console.error(`Unknown filter: "${filter}"\n`);
    printUsage();
    process.exit(1);
    return;
  }

  console.log(`CoDoc Playground — running ${selected.length} demo(s)\n`);

  for (const [, run] of selected) {
    await run();
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("  Done.");
  console.log(`${"═".repeat(50)}\n`);
}

main().catch(console.error);
