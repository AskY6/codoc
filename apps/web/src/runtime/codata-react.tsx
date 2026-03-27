import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  Suspense,
  type ReactNode,
} from "react";
import type { DataTree, DAG, FieldState } from "@codoc/core";
import { getDocRegistry } from "@codoc/core";

// --- Context ---

interface CodataContextValue {
  tree: DataTree;
  dag: DAG;
}

const CodataContext = createContext<CodataContextValue | null>(null);

export function CodataProvider({
  tree,
  dag,
  children,
}: {
  tree: DataTree;
  dag: DAG;
  children: ReactNode;
}) {
  return (
    <CodataContext.Provider value={{ tree, dag }}>
      {children}
    </CodataContext.Provider>
  );
}

function useCodataContext(): CodataContextValue {
  const ctx = useContext(CodataContext);
  if (!ctx) throw new Error("useCodata must be used within a CodataProvider");
  return ctx;
}

// --- Safe promise cache for Suspense ---

const safePromises = new WeakMap<Promise<unknown>, Promise<unknown>>();

function makeSafe(p: Promise<unknown>): Promise<unknown> {
  let safe = safePromises.get(p);
  if (!safe) {
    safe = p.then(
      () => {},
      () => {},
    );
    safePromises.set(p, safe);
  }
  return safe;
}

// --- Hook ---

const IDLE_STATE: FieldState<unknown> = { status: "idle" };

/**
 * Subscribe to a codata field. Returns the resolved value.
 * Suspends (throws Promise) if the field is not yet resolved.
 * Throws FieldError if the field errored.
 */
export function useCodata(path: string): unknown {
  const { tree } = useCodataContext();

  const subscribe = useCallback(
    (cb: () => void) => tree.subscribeField(path, cb),
    [tree, path],
  );

  const getSnapshot = useCallback(
    () => tree.getField(path)?.state ?? IDLE_STATE,
    [tree, path],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot);

  if (state.status === "resolved") return state.value;
  if (state.status === "error") throw state.error;

  // idle, dirty, or pending — trigger force and suspend
  throw makeSafe(tree.observe(path));
}

/**
 * Read the TTL (in seconds) for a field. Follows external refs to the target field.
 * Returns null if the field is not a $source or has no TTL.
 */
export function useFieldTTL(fieldName: string): number | null {
  const { tree } = useCodataContext();
  const path = fieldName.startsWith("/") ? fieldName : "/" + fieldName;
  const field = tree.getField(path);
  if (!field) return null;

  const decl = field.meta.loader;
  if (decl.type === "source" && decl.ttl) return decl.ttl;

  if (decl.type === "external") {
    const registry = getDocRegistry();
    const targetField = registry?.get(decl.docRef)?.tree.getField(decl.fieldPath);
    if (targetField?.meta.loader.type === "source" && targetField.meta.loader.ttl) {
      return targetField.meta.loader.ttl;
    }
  }

  return null;
}

// --- CodataValue component for use in MDX ---

function CodataValueInner({ path }: { path: string }) {
  const value = useCodata(path);
  const display =
    typeof value === "object" && value !== null
      ? JSON.stringify(value, null, 2)
      : String(value);
  return <>{display}</>;
}

export function CodataValue({ path }: { path: string }) {
  return (
    <Suspense fallback={<span className="field-loading">⏳</span>}>
      <CodataValueInner path={path} />
    </Suspense>
  );
}
