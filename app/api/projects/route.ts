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
      // Every project starts with the three standard sites. They're regular
      // ProjectArea rows like any custom site, so they can be deleted (and
      // re-added later via "+ Add site") on a per-project basis. "As Built
      // Drawings" is handled the same way as Yard/House everywhere in this
      // app except how a photo captured inside it gets saved -- see
      // app/api/photos/route.ts.
      areas: { create: [{ name: "Yard" }, { name: "House" }, { name: "As Built Drawings" }] },
    },
  });
  return NextResponse.json(project);
}
