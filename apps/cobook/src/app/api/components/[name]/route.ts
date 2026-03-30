import { NextResponse } from "next/server";
import { getWorkspace } from "@/workspace/server/workspace";

/** Get a single component from the workspace library by name. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ws = await getWorkspace();
  const library = ws.getComponentLibrary();
  const component = library.get(name);

  if (!component) {
    return NextResponse.json(
      { error: `Component not found: ${name}` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    name: component.name,
    signature: component.signature,
    bundle: component.bundle,
  });
}

/** Remove a component from the workspace library. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ws = await getWorkspace();
  const library = ws.getComponentLibrary();

  if (!library.has(name)) {
    return NextResponse.json(
      { error: `Component not found: ${name}` },
      { status: 404 },
    );
  }

  library.unregister(name);
  return NextResponse.json({ ok: true, name });
}
