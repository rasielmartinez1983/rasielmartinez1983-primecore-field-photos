import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPhotoFilename, sanitizeForPath } from "@/lib/filename";
import { buildPdfFromImageDataUrl } from "@/lib/pdfFromImage";

const AS_BUILT_AREA = "As Built Drawings";

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

  // As Built Drawings scan flow: the captured photo (still a plain image
  // at this point) gets turned into a one-page PDF and named after the
  // drawing number the person confirmed on the scan screen (pre-filled by
  // /api/photos/detect-drawing-name's OCR guess, but always editable
  // there -- this route just trusts whatever name it's given). Every
  // other site keeps the existing photo behavior untouched.
  if (folder.area === AS_BUILT_AREA) {
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "A drawing name is required." }, { status: 400 });
    }
    const pdfBuffer = await buildPdfFromImageDataUrl(dataUrl);
    const pdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
    const filename = `${sanitizeForPath(name) || "Drawing"}.pdf`;

    const photo = await prisma.photo.create({
      data: { folderId, description, phase: null, filename, dataUrl: pdfDataUrl },
    });
    return NextResponse.json({ id: photo.id, filename: photo.filename, createdAt: photo.createdAt });
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
