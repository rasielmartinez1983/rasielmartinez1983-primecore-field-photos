import { NextRequest, NextResponse } from "next/server";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";

// Streams a ZIP of the whole project, preserving the same Yard/House/folder
// structure used on OneDrive, so it can be unzipped straight into (or on
// top of) the project's AMP folder.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { folders: { include: { photos: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Build each folder's full path by walking up its parent chain, so
  // subfolders (e.g. Yard/Arresters/Line Arresters) keep their nesting in
  // the exported ZIP instead of all landing flat under the area.
  const folders = project.folders;
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  function folderPath(folder: (typeof folders)[number]): string {
    const parts = [sanitizeForPath(folder.name)];
    let cur = folder;
    while (cur.parentId) {
      const parent = foldersById.get(cur.parentId);
      if (!parent) break;
      parts.unshift(sanitizeForPath(parent.name));
      cur = parent;
    }
    return `${sanitizeForPath(folder.area)}/${parts.join("/")}`;
  }

  const entries: ZipEntry[] = [];
  const usedNames = new Map<string, Set<string>>(); // per-folder-path used filenames

  for (const folder of folders) {
    const path = folderPath(folder);
    if (!usedNames.has(path)) usedNames.set(path, new Set());
    const used = usedNames.get(path)!;

    for (const photo of folder.photos) {
      const base64 = photo.dataUrl.split(",")[1] || "";
      let name = photo.filename;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        name = `${name.slice(0, dot)}-${photo.id.slice(0, 5)}${name.slice(dot)}`;
      }
      used.add(name);
      entries.push({ name: `${path}/${name}`, data: Buffer.from(base64, "base64") });
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: "This project doesn't have any photos yet." }, { status: 404 });
  }

  const buffer = buildZip(entries);
  const zipName = `AMP - ${sanitizeForPath(project.substationName)} - ${sanitizeForPath(project.name)}.zip`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
    },
  });
}
