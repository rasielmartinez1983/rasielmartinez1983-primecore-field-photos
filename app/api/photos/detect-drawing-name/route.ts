import { NextRequest, NextResponse } from "next/server";
import { extractFullText } from "@/lib/googleVision";
import { guessDrawingName, guessGroupCode } from "@/lib/drawingName";

// As Built Drawings scan flow: given a photo of a drawing, OCRs it and
// guesses a drawing number/title from the title block (see
// lib/drawingName.ts). Called right after the photo is taken, before the
// person confirms a name and actually saves -- the guess pre-fills an
// editable field, it's never saved automatically. Detection failing
// (Vision not configured, no text found, network hiccup) should never
// block someone from typing a name themselves, so this always returns
// 200 with guessedName: null rather than an error status.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.image) {
    return NextResponse.json({ error: "image is required" }, { status: 400 });
  }

  const base64Content: string = body.image.includes(",") ? body.image.split(",")[1] : body.image;

  try {
    const text = await extractFullText(base64Content);
    const guessedName = text ? guessDrawingName(text) : null;
    // The group code above the description (e.g. "PG-213") -- used to
    // auto-file the scan into a matching subfolder. Same fail-soft rule:
    // never blocks saving, just pre-fills a field the person can clear.
    const guessedGroup = text ? guessGroupCode(text) : null;
    return NextResponse.json({ guessedName, guessedGroup, rawText: text || "" });
  } catch {
    return NextResponse.json({ guessedName: null, rawText: "" });
  }
}
