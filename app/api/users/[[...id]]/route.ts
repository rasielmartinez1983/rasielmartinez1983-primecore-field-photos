import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/access";

// Admin-only: list accounts and toggle active on/off from /admin. This is
// the "quitar/dar acceso" action -- deactivating doesn't delete the
// account (so nothing they've captured is lost, and it's reversible), it
// just fails them at their next login and bounces an already-open session
// to /login the next time the app calls GET /api/auth (see that route and
// lib/access.ts's getAccess).

export async function GET() {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, name: true, isAdmin: true, active: true, createdAt: true },
  });
  return NextResponse.json(users);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id?: string[] }> }
) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const { id: idParts } = await params;
  const id = idParts?.[0];
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Can't deactivate your own account -- there'd be no one left who could
  // log back in to reverse it.
  if (id === access.userId) {
    return NextResponse.json({ error: "You can't remove your own access." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({ where: { id }, data: { active: body.active } });
    return NextResponse.json({ id: updated.id, active: updated.active });
  } catch {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
}
