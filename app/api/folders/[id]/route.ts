import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";
import { findProjectFolderPath, resolveSubfolderPath } from "@/lib/projectFolder";
import { renameItem } from "@/lib/msGraph";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const folder = await prisma.folder.findUnique({
    where: { id },
    include: { project: true, parent: { select: { id: true, name: true } } },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }
  return NextResponse.json(folder);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Name can't be empty." }, { status: 400 });
  }

  const folder = await prisma.folder.findUnique({
    where: { id },
    include: { project: true, parent: { include: { parent: true } } },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  // Block renaming to a name already used by another folder in the same
  // parent (or same top level) -- same exact-match check used when creating
  // a folder.
  const clash = await prisma.folder.findFirst({
    where: {
      projectId: folder.projectId,
      area: folder.area,
      parentId: folder.parentId,
      id: { not: id },
      name: { equals: name },
    },
  });
  if (clash) {
    return NextResponse.json({ error: "Another folder already has that name." }, { status: 409 });
  }

  const oldName = folder.name;
  const updated = await prisma.folder.update({ where: { id }, data: { name } });

  // Remember the new name as a quick-pick preset too, same as on create --
  // only for top-level folders (see POST /api/folders).
  if (!folder.parentId) {
    await prisma.folderPreset
      .upsert({
        where: { area_name: { area: folder.area, name } },
        update: {},
        create: { area: folder.area, name },
      })
      .catch(() => null);
  }

  // Best-effort: if this folder was already backed up to OneDrive under
  // its old name, rename that same OneDrive folder to match instead of
  // leaving it behind -- otherwise the next "Save to OneDrive" would build
  // a path using the new name and create a second, duplicate folder there.
  // Path construction mirrors /api/onedrive/backup-folder exactly (project
  // folder/AMPS/area/[grandparent/][parent/]name). A no-op (via
  // renameItem returning null) if this folder was never backed up yet --
  // that's the normal case for a folder with no photos synced.
  if (oldName !== name) {
    try {
      const matchedProjectFolder = await findProjectFolderPath(folder.project.name);
      if (matchedProjectFolder) {
        const parts = [sanitizeForPath(oldName)];
        if (folder.parent) {
          parts.unshift(sanitizeForPath(folder.parent.name));
          if (folder.parent.parent) parts.unshift(sanitizeForPath(folder.parent.parent.name));
        }
        const ampsPath = await resolveSubfolderPath(matchedProjectFolder, "AMPS");
        const oldPath = `${ampsPath}/${sanitizeForPath(folder.area)}/${parts.join("/")}`;
        await renameItem(oldPath, sanitizeForPath(name));
      }
    } catch (err) {
      console.error(`OneDrive rename failed for folder ${id}:`, err);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Cascade delete removes the folder's photos AND any subfolders (with
  // their own photos, recursively) too (see prisma/schema.prisma).
  await prisma.folder.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
