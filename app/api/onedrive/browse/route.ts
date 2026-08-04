import { NextRequest, NextResponse } from "next/server";
import { listFolder } from "@/lib/msGraph";

// Lists the files/folders at a given path inside the one OneDrive account
// this app is scoped to (see lib/msGraph.ts). Used by the "Import from
// OneDrive" browser in the folder-picker UI.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  try {
    const items = await listFolder(path);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not list that OneDrive folder." }, { status: 502 });
  }
}
