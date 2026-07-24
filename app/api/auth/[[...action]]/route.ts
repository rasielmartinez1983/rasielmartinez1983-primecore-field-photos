import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getSessionUserId, setSessionCookie, clearSessionCookie } from "@/lib/session";

// One file handles account sign-up, username/password login, logout, and
// "who am I" -- same catch-all-path trick used for /api/webauthn.

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ user: null });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, name: true },
  });
  return NextResponse.json({ user });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action } = await ctx.params;
  const step = action?.[0];

  if (step === "register") {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim() || null;

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "Password must be at least 4 characters." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: { username, name, passwordHash: hashPassword(password) },
    });

    await setSessionCookie(user.id);
    return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, name: user.name } });
  }

  if (step === "login") {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }

    await setSessionCookie(user.id);
    return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, name: user.name } });
  }

  if (step === "logout") {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 404 });
}
