import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session";

// Unlike ops.primecore, this app has no per-tab permission matrix -- it's
// one single workflow (organize + capture project photos), so the only
// access question is "can this person use the app at all" (active) and
// "can they manage accounts/codes" (isAdmin). See AccessCode/User in
// prisma/schema.prisma for the full picture.

export interface AccessInfo {
  userId: string;
  username: string;
  name: string | null;
  isAdmin: boolean;
}

// Reads the session cookie, looks up the user fresh from the DB (so a
// permission change an admin makes takes effect on this person's very
// next request -- no need for them to log out/in), and returns their
// access info. Returns null if not logged in or the account was
// deactivated. middleware.ts can't do this check itself (Edge runtime,
// no Postgres access) -- it only verifies the cookie's signature, so this
// is the real gate, called from inside actual route handlers.
export async function getAccess(): Promise<AccessInfo | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, name: true, isAdmin: true, active: true },
  });
  if (!user || !user.active) return null;

  return { userId: user.id, username: user.username, name: user.name, isAdmin: user.isAdmin };
}

// Use at the top of an admin-only route handler: either returns the
// caller's AccessInfo (is an admin) or a ready-to-return 401/403
// NextResponse.
//
//   const access = await requireAdmin();
//   if (access instanceof NextResponse) return access;
export async function requireAdmin(): Promise<AccessInfo | NextResponse> {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!access.isAdmin) {
    return NextResponse.json({ error: "Only an admin can do that." }, { status: 403 });
  }
  return access;
}

// Short, easy-to-read-aloud/type invite code -- uppercase letters/digits
// only, no ambiguous characters (0/O, 1/I/L). Same alphabet as
// ops.primecore's generateAccessCode (lib/access.ts) and ExcelApp's
// _generate_access_code (app.py) so every PrimeCore app's invite codes
// look and feel the same.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateAccessCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
