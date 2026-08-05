import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for ExcelApp: returns the distinct folder
// names (Yard + House combined) already created here for one project, so
// someone renaming a device card in ExcelApp can pick the exact same
// text instead of retyping it -- the AMP photo importer over there
// matches folders to cards by name, so even a small typo means photos
// land on the wrong card or don't show up at all. See ExcelApp's own
// /api/internal/instance-labels (the reverse direction) and its
// /field_photos_folder_names proxy.
//
// Authenticated the same way as the other /api/internal/* routes --
// shared x-internal-api-key header, see middleware.ts's exemption.
export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized.", names: [] }, { status: 401 });
  }

  const projectName = (req.nextUrl.searchParams.get("project") || "").trim();
  if (!projectName) {
    return NextResponse.json({ error: "Missing project name.", names: [] }, { status: 400 });
  }

  // Same join key create-project/delete-project use -- Project.name has
  // no unique constraint, so this takes whichever matches first (in
  // practice there's only ever one project by a given name at a time).
  const project = await prisma.project.findFirst({
    where: { name: { equals: projectName, mode: "insensitive" } },
  });
  if (!project) {
    return NextResponse.json({ names: [] });
  }

  const folders = await prisma.folder.findMany({
    where: { projectId: project.id },
    select: { name: true },
  });

  const names = Array.from(new Set(folders.map((f) => f.name))).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ names });
}
