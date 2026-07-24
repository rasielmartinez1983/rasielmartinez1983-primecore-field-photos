// HMAC signing/verification using the Web Crypto API instead of Node's
// "crypto" module. Node's crypto module isn't available in the Edge
// runtime that Next.js uses for middleware.ts by default, so this shared
// helper (built on globalThis.crypto.subtle, which exists in both the
// Edge runtime and modern Node.js) is used by both lib/session.ts (runs
// as a normal Node.js route handler) and middleware.ts (runs on Edge),
// so the same cookie signature is produced/verified in both places.

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signValue(secret: string, value: string): Promise<string> {
  const h = await hmacHex(secret, value);
  return `${value}.${h}`;
}

export async function verifySigned(secret: string, signed: string): Promise<boolean> {
  return (await parseSigned(secret, signed)) !== null;
}

// Same check as verifySigned, but also hands back the signed value (e.g.
// the logged-in user's id) instead of just true/false.
export async function parseSigned(secret: string, signed: string): Promise<string | null> {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = await hmacHex(secret, value);
  if (sig.length !== expected.length) return null;
  // Simple constant-time-ish compare (no early exit on mismatch). Good
  // enough here -- this guards a login session cookie, not a high-value
  // cryptographic secret.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? value : null;
}
