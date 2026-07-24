import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const area = req.nextUrl.searchParams.get("area");
  const parentId = req.nextUrl.searchParams.get("parentId");

  // Listing the subfolders of a specific folder.
  if (parentId) {
    const folders = await prisma.folder.findMany({
      where: { parentId },
      orderBy: { name: "asc" },
      include: { _count: { select: { photos: true, children: true } } },
    });
    return NextResponse.json(
      folders.map((f) => ({
        id: f.id,
        name: f.name,
        area: f.area,
        photoCount: f._count.photos,
        subfolderCount: f._count.children,
      }))
    );
  }

  // Listing the top-level folders of a project area (excludes subfolders,
  // which only show up inside their parent folder's page).
  if (!projectId || !area) {
    return NextResponse.json({ error: "Missing parameters (projectId, area)." }, { status: 400 });
  }

  const folders = await prisma.folder.findMany({
    where: { projectId, area, parentId: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { photos: true, children: true } } },
  });

  return NextResponse.json(
    folders.map((f) => ({
      id: f.id,
      name: f.name,
      area: f.area,
      photoCount: f._count.photos,
      subfolderCount: f._count.children,
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let projectId = String(body.projectId || "");
  let area = String(body.area || "");
  const name = String(body.name || "").trim();
  const parentId = body.parentId ? String(body.parentId) : null;

  if (!name || (!parentId && (!projectId || !area))) {
    return NextResponse.json({ error: "Missing data (project, area, or name)." }, { status: 400 });
  }

  let parent = null;
  if (parentId) {
    parent = await prisma.folder.findUnique({ where: { id: parentId } });
    if (!parent) {
      return NextResponse.json({ error: "Parent folder not found." }, { status: 404 });
    }
    // A subfolder always lives in the same project + area as its parent.
    projectId = parent.projectId;
    area = parent.area;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Reuse an existing folder with the same name (case-insensitive) instead
  // of creating a near-duplicate if the tech retypes it slightly differently.
  // Scoped to the same parent (or same top level) so a subfolder name can
  // repeat a name used elsewhere in the project.
  const existing = await prisma.folder.findFirst({
    where: { projectId, area, parentId, name: { equals: name } },
  });

  // Remember this name as a quick-pick preset for future projects -- only
  // for top-level folders, since presets are area-scoped, not tied to a
  // specific parent folder.
  if (!parentId) {
    await prisma.folderPreset
      .upsert({
        where: { area_name: { area, name } },
        update: {},
        create: { area, name },
      })
      .catch(() => null);
  }

  if (existing) {
    return NextResponse.json(existing);
  }

  const folder = await prisma.folder.create({ data: { projectId, area, name, parentId } });
  return NextResponse.json(folder);
}
