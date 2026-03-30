import { NextResponse } from "next/server";
import { getConnectorCatalog } from "@/workspace/server/connector-catalog";

export interface ConnectorStatus {
  name: string;
  displayName: string;
  description: string;
  active: boolean;
  authConfigured: boolean;
}

/** List all available connectors with their activation and auth status. */
export async function GET() {
  const catalog = getConnectorCatalog();
  return NextResponse.json(catalog.getStatuses());
}

/** Activate or deactivate a connector. Body: { name, active } */
export async function POST(req: Request) {
  const body = (await req.json()) as { name: string; active: boolean };
  const catalog = getConnectorCatalog();

  if (!catalog.get(body.name)) {
    return NextResponse.json(
      { error: `Unknown connector: ${body.name}` },
      { status: 404 },
    );
  }

  if (body.active) {
    await catalog.activate(body.name);
  } else {
    await catalog.deactivate(body.name);
  }

  return NextResponse.json(catalog.getStatuses());
}
