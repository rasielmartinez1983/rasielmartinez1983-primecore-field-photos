import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  const folder = await prisma.folder.findUnique({ where: { id } });
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

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Cascade delete removes the folder's photos AND any subfolders (with
  // their own photos, recursively) too (see prisma/schema.prisma).
  await prisma.folder.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
