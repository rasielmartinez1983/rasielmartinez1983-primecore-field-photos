import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";

// Same folder-path logic as the ZIP route, but returns plain JSON (path +
// base64 photo data) instead of a zip binary. This is what the "Save to
// folder" button on the project page uses with the File System Access API
// to write files straight to a folder the user picked, instead of going
// through a .zip download.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { folders: { include: { photos: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

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

  const entries: { path: string; dataBase64: string }[] = [];
  const usedNames = new Map<string, Set<string>>();

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
      entries.push({ path: `${path}/${name}`, dataBase64: base64 });
    }
  }

  const projectFolderName = `${sanitizeForPath(project.substationName)} - ${sanitizeForPath(project.name)}`;

  return NextResponse.json({ projectFolderName, entries });
}
