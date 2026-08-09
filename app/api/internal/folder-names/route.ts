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
const AS_BUILT_AREA = "As Built Drawings";

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized.", names: [] }, { status: 401 });
  }

  const projectName = (req.nextUrl.searchParams.get("project") || "").trim();
  const substation = (req.nextUrl.searchParams.get("substation") || "").trim();
  if (!projectName && !substation) {
    return NextResponse.json({ error: "Missing project name.", names: [] }, { status: 400 });
  }

  // Same join key create-project/delete-project use -- Project.name has
  // no unique constraint, so this takes whichever matches first (in
  // practice there's only ever one project by a given name at a time).
  //
  // Falls back to matching substationName if the name lookup comes up
  // empty -- ExcelApp's project_data.folder_name doesn't reliably equal
  // this app's Project.name (same fragile cross-app join documented in
  // ops_local_client.fetch_project_address), so a real project with
  // existing Yard/House folders could otherwise silently return zero
  // names and show "No matching folders" even though folders exist.
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
    return NextResponse.json({ names: [] });
  }

  // Yard/House only -- excludes the "As Built Drawings" site's own
  // top-level folders ("As Built Drawings", "Highlighted Drawings",
  // see areaLabel.ts). Those aren't device/panel photo folders, so they
  // have no business showing up in a device card's rename picker; before
  // this filter, adding that site (see AS_BUILT_AREA callers across this
  // app) meant its two default folder names started polluting every
  // project's Yard/House suggestion list.
  const folders = await prisma.folder.findMany({
    where: { projectId: project.id, area: { not: AS_BUILT_AREA } },
    select: { name: true },
  });

  const names = Array.from(new Set(folders.map((f) => f.name))).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ names });
}
