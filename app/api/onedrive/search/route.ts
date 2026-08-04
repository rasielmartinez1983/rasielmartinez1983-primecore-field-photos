import { NextRequest, NextResponse } from "next/server";
import { searchDrive } from "@/lib/msGraph";

// Full-text search across the whole scoped OneDrive account, e.g. for
// finding "Bandit CCVT" photos taken by someone else and already uploaded
// there, so they can be pulled into this project instead of retaken.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({ error: "Missing 'q' search parameter." }, { status: 400 });
  }
  try {
    const items = await searchDrive(q.trim());
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "OneDrive search failed." }, { status: 502 });
  }
}
