import { NextRequest, NextResponse } from "next/server";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";

// Streams a ZIP of every photo in a single folder (flat, no subfolders --
// use /api/projects/[id]/zip for the whole project with the Yard/House
// structure preserved).
export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "Missing 'folderId' parameter." }, { status: 400 });
  }

  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  const photos = await prisma.photo.findMany({
    where: { folderId },
    orderBy: { createdAt: "asc" },
  });

  if (photos.length === 0) {
    return NextResponse.json({ error: "This folder doesn't have any photos yet." }, { status: 404 });
  }

  const usedNames = new Set<string>();
  const entries: ZipEntry[] = [];

  for (const photo of photos) {
    const base64 = photo.dataUrl.split(",")[1] || "";
    let name = photo.filename;
    // Guard against duplicate filenames (e.g. same description typed twice
    // in the same second) so nothing silently overwrites another photo.
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = `${name.slice(0, dot)}-${photo.id.slice(0, 5)}${name.slice(dot)}`;
    }
    usedNames.add(name);
    entries.push({ name, data: Buffer.from(base64, "base64") });
  }

  const buffer = buildZip(entries);
  const zipName = `${sanitizeForPath(folder.name)}.zip`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
