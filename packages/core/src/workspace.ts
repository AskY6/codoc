import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCodoc } from "./codoc-loader.js";
import { DataTree } from "./data-tree.js";
import { DAG } from "./dag.js";
import { DocRegistry, setDocRegistry } from "./doc-registry.js";
import { extractExternalDeps } from "./dep-extractor.js";
import { wireExternalDeps } from "./cross-doc-propagator.js";
import type { CodocFile, LoaderDeclaration } from "./types.js";

// --- Types ---

export interface FieldMeta {
  path: string;
  loaderType: LoaderDeclaration["type"];
  schema?: Record<string, unknown>;
  description?: string;
}

export interface DocMeta {
  docId: string;
  type: Record<string, unknown>;
  fields: FieldMeta[];
  externalRefs: Array<{ localPath: string; docRef: string; fieldPath: string }>;
}

export interface FieldAddress {
  docId: string;
  fieldPath: string;
}

export interface DepEdge {
  from: FieldAddress;
  to: FieldAddress;
}

export interface WorkspaceChangeEvent {
  docId: string;
  fieldPath: string;
  timestamp: number;
}

export interface CodocRuntime {
  tree: DataTree;
  dag: DAG;
}

type Unsubscribe = () => void;

// --- Workspace ---

export class Workspace {
  private dir: string;
  private index = new Map<string, DocMeta>();
  private parsed = new Map<string, CodocFile>();
  private registry = new DocRegistry();
  private changeListeners = new Set<(event: WorkspaceChangeEvent) => void>();
  private docUnsubs = new Map<string, Unsubscribe>();

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(dir: string): Promise<Workspace> {
    const ws = new Workspace(dir);
    await ws.scan();
    // Set global registry so externalLoader can resolve cross-doc refs
    setDocRegistry(ws.registry);
    return ws;
  }

  private async scan(): Promise<void> {
    const entries = await readdir(this.dir);
    const codocFiles = entries.filter((e) => e.endsWith(".codoc"));

    for (const filename of codocFiles) {
      const filepath = join(this.dir, filename);
      const content = await readFile(filepath, "utf-8");
      try {
        const codoc = parseCodoc(content);
        this.parsed.set(filename, codoc);
        this.index.set(filename, this.extractMeta(filename, codoc));
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  private extractMeta(docId: string, codoc: CodocFile): DocMeta {
    const tree = new DataTree({ type: codoc.type, data: codoc.data });
    const fields: FieldMeta[] = [];

    for (const path of tree.getAllPaths()) {
      const field = tree.getField(path)!;
      const propSchema = field.meta.schema;
      fields.push({
        path,
        loaderType: field.meta.loader.type,
        schema: propSchema,
        description:
          propSchema && typeof propSchema["description"] === "string"
            ? propSchema["description"]
            : undefined,
      });
    }

    const externalRefs = extractExternalDeps(tree);

    return { docId, type: codoc.type, fields, externalRefs };
  }

  // --- Public API ---

  listDocs(): DocMeta[] {
    return [...this.index.values()];
  }

  getDocMeta(docId: string): DocMeta | undefined {
    return this.index.get(docId);
  }

  getDependencyGraph(): { nodes: FieldAddress[]; edges: DepEdge[] } {
    const nodes: FieldAddress[] = [];
    const edges: DepEdge[] = [];
    const nodeSet = new Set<string>();

    const addNode = (docId: string, fieldPath: string) => {
      const key = `${docId}:${fieldPath}`;
      if (!nodeSet.has(key)) {
        nodeSet.add(key);
        nodes.push({ docId, fieldPath });
      }
    };

    // Collect all known fields as nodes
    for (const meta of this.index.values()) {
      for (const field of meta.fields) {
        addNode(meta.docId, field.path);
      }
    }

    // Cross-doc edges from external refs
    for (const meta of this.index.values()) {
      for (const ref of meta.externalRefs) {
        addNode(ref.docRef, ref.fieldPath); // proxy node if target not indexed
        edges.push({
          from: { docId: meta.docId, fieldPath: ref.localPath },
          to: { docId: ref.docRef, fieldPath: ref.fieldPath },
        });
      }
    }

    // Intra-doc edges (from $ref and $prompt template vars)
    for (const [docId, codoc] of this.parsed) {
      const tree = new DataTree({ type: codoc.type, data: codoc.data });
      const dag = DAG.buildFromTree(tree);
      for (const nodePath of dag.getNodes()) {
        for (const depPath of dag.getDirectDeps(nodePath)) {
          edges.push({
            from: { docId, fieldPath: nodePath },
            to: { docId, fieldPath: depPath },
          });
        }
      }
    }

    return { nodes, edges };
  }

  loadDoc(docId: string): CodocRuntime {
    const existing = this.registry.get(docId);
    if (existing) return existing;

    const codoc = this.parsed.get(docId);
    if (!codoc) {
      throw new Error(`Document not found in workspace: "${docId}"`);
    }

    const tree = new DataTree({ type: codoc.type, data: codoc.data });
    const dag = DAG.buildFromTree(tree);
    this.registry.register(docId, tree, dag);
    wireExternalDeps(this.registry, docId);

    // Per-field subscriptions for workspace-level change notifications
    const unsubs: Unsubscribe[] = [];
    for (const path of tree.getAllPaths()) {
      const unsub = tree.subscribeField(path, () => {
        const field = tree.getField(path);
        if (!field) return;
        const { status } = field.state;
        if (status === "resolved" || status === "dirty") {
          const event: WorkspaceChangeEvent = {
            docId,
            fieldPath: path,
            timestamp: Date.now(),
          };
          for (const cb of this.changeListeners) {
            cb(event);
          }
        }
      });
      unsubs.push(unsub);
    }
    this.docUnsubs.set(docId, () => {
      for (const u of unsubs) u();
    });

    return { tree, dag };
  }

  onFieldChange(
    callback: (event: WorkspaceChangeEvent) => void,
  ): Unsubscribe {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  getRegistry(): DocRegistry {
    return this.registry;
  }
}
