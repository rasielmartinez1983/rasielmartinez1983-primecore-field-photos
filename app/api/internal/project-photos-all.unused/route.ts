import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for primecore-ops-local's Bid "Takeoff" tool --
// lets the user pick an already-uploaded photo/PDF (e.g. a one-line print)
// from a field-photos project. Defaults to searching every folder, but an
// optional `area` filter narrows it to one site -- ops-local's Takeoff
// picker passes area="One Line" (see /api/projects/route.ts, which now
// creates a "One Line" site + default folder on every new project) so the
// picker only shows what's actually in that folder, not every Yard/House
// photo too. This is a separate route from project-photos/route.ts so the
// existing endpoint and its callers (the homepage gallery) are untouched.
//
// Same project-matching join key (Project.name, falling back to
// .substationName) and same x-internal-api-key auth as the other
// /api/internal/* routes -- see project-photos/route.ts's comment.

const MAX_PHOTOS = 100;

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized.", photos: [] }, { status: 401 });
  }

  const projectName = (req.nextUrl.searchParams.get("project") || "").trim();
  const substation = (req.nextUrl.searchParams.get("substation") || "").trim();
  const area = (req.nextUrl.searchParams.get("area") || "").trim();
  if (!projectName && !substation) {
    return NextResponse.json({ error: "Missing project name.", photos: [] }, { status: 400 });
  }

  let project = projectName
    ? await prisma.project.findFirst({
        where: { name: { equals: projectName, mode: "insensitive" } },
      })
    : null;
  if (!project && substation) {
    project = await prisma.project.findFirst({
      where: { substationName: { equals: substation, mode: "insensitive" } },
    });
  }
  if (!project) {
    return NextResponse.json({ photos: [] });
  }

  const photos = await prisma.photo.findMany({
    where: {
      folder: area
        ? { projectId: project.id, area: { equals: area, mode: "insensitive" } }
        : { projectId: project.id },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_PHOTOS,
    select: {
      id: true,
      description: true,
      filename: true,
      dataUrl: true,
      createdAt: true,
      folder: { select: { area: true, name: true } },
    },
  });

  return NextResponse.json({ photos });
}
