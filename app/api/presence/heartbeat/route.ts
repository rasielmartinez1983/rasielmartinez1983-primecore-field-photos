import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/access";

// Called every ~30s from the header widget while a page is open (see
// app/page.tsx) -- keeps this user's lastSeenAt fresh so everyone else's
// "who's online" indicator (see /api/presence/online) counts them.
// Best-effort: a DB hiccup here should never surface as an error to
// whoever's page this is, it just means the indicator is briefly stale
// for other people.
export async function POST() {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    await prisma.user.update({
      where: { id: access.userId },
      data: { lastSeenAt: new Date() },
    });
  } catch (err) {
    console.error("presence heartbeat error:", err);
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({ ok: true });
}
