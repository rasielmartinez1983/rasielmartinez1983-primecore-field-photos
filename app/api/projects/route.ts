import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { folders: true } } },
  });
  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      substationName: p.substationName,
      client: p.client,
      date: p.date,
      folderCount: p._count.folders,
      createdAt: p.createdAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const substationName = String(body.substationName || "").trim();
  const client = String(body.client || "").trim();
  const dateStr = String(body.date || "").trim();

  if (!name || !substationName || !client || !dateStr) {
    return NextResponse.json(
      { error: "Missing project name, substation, client, or date." },
      { status: 400 }
    );
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name,
      substationName,
      client,
      date,
      // Every project starts with the four standard sites. They're regular
      // ProjectArea rows like any custom site, so they can be deleted (and
      // re-added later via "+ Add site") on a per-project basis. "As Built
      // Drawings" is handled the same way as Yard/House everywhere in this
      // app except how a photo captured inside it gets saved -- see
      // app/api/photos/route.ts. Shown to the user as "As Built /
      // Highlighted Drawings" (see lib/areaLabel.ts) -- the area string
      // itself stays "As Built Drawings" everywhere it's actually matched
      // on, only the on-screen label changed. "Project Photos" is plain
      // Yard/House-style capture (no OCR/crop flow) -- it's just where
      // final wrap-up photos of the finished job go once the project is
      // Invoiced, so they can show up in the Primecore homepage's
      // "Completed Projects" gallery (see /api/internal/project-photos)
      // and get backed up into ops.primecore's own "Project Photos"
      // OneDrive subfolder (see the onedrive/backup-* routes).
      areas: { create: [{ name: "Yard" }, { name: "House" }, { name: "As Built Drawings" }, { name: "Project Photos" }] },
      // As Built Drawings starts with two default subfolders instead of
      // empty -- "As Built Drawings" for regular as-built scans and
      // "Highlighted Drawings" for marked-up ones. Both are ordinary
      // top-level folders (inherit area from their parent's area string,
      // same as any folder created by hand), so the crop/OCR/PDF/OneDrive
      // flow works inside them exactly like it does at the area root.
      // Project Photos gets one default folder too, so there's somewhere
      // to drop photos immediately instead of having to create a folder
      // first.
      folders: {
        create: [
          { area: "As Built Drawings", name: "As Built Drawings" },
          { area: "As Built Drawings", name: "Highlighted Drawings" },
          { area: "Project Photos", name: "Project Photos" },
        ],
      },
    },
  });
  return NextResponse.json(project);
}
