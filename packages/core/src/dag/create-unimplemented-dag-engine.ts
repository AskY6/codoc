import type { ParsedCodoc } from "../parser/types.js";
import type { ResolveOptions } from "../runtime/types.js";

import type {
  BuildResult,
  DagEngine,
  DagNode,
  GraphSnapshot,
  InvalidationResult,
  ResolvedValue
} from "./types.js";

function notImplemented(method: string): never {
  throw new Error(`DagEngine.${method} is not implemented yet.`);
}

function emptyBuildResult(): BuildResult {
  return {
    success: false,
    errors: [
      {
        code: "parse",
        message: "DagEngine is not implemented yet."
      }
    ],
    affectedNodes: []
  };
}

export function createUnimplementedDagEngine(): DagEngine {
  return {
    build(_codocs: ParsedCodoc[]): BuildResult {
      return emptyBuildResult();
    },
    rebuildCodoc(_codoc: ParsedCodoc): BuildResult {
      return emptyBuildResult();
    },
    getNode(_node): DagNode | null {
      return null;
    },
    getDeps(_node) {
      return [];
    },
    getDependents(_node) {
      return [];
    },
    resolve(_node, _opts?: ResolveOptions): Promise<ResolvedValue> {
      notImplemented("resolve");
    },
    invalidate(_node): InvalidationResult {
      return {
        dirtiedNodes: []
      };
    },
    snapshot(): GraphSnapshot {
      return {
        nodes: [],
        edges: []
      };
    }
  };
}
