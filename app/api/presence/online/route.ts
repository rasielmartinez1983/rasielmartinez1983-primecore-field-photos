import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/access";

// The header polls this every ~20s (heartbeat is every ~30s, see
// /api/presence/heartbeat) -- 90s comfortably covers one missed beat
// (slow network, a backgrounded tab) without someone flickering offline
// and back. Returns everyone else (never the caller) who's active and
// has been seen within that window.
const ONLINE_WINDOW_MS = 90 * 1000;

export async function GET() {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ users: [] }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
    const others = await prisma.user.findMany({
      where: {
        active: true,
        id: { not: access.userId },
        lastSeenAt: { gt: cutoff },
      },
      select: { id: true, username: true, name: true },
      orderBy: [{ name: "asc" }, { username: "asc" }],
    });
    return NextResponse.json({ users: others });
  } catch (err) {
    console.error("presence online-list error:", err);
    return NextResponse.json({ users: [] });
  }
}
