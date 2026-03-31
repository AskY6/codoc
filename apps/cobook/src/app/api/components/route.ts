import { NextResponse } from "next/server";
import { getSharedWorkspace } from "@/workspace/server/chat";

/** List all components in the workspace component library. */
export async function GET() {
  const ws = await getSharedWorkspace();
  const library = ws.getComponentLibrary();
  const components = library.list().map((c) => ({
    name: c.name,
    signature: c.signature,
    bundle: c.bundle,
  }));
  return NextResponse.json(components);
}

/** Register a component in the workspace library. Body: { name, signature, bundle } */
export async function POST(req: Request) {
  const body = await req.json();
  const { name, signature, bundle } = body as {
    name: string;
    signature: { props: Record<string, { type: string; description?: string }>; description?: string };
    bundle: Record<string, unknown>;
  };

  if (!name || !signature || !bundle) {
    return NextResponse.json(
      { error: "Missing required fields: name, signature, bundle" },
      { status: 400 },
    );
  }

  const ws = await getSharedWorkspace();
  const library = ws.getComponentLibrary();

  const { parseComponentRef } = await import("@codoc/core");
  library.register({ name, signature, bundle: parseComponentRef(bundle) });

  return NextResponse.json({ ok: true, name });
}
