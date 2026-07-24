import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId, setSessionCookie } from "@/lib/session";
import { RP_ID, RP_NAME, ORIGIN } from "@/lib/webauthn";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";

// One file handles the whole Face ID flow (register + sign in), using a
// catch-all path segment.
//
// Every account is created with a username + password first (see
// /api/auth); Face ID is always added afterward from inside an existing
// session -- there's no more "first device claims the app" bootstrap now
// that real accounts exist. Signing in with a passkey never requires a
// session first, though -- that's the whole point -- and since it's a
// discoverable/usernameless flow, the device itself decides whose face it
// recognizes and the server just looks up which user owns that passkey.

const CEREMONY_COOKIE = "pcfp_webauthn_ceremony";

function setCeremonyCookie(res: NextResponse, challenge: string) {
  res.cookies.set(CEREMONY_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300, // 5 minutes -- just long enough for the Face ID prompt
  });
}

function clearCeremonyCookie(res: NextResponse) {
  res.cookies.set(CEREMONY_COOKIE, "", { path: "/", maxAge: 0 });
}

function readCeremonyCookie(req: NextRequest): string | null {
  return req.cookies.get(CEREMONY_COOKIE)?.value || null;
}

export async function GET() {
  // Lists the current user's own passkeys, for the Face ID settings page.
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    select: { id: true, label: true, deviceType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(passkeys);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action } = await ctx.params;
  const step = action?.[0];

  if (step === "register-options") {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Log in first." }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const existing = await prisma.passkey.findMany({ where: { userId } });
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: isoUint8Array.fromUTF8String(user.id),
      userName: user.username,
      userDisplayName: user.name || user.username,
      attestationType: "none",
      excludeCredentials: existing.map((pk) => ({
        id: pk.id,
        transports: (pk.transports ? pk.transports.split(",") : undefined) as never,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
    });

    const res = NextResponse.json(options);
    setCeremonyCookie(res, options.challenge);
    return res;
  }

  if (step === "register-verify") {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Log in first." }, { status: 401 });

    const challenge = readCeremonyCookie(req);
    if (!challenge) {
      return NextResponse.json({ error: "Registration session expired. Try again." }, { status: 400 });
    }

    const body = await req.json();

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
    } catch {
      return NextResponse.json({ error: "Could not verify Face ID. Try again." }, { status: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Could not verify Face ID. Try again." }, { status: 400 });
    }

    // @simplewebauthn/server v10 uses the flat field names here
    // (credentialID/credentialPublicKey) rather than a nested "credential".
    const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    const transports: string[] | undefined = body?.response?.transports;
    const label = String(body?.label || "").trim() || null;

    await prisma.passkey.create({
      data: {
        id: credentialID,
        userId,
        publicKey: isoBase64URL.fromBuffer(credentialPublicKey),
        counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: transports && transports.length > 0 ? transports.join(",") : null,
        label,
      },
    });

    const res = NextResponse.json({ ok: true });
    clearCeremonyCookie(res);
    return res;
  }

  if (step === "login-options") {
    // Discoverable/usernameless -- no allowCredentials list, so the device
    // shows every Face ID passkey it has stored for this site (across
    // every account) and the person just picks/confirms their own.
    // (Passkeys were registered with residentKey: "preferred", which is
    // what makes them discoverable like this.)
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
    });
    const res = NextResponse.json(options);
    setCeremonyCookie(res, options.challenge);
    return res;
  }

  if (step === "login-verify") {
    const challenge = readCeremonyCookie(req);
    if (!challenge) {
      return NextResponse.json({ error: "Sign-in session expired. Try again." }, { status: 400 });
    }

    const body = await req.json();
    const passkey = await prisma.passkey.findUnique({ where: { id: body.id } });
    if (!passkey) {
      return NextResponse.json({ error: "Face ID not recognized." }, { status: 401 });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        // v10 calls this "authenticator", with the older flat field names.
        authenticator: {
          credentialID: passkey.id,
          credentialPublicKey: isoBase64URL.toBuffer(passkey.publicKey),
          counter: passkey.counter,
          transports: (passkey.transports ? passkey.transports.split(",") : undefined) as never,
        },
      });
    } catch {
      return NextResponse.json({ error: "Could not verify Face ID. Try again." }, { status: 400 });
    }

    if (!verification.verified) {
      return NextResponse.json({ error: "Could not verify Face ID. Try again." }, { status: 400 });
    }

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });

    await setSessionCookie(passkey.userId);
    const res = NextResponse.json({ ok: true });
    clearCeremonyCookie(res);
    return res;
  }

  if (step === "remove") {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

    const body = await req.json();
    const passkey = await prisma.passkey.findUnique({ where: { id: body.id } });
    if (!passkey || passkey.userId !== userId) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    // No "last one" guard needed anymore -- password sign-in is always
    // there as a fallback for this account.
    await prisma.passkey.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 404 });
}
