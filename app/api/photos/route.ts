import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPhotoFilename } from "@/lib/filename";

export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "Missing 'folderId' parameter." }, { status: 400 });
  }

  const photos = await prisma.photo.findMany({
    where: { folderId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(photos);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const folderId = String(body.folderId || "");
  const description = String(body.description || "").trim();
  const phase = body.phase ? String(body.phase) : null;
  const dataUrl = String(body.dataUrl || "");

  if (!folderId || !dataUrl) {
    return NextResponse.json({ error: "Missing data (folder or photo)." }, { status: 400 });
  }
  if (!dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Invalid photo format." }, { status: 400 });
  }

  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { project: true },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  const filename = buildPhotoFilename(
    folder.project.client || "",
    folder.project.substationName,
    folder.name,
    phase
  );

  const photo = await prisma.photo.create({
    data: { folderId, description, phase, filename, dataUrl },
  });

  return NextResponse.json({ id: photo.id, filename: photo.filename, createdAt: photo.createdAt });
}
