import { NextResponse } from "next/server";
import { getWorkspace } from "@/workspace/server/workspace";
import { checkCompatibility } from "@cobook/workspace";

/**
 * Check compatibility if a component signature were to change.
 * Body: { signature: ComponentSignature }
 *
 * Compares the proposed signature against the current one and
 * reports which codocs would be affected by breaking changes.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const body = await req.json();
  const { signature: newSignature } = body as {
    signature: { props: Record<string, { type: string; description?: string }>; description?: string };
  };

  if (!newSignature) {
    return NextResponse.json(
      { error: "Missing required field: signature" },
      { status: 400 },
    );
  }

  const ws = await getWorkspace();
  const library = ws.getComponentLibrary();
  const current = library.get(name);

  if (!current) {
    return NextResponse.json(
      { error: `Component not found: ${name}` },
      { status: 404 },
    );
  }

  // Gather all codocs that might reference this component
  const allDocs = ws.listDocs();
  const docsWithViews = allDocs.map((d) => {
    const raw = ws.getRawDoc(d.docId);
    return {
      docId: d.docId,
      view: raw?.view ?? "",
      componentsMeta: d.componentsMeta,
    };
  });

  const report = checkCompatibility(
    name,
    current.signature,
    newSignature,
    docsWithViews,
  );

  return NextResponse.json(report);
}
