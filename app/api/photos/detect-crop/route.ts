import { NextRequest, NextResponse } from "next/server";
import { detectTextBoundingBox } from "@/lib/googleVision";

// Given a photo, returns a suggested crop box (in pixel coordinates) that
// keeps the nameplate's text/labels and trims the background/extra
// equipment around it, using Google Vision's text detection as a stand-in
// for "where the nameplate's information is." Not perfect -- nameplates
// vary a lot -- so the client falls back to the uncropped photo whenever
// this returns box: null.
//
// Deliberately kept on Google Vision rather than migrated to Claude
// vision alongside detect-drawing-name/route.ts: this route needs real
// pixel coordinates in the original image's coordinate space, which a
// vision-language model isn't built to return reliably (images get
// resized internally, and there's no guarantee a reported box maps back
// precisely to the original photo's pixels the way a real object/text
// detector's bounding box does). Google Vision's TEXT_DETECTION is the
// right tool for this specific job.
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
