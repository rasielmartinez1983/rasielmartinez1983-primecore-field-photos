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

  const photo = await prisma.oneLinePhoto.create({
    data: { substationName, description, filename, dataUrl },
  });
  return NextResponse.json(photo);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  await prisma.oneLinePhoto.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
