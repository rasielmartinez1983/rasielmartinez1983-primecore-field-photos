import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area");
  if (!area) {
    return NextResponse.json({ error: "Missing 'area' parameter." }, { status: 400 });
  }

  const presets = await prisma.folderPreset.findMany({
    where: { area },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(presets.map((p) => p.name));
}
