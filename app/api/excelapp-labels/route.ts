import { NextRequest, NextResponse } from "next/server";

// Browser-facing proxy so the "Choose from ExcelApp" button (project page)
// can ask ExcelApp what device/card names it already has for this same
// project, without exposing ExcelApp's internal API key to the browser.
// Protected by the normal session-cookie gate in middleware.ts (this path
// isn't in its /api/internal/ exemption list), then calls ExcelApp's
// key-protected /api/internal/instance-labels server-to-server. Mirrors
// ExcelApp's own /field_photos_folder_names route, which does the same
// thing in reverse.
export async function GET(req: NextRequest) {
  const projectName = (req.nextUrl.searchParams.get("project") || "").trim();
  if (!projectName) {
    return NextResponse.json({ names: [] });
  }

  const baseUrl = process.env.EXCELAPP_URL;
  const apiKey = process.env.OPS_INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ names: [] });
  }

  try {
    const url = new URL("/api/internal/instance-labels", baseUrl);
    url.searchParams.set("project", projectName);
    const res = await fetch(url.toString(), {
      headers: { "x-internal-api-key": apiKey },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ names: [] });
    }
    const data = await res.json();
    return NextResponse.json({ names: Array.isArray(data.names) ? data.names : [] });
  } catch {
    // ExcelApp unreachable, slow, or misconfigured -- fail soft so the
    // picker button just shows "no names found" instead of breaking the
    // rename/create flow it's attached to.
    return NextResponse.json({ names: [] });
  }
}
