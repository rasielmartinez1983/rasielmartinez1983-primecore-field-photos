import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, generateAccessCode } from "@/lib/access";

// Admin-only: generate/list/revoke one-time invite codes from /admin.
// Redeeming one (POST /api/auth/register, see app/api/auth) creates a
// brand-new account and marks the code used so it can't be redeemed again.

export async function GET() {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const codes = await prisma.accessCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      usedBy: { select: { id: true, username: true } },
    },
  });
  return NextResponse.json(
    codes.map((c) => ({
      id: c.id,
      code: c.code,
      note: c.note,
      revoked: c.revoked,
      usedAt: c.usedAt,
      usedBy: c.usedBy,
      createdAt: c.createdAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => ({}));
  const note = body.note ? String(body.note).trim() : null;

  // Astronomically unlikely to collide (8 chars from a 32-char alphabet),
  // but retry a few times against the unique constraint just in case.
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateAccessCode();
    const existing = await prisma.accessCode.findUnique({ where: { code } });
    if (!existing) break;
    code = "";
  }
  if (!code) {
    return NextResponse.json({ error: "Could not generate a unique code, try again." }, { status: 500 });
  }

  const created = await prisma.accessCode.create({
    data: { code, note, createdById: access.userId },
  });

  return NextResponse.json(
    { id: created.id, code: created.code, note: created.note, createdAt: created.createdAt },
    { status: 201 }
  );
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

  const body = await req.json().catch(() => ({}));
  if (body.revoked !== true) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const updated = await prisma.accessCode.update({ where: { id }, data: { revoked: true } });
    return NextResponse.json({ id: updated.id, revoked: updated.revoked });
  } catch {
    return NextResponse.json({ error: "Code not found." }, { status: 404 });
  }
}
