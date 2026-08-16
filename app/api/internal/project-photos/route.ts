import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for the Primecore homepage's "Completed
// Projects" gallery (see primecore-homepage's ops_client.py) -- returns
// the photos saved under this project's "Project Photos" site (see
// app/api/projects/route.ts's default areas), newest first, with each
// photo's dataUrl inline so the homepage can render <img> tags straight
// from the JSON response without a second round-trip per photo (Photo
// rows already store a full data: URL, see prisma/schema.prisma).
//
// Same project-matching join key as /api/internal/folder-names (Project
// .name first, falling back to .substationName) -- see that route's own
// comment for why both are tried.
//
// Authenticated the same way as the other /api/internal/* routes --
// shared x-internal-api-key header, see middleware.ts's exemption.
const PROJECT_PHOTOS_AREA = "Project Photos";

// Caps how many photos one project can hand back in a single call --
// this is a gallery preview for a homepage tile, not a full export (use
// the ZIP download in this app for that), and Photo.dataUrl is a full
// base64 image so an uncapped project with hundreds of wrap-up photos
// could otherwise make this response enormous. Newest photos first (see
// the orderBy below) so the cap always keeps the most recent ones.
const MAX_PHOTOS = 40;

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized.", photos: [] }, { status: 401 });
  }

  const projectName = (req.nextUrl.searchParams.get("project") || "").trim();
  const substation = (req.nextUrl.searchParams.get("substation") || "").trim();
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
    where: { folder: { projectId: project.id, area: PROJECT_PHOTOS_AREA } },
    orderBy: { createdAt: "desc" },
    take: MAX_PHOTOS,
    select: { id: true, description: true, dataUrl: true, createdAt: true },
  });

  return NextResponse.json({ photos });
}
