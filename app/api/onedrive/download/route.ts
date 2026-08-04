import { NextRequest, NextResponse } from "next/server";
import { downloadFile } from "@/lib/msGraph";

// Fallback proxy for when a browse/search result didn't come back with a
// direct @microsoft.graph.downloadUrl (the normal, faster path the client
// uses instead -- see OneDriveImportModal.tsx). Streams the raw bytes back
// with a generic content-type; the caller already knows the real one from
// the DriveItem it got from /api/onedrive/browse or /search.
export async function GET(req: NextRequest) {
  const itemId = req.nextUrl.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json({ error: "Missing 'itemId' parameter." }, { status: 400 });
  }
  try {
    const bytes = await downloadFile(itemId);
    return new NextResponse(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not download that OneDrive file." }, { status: 502 });
  }
}
