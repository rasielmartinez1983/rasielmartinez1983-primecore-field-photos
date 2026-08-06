import { NextRequest, NextResponse } from "next/server";
import { extractFullText } from "@/lib/googleVision";
import { guessDrawingName } from "@/lib/drawingName";

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
    return NextResponse.json({ guessedName, rawText: text || "" });
  } catch {
    return NextResponse.json({ guessedName: null, rawText: "" });
  }
}
