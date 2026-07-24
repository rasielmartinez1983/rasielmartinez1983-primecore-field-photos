import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing parameter (projectId)." }, { status: 400 });
  }

  const areas = await prisma.projectArea.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  // Attach a folder count per site so the card can show "N folders" like
  // Yard/House do.
  const withCounts = await Promise.all(
    areas.map(async (a) => {
      const folderCount = await prisma.folder.count({ where: { projectId, area: a.name } });
      return { id: a.id, name: a.name, folderCount };
    })
  );

  return NextResponse.json(withCounts);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || "");
  const name = String(body.name || "").trim();

  if (!projectId || !name) {
    return NextResponse.json({ error: "Missing project or site name." }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const existing = await prisma.projectArea.findFirst({
    where: { projectId, name: { equals: name } },
  });
  if (existing) {
    return NextResponse.json({ error: "A site with that name already exists." }, { status: 409 });
  }

  const area = await prisma.projectArea.create({ data: { projectId, name } });
  return NextResponse.json(area);
}
