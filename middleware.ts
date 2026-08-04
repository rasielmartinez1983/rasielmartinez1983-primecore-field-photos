import { NextRequest, NextResponse } from "next/server";
import { verifySigned } from "@/lib/crypto-edge";

const COOKIE_NAME = "pcfp_session";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-secret-change-me";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page/API, account sign-up/login/logout, the
  // Face ID (WebAuthn) endpoints -- signing in obviously can't require
  // already being signed in -- and the PWA/static assets Safari fetches
  // before a session cookie exists (home-screen icon, manifest). Also
  // allow /api/internal/* through without a session cookie -- these are
  // server-to-server calls from primecore-ops-local (no user session to
  // send); each route under /api/internal/ checks its own shared-secret
  // header instead (see app/api/internal/create-project/route.ts).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webauthn") ||
    pathname.startsWith("/api/internal/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/logo.png" ||
    pathname === "/apple-touch-icon.png" ||
    /^\/icon-\d+\.png$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const authed = token ? await verifySigned(secret(), token) : false;

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not logged in." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
