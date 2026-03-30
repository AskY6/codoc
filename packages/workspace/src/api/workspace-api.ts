import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DataTree, getComponentsMeta, getComponentsBody } from "@codoc/core";
import { DAG } from "@codoc/graph";
import { parseCodoc } from "../lifecycle/codoc-factory.js";
import { DocRegistry, setDocRegistry } from "../lifecycle/instance-store.js";
import { extractExternalDeps } from "../lifecycle/dep-extractor.js";
import { wireExternalDeps } from "../lifecycle/manager.js";
import { buildDAGFromTree } from "../wiring/bootstrap.js";
import { WatchOrchestrator } from "../watch/orchestrator.js";
import { ingestDirectory, type IngestResult } from "../skill/ingest.js";
import type { Skill } from "../skill/types.js";
import { getSkill, registerSkill } from "../skill/registry.js";
import { claudeCodeLogSkill } from "../skill/claude-code-log.js";
import type { CodocFile } from "@codoc/core";
import { ComponentLibrary } from "../component-library/library.js";
import type {
  FieldMeta,
  DocMeta,
  FieldAddress,
  DepEdge,
  WorkspaceChangeEvent,
  CodocRuntime,
} from "./types.js";

type Unsubscribe = () => void;

export class Workspace {
  private dir: string;
  private index = new Map<string, DocMeta>();
  private parsed = new Map<string, CodocFile>();
  private registry = new DocRegistry();
  private changeListeners = new Set<(event: WorkspaceChangeEvent) => void>();
  private docUnsubs = new Map<string, Unsubscribe>();
  private ingestions: IngestResult[] = [];
  private componentLibrary = new ComponentLibrary();

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(dir: string): Promise<Workspace> {
    const ws = new Workspace(dir);
    await ws.scan();
    setDocRegistry(ws.registry);
    // Register built-in skills
    registerSkill(claudeCodeLogSkill);
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
    const componentsMeta = getComponentsMeta(codoc);
    const componentsBody = getComponentsBody(codoc);

    return {
      docId,
      type: codoc.type,
      fields,
      externalRefs,
      componentsMeta: Object.keys(componentsMeta).length > 0 ? componentsMeta : undefined,
      componentsBody: Object.keys(componentsBody).length > 0 ? componentsBody : undefined,
    };
  }

  // --- Public API ---

  listDocs(): DocMeta[] {
    return [...this.index.values()];
  }

  getDocMeta(docId: string): DocMeta | undefined {
    return this.index.get(docId);
  }

