import type { ComponentSignature, ComponentsMeta } from "@codoc/core";
import { extractComponentUsages } from "@codoc/core";

export type BreakingChangeKind =
  | "prop_removed"
  | "prop_type_changed"
  | "prop_added_required";

export interface SignatureChange {
  kind: BreakingChangeKind | "prop_added_optional" | "description_changed";
  prop?: string;
  message: string;
  breaking: boolean;
}

export interface CompatIssue {
  docId: string;
  component: string;
  kind: BreakingChangeKind;
  prop?: string;
  message: string;
}

export interface CompatReport {
  ok: boolean;
  changes: SignatureChange[];
  affectedDocs: CompatIssue[];
}

/**
 * Compare two component signatures and identify changes.
 */
export function diffSignature(
  oldSig: ComponentSignature,
  newSig: ComponentSignature,
): SignatureChange[] {
  const changes: SignatureChange[] = [];
  const oldProps = oldSig.props;
  const newProps = newSig.props;

  // Check for removed props
  for (const prop of Object.keys(oldProps)) {
    if (!(prop in newProps)) {
      changes.push({
        kind: "prop_removed",
        prop,
        message: `Prop "${prop}" was removed`,
        breaking: true,
      });
    }
  }

  // Check for added or changed props
  for (const [prop, newMeta] of Object.entries(newProps)) {
    const oldMeta = oldProps[prop];
    if (!oldMeta) {
      // New prop — breaking only if we can't determine optionality
      // For now, new props are considered non-breaking (optional by default)
      changes.push({
        kind: "prop_added_optional",
        prop,
        message: `Prop "${prop}" was added`,
        breaking: false,
      });
    } else if (oldMeta.type !== newMeta.type) {
      changes.push({
        kind: "prop_type_changed",
        prop,
        message: `Prop "${prop}" type changed from "${oldMeta.type}" to "${newMeta.type}"`,
        breaking: true,
      });
    }
  }

  // Check description change
  if (oldSig.description !== newSig.description) {
    changes.push({
      kind: "description_changed",
      message: `Description changed`,
      breaking: false,
    });
  }

  return changes;
}

/**
 * Given a component signature change, check all codocs that reference
 * this component and determine if their views are still compatible.
 */
export function checkCompatibility(
  componentName: string,
  oldSignature: ComponentSignature,
  newSignature: ComponentSignature,
  docs: Array<{ docId: string; view: string; componentsMeta?: ComponentsMeta }>,
): CompatReport {
  const changes = diffSignature(oldSignature, newSignature);
  const breakingChanges = changes.filter((c) => c.breaking);

  if (breakingChanges.length === 0) {
    return { ok: true, changes, affectedDocs: [] };
  }

  const affectedDocs: CompatIssue[] = [];
  const removedProps = new Set(
    breakingChanges
      .filter((c) => c.kind === "prop_removed")
      .map((c) => c.prop!),
  );
  const changedProps = new Set(
    breakingChanges
      .filter((c) => c.kind === "prop_type_changed")
      .map((c) => c.prop!),
  );

  for (const doc of docs) {
    // Check if this doc uses the component
    const meta = doc.componentsMeta;
    if (meta && !(componentName in meta)) continue;

    const usages = extractComponentUsages(doc.view);
    const usedProps = usages.get(componentName);
    if (!usedProps) continue;

    // Check if any used prop was removed
    for (const prop of usedProps) {
      if (removedProps.has(prop)) {
        affectedDocs.push({
          docId: doc.docId,
          component: componentName,
          kind: "prop_removed",
          prop,
          message: `<${componentName}> uses removed prop "${prop}"`,
        });
      }
      if (changedProps.has(prop)) {
        affectedDocs.push({
          docId: doc.docId,
          component: componentName,
          kind: "prop_type_changed",
          prop,
          message: `<${componentName}> uses prop "${prop}" whose type changed`,
        });
      }
    }
  }

  return {
    ok: affectedDocs.length === 0,
    changes,
    affectedDocs,
  };
}
