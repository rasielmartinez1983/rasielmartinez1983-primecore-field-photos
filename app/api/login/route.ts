import { NextResponse } from "next/server";

// Passcode login has been replaced by per-account username/password + Face
// ID (see /api/auth and /api/webauthn). Kept as a stub, rather than
// deleted, so any stale cached request from an old installed session fails
// clearly instead of 404ing.
export async function POST() {
  return NextResponse.json(
    { error: "Passcode sign-in has been replaced. Reload the app." },
    { status: 410 }
  );
}