  getRawDoc(docId: string): CodocFile | undefined {
    return this.parsed.get(docId);
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

    for (const meta of this.index.values()) {
      for (const field of meta.fields) {
        addNode(meta.docId, field.path);
      }
    }

    for (const meta of this.index.values()) {
      for (const ref of meta.externalRefs) {
        addNode(ref.docRef, ref.fieldPath);
        edges.push({
          from: { docId: meta.docId, fieldPath: ref.localPath },
          to: { docId: ref.docRef, fieldPath: ref.fieldPath },
        });
      }
    }

    for (const [docId, codoc] of this.parsed) {
      const tree = new DataTree({ type: codoc.type, data: codoc.data });
      const dag = buildDAGFromTree(tree);
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
    const dag = buildDAGFromTree(tree);
    this.registry.register(docId, tree, dag);

    const meta = this.index.get(docId);
    if (meta) {
      for (const ref of meta.externalRefs) {
        if (!this.registry.has(ref.docRef) && this.parsed.has(ref.docRef)) {
          this.loadDoc(ref.docRef);
        }
      }
    }

    wireExternalDeps(this.registry, docId);

    const unsubs: Unsubscribe[] = [];
    for (const path of tree.getAllPaths()) {
      const unsub = tree.subscribeField(path, () => {
        const field = tree.getField(path);
        if (!field) return;
        const { status } = field.state;
        if (status === "resolved" || status === "dirty" || status === "error") {
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

  async createDoc(docId: string, yamlContent: string): Promise<DocMeta> {
    if (!docId.endsWith(".codoc")) {
      throw new Error(`Invalid docId: must end with .codoc`);
    }
    if (docId.includes("/") || docId.includes("\\")) {
      throw new Error(`Invalid docId: must not contain path separators`);
    }
    if (this.index.has(docId)) {
      throw new Error(`Document already exists: "${docId}"`);
    }

    const codoc = parseCodoc(yamlContent);
    await writeFile(join(this.dir, docId), yamlContent, "utf-8");
    this.parsed.set(docId, codoc);
    const meta = this.extractMeta(docId, codoc);
    this.index.set(docId, meta);
    return meta;
  }

  async rewriteDoc(docId: string, yamlContent: string): Promise<DocMeta> {
    if (!this.index.has(docId)) {
      throw new Error(`Document not found: "${docId}"`);
    }

    const codoc = parseCodoc(yamlContent);

    if (this.registry.has(docId)) {
      const unsub = this.docUnsubs.get(docId);
      if (unsub) {
        unsub();
        this.docUnsubs.delete(docId);
      }
      this.registry.unregister(docId);
    }

    await writeFile(join(this.dir, docId), yamlContent, "utf-8");
    this.parsed.set(docId, codoc);
    const meta = this.extractMeta(docId, codoc);
    this.index.set(docId, meta);
    return meta;
  }

  async rescan(): Promise<string[]> {
    const entries = await readdir(this.dir);
    const codocFiles = entries.filter((e) => e.endsWith(".codoc"));
    const added: string[] = [];

    for (const filename of codocFiles) {
      if (this.index.has(filename)) continue;
      const filepath = join(this.dir, filename);
      const content = await readFile(filepath, "utf-8");
      try {
        const codoc = parseCodoc(content);
        this.parsed.set(filename, codoc);
        this.index.set(filename, this.extractMeta(filename, codoc));
        added.push(filename);
      } catch {
        // Skip files that fail to parse
      }
    }

    return added;
  }

  /**
   * Ingest an external directory using a skill.
   * Scans for matching files, creates codoc instances, starts watchers.
   * Returns the list of created docIds.
   */
  async ingestSkillDirectory(
    dirPath: string,
    skill: Skill,
  ): Promise<string[]> {
    const orchestrator = new WatchOrchestrator(this.registry);

    // Bridge orchestrator events to workspace change listeners
    orchestrator.onEvent((event) => {
      if (event.kind === "source_changed" && event.fieldPath) {
        const wsEvent: WorkspaceChangeEvent = {
          docId: event.docId,
          fieldPath: event.fieldPath,
          timestamp: Date.now(),
        };
        for (const cb of this.changeListeners) {
          cb(wsEvent);
        }
      }
    });

    const result = await ingestDirectory(
      dirPath,
      skill,
      this.registry,
      orchestrator,
    );
    this.ingestions.push(result);

    // Register ingested docs into the workspace index
    for (const docId of result.docIds) {
      const entry = this.registry.get(docId);
      if (!entry) continue;

      const codoc = skill.mapToCodoc(
        "", // path not needed for meta extraction
        docId.replace(/^session-/, "").replace(/\.codoc$/, "") + skill.extension,
      );
      this.parsed.set(docId, codoc);
      this.index.set(docId, this.extractMeta(docId, codoc));

      // Wire change listeners for each field
      const unsubs: Unsubscribe[] = [];
      for (const path of entry.tree.getAllPaths()) {
        const unsub = entry.tree.subscribeField(path, () => {
          const field = entry.tree.getField(path);
          if (!field) return;
          const { status } = field.state;
          if (status === "resolved" || status === "dirty" || status === "error") {
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
    }

    return result.docIds;
  }

  /**
   * Ingest a directory using a skill name (resolved from skill registry).
   */
  async ingestBySkillName(
    skillName: string,
    dirPath: string,
  ): Promise<string[]> {
    const skill = getSkill(skillName);
    if (!skill) {
      throw new Error(`Unknown skill: "${skillName}". Register it first.`);
    }
    return this.ingestSkillDirectory(dirPath, skill);
  }

  getRegistry(): DocRegistry {
    return this.registry;
  }

  /** Return the JSON Schema (type definition) for a codoc */
  getDocSchema(docId: string): Record<string, unknown> | undefined {
    const meta = this.index.get(docId);
    return meta?.type;
  }

  /** Return the current data snapshot for a loaded codoc */
  getDocData(docId: string): Record<string, unknown> | undefined {
    const entry = this.registry.get(docId);
    if (!entry) return undefined;
    const result: Record<string, unknown> = {};
    for (const path of entry.tree.getAllPaths()) {
      const field = entry.tree.getField(path);
      if (field && "value" in field.state) {
        result[path] = field.state.value;
      }
    }
    return result;
  }

  /** Get the workspace-level component library */
  getComponentLibrary(): ComponentLibrary {
    return this.componentLibrary;
  }
}
