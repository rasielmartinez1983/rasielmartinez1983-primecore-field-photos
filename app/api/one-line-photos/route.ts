import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Standalone one-line print library, independent of Project (see
// OneLinePhoto in prisma/schema.prisma for why). GET lists photos,
// optionally filtered by substation name; POST uploads one; DELETE removes
// one by id.

const MAX_PHOTOS = 200;

export async function GET(req: NextRequest) {
  const substation = (req.nextUrl.searchParams.get("substation") || "").trim();
  const photos = await prisma.oneLinePhoto.findMany({
    where: substation ? { substationName: { equals: substation, mode: "insensitive" } } : undefined,
    orderBy: { createdAt: "desc" },
    take: MAX_PHOTOS,
  });
  return NextResponse.json(photos);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const substationName = String(body.substationName || "").trim();
  const description = body.description ? String(body.description) : null;
  const filename = String(body.filename || "one-line");
  const dataUrl = String(body.dataUrl || "");

  if (!substationName || !dataUrl) {
    return NextResponse.json({ error: "Missing substation name or photo." }, { status: 400 });
  }

  try {
    const photo = await prisma.oneLinePhoto.create({
      data: { substationName, description, filename, dataUrl },
    });
    return NextResponse.json(photo);
  } catch (err) {
    // Surface a real reason instead of letting a generic 500/HTML error
    // page reach the client (which made res.json() fail client-side and
    // show a blank "Could not save the photo." with no way to diagnose).
    // TEMP: including err.message + payload size in the response itself
    // (not just server logs) so we can diagnose without Vercel log access --
    // the previous "it may be too big" text was a guess, not a confirmed
    // cause. Safe to expose here: this route sits behind field-photos'
    // session login, not public.
    const sizeKB = Math.round(dataUrl.length / 1024);
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`one-line-photos POST failed (payload ${sizeKB}KB):`, err);
    return NextResponse.json(
      { error: `Server error saving the photo (payload ${sizeKB}KB): ${detail}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  await prisma.oneLinePhoto.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
