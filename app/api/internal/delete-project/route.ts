import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for primecore-ops-local: called whenever a
// Project is deleted there, so the matching Project here (created by
// POST /api/internal/create-project) is removed too instead of being left
// behind with no counterpart in ops.primecore. Cascades to this project's
// Folders/Photos/ProjectAreas (onDelete: Cascade in schema.prisma).
//
// Authenticated with the same shared-secret header as create-project --
// see middleware.ts's exemption for /api/internal/*.
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Missing project name." }, { status: 400 });
  }

  // deleteMany (not delete) since Project.name has no unique constraint --
  // matches every project with this exact name, same join key create-project
  // uses. A no-op (count: 0) if nothing matches, not an error -- the ops
  // project may never have synced here successfully in the first place.
  const result = await prisma.project.deleteMany({ where: { name } });
  return NextResponse.json({ deleted: result.count });
}
