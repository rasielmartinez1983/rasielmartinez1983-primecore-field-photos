import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for primecore-ops-local's Bid "Takeoff" tool --
// lets the user pick an already-uploaded one-line print photo by
// substation name (see OneLinePhoto in prisma/schema.prisma -- deliberately
// not tied to a Project, since this needs to work during the Bid stage,
// before a Won project exists in either app). Same x-internal-api-key auth
// as the other /api/internal/* routes -- see project-photos/route.ts.

const MAX_PHOTOS = 100;

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized.", photos: [] }, { status: 401 });
  }

  const substation = (req.nextUrl.searchParams.get("substation") || "").trim();
  if (!substation) {
    return NextResponse.json({ error: "Missing substation name.", photos: [] }, { status: 400 });
  }

  const photos = await prisma.oneLinePhoto.findMany({
    where: { substationName: { equals: substation, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: MAX_PHOTOS,
    select: { id: true, description: true, filename: true, dataUrl: true, createdAt: true },
  });

  return NextResponse.json({ photos });
}
