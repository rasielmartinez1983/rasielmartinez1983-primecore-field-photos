import { NextRequest, NextResponse } from "next/server";
import { findProjectFolderPath } from "@/lib/projectFolder";

// TEMPORARY diagnostic route -- not linked from any UI. "Save to OneDrive"
// on the project page was failing with a generic "Could not connect" (the
// frontend swallows the real error on any thrown exception), so this
// surfaces exactly what findProjectFolderPath() does/throws for a given
// name. Safe to delete once the OneDrive backup feature is confirmed
// working end-to-end. Auth: same session-cookie check as every other route
// (via middleware.ts) -- no bypass here.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") || "";
  if (!name) {
    return NextResponse.json({ error: "Pass ?name=<project name>" }, { status: 400 });
  }
  try {
    const match = await findProjectFolderPath(name);
    return NextResponse.json({ ok: true, name, match });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      name,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
