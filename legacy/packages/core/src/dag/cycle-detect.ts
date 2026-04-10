import type { DAG } from "./dag.js";

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * Detect all cycles in the DAG using DFS colouring.
 * Returns an array of cycles, where each cycle is a list of nodeIds
 * forming the loop (first and last element are the same).
 */
export function detectCycles(dag: DAG): string[][] {
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  for (const id of dag.nodes.keys()) {
    color.set(id, WHITE);
  }

  function dfs(id: string): void {
    color.set(id, GRAY);
    stack.push(id);

    for (const dep of dag.dependencies.get(id) ?? []) {
      const c = color.get(dep);
      if (c === undefined) continue; // external node — not in graph

      if (c === GRAY) {
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start);
        cycle.push(dep);
        cycles.push(cycle);
      } else if (c === WHITE) {
        dfs(dep);
      }
    }

    stack.pop();
    color.set(id, BLACK);
  }

  for (const id of dag.nodes.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}
