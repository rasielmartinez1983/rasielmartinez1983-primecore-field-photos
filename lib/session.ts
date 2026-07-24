import { cookies } from "next/headers";
import { signValue, parseSigned } from "@/lib/crypto-edge";

const COOKIE_NAME = "pcfp_session";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-secret-change-me";
}

// Returns the signed-in user's id, or null if there's no valid session.
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const c = store.get(COOKIE_NAME)?.value;
  if (!c) return null;
  return parseSigned(secret(), c);
}

export async function isAuthed(): Promise<boolean> {
  return (await getSessionUserId()) !== null;
}

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  const token = await signValue(secret(), userId);
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days -- field techs keep this installed, no reason to re-prompt often
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
