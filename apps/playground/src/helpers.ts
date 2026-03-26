import type { DataTree } from "@codoc/core";

export function header(title: string) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(50)}`);
}

export function printField(tree: DataTree, path: string) {
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
