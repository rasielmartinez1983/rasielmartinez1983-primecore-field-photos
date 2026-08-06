import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const raw = String(body.filename || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Filename is required." }, { status: 400 });
  }

  const existing = await prisma.photo.findUnique({ where: { id }, select: { filename: true } });
  if (!existing) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }

  // Keep whatever extension this photo actually already has (strip any
  // extension the person typed, then re-add the real one) -- every Yard/
  // House photo is a .jpg, but As Built Drawings photos are .pdf, and
  // renaming must never silently change what the stored file actually is.
  const existingExt = existing.filename.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".jpg";
  const withoutExt = raw.replace(/\.[a-zA-Z0-9]+$/, "");
  const clean = sanitizeForPath(withoutExt);
  if (!clean) {
    return NextResponse.json({ error: "That name isn't valid." }, { status: 400 });
  }
  const filename = `${clean}${existingExt}`;

  const photo = await prisma.photo.update({ where: { id }, data: { filename } }).catch(() => null);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, filename: photo.filename });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.photo.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
