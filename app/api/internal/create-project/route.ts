import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Server-to-server endpoint for primecore-ops-local: called automatically
// whenever a Project is created there (manual create, or a Bid auto-
// creating one on Won), so a matching Project with the identical name
// exists here too -- without the user having to type it in twice. This is
// what lets "Save to OneDrive" on this app's project page find the right
// OneDrive folder by name (see lib/projectFolder.ts's findProjectFolderPath).
//
// Authenticated with a shared-secret header instead of the normal session
// cookie -- ops-local has no field-photos user session to send. See
// middleware.ts's exemption for this one path (the check happens here,
// not there).
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-api-key");
  if (!key || !process.env.OPS_INTERNAL_API_KEY || key !== process.env.OPS_INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const substationName = String(body.substationName || "").trim() || "-";
  const client = String(body.client || "").trim() || "-";
  const dateStr = String(body.date || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Missing project name." }, { status: 400 });
  }
  const date = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  // Idempotent -- ops.primecore may retry this call (e.g. a bid re-saved
  // after the first sync attempt failed), so never create a second project
  // here for the same name.
  const existing = await prisma.project.findFirst({ where: { name } });
  if (existing) {
    return NextResponse.json(existing);
  }

  const project = await prisma.project.create({
    data: {
      name,
      substationName,
      client,
      date,
      // Same default sites every project gets when created normally
      // through the UI (see app/api/projects/route.ts).
      areas: { create: [{ name: "Yard" }, { name: "House" }, { name: "As Built Drawings" }] },
    },
  });
  return NextResponse.json(project, { status: 201 });
}
