import { NextRequest, NextResponse } from "next/server";
import { detectTextBoundingBox } from "@/lib/googleVision";

// Given a photo, returns a suggested crop box (in pixel coordinates) that
// keeps the nameplate's text/labels and trims the background/extra
// equipment around it, using Google Vision's text detection as a stand-in
// for "where the nameplate's information is." Not perfect -- nameplates
// vary a lot -- so the client falls back to the uncropped photo whenever
// this returns box: null.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.image) {
    return NextResponse.json({ error: "image is required" }, { status: 400 });
  }

  const base64Content: string = body.image.includes(",") ? body.image.split(",")[1] : body.image;

  try {
    const box = await detectTextBoundingBox(base64Content);
    return NextResponse.json({ box });
  } catch {
    // Detection failing should never block someone from saving their photo.
    return NextResponse.json({ box: null });
  }
}
