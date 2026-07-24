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
      // Every project starts with the two standard sites. They're regular
      // ProjectArea rows like any custom site, so they can be deleted (and
      // re-added later via "+ Add site") on a per-project basis.
      areas: { create: [{ name: "Yard" }, { name: "House" }] },
    },
  });
  return NextResponse.json(project);
}
