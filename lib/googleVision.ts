import crypto from "crypto";

// Same Google Cloud Vision service-account auth pattern already used in
// primecore-ops-local for receipt OCR (see that repo's
// app/api/expenses/scan-receipt/route.ts) -- reuses the same
// GOOGLE_VISION_CREDENTIALS_JSON service account, just a different Vision
// feature (text bounding boxes instead of full receipt text parsing).

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const base64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: credentials.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(header)}.${base64url(claimSet)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("base64url");
  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch(credentials.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new Error(`Failed to get Google access token: ${detail}`);
  }

  const tokenData = await tokenRes.json();
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// Runs DOCUMENT_TEXT_DETECTION (Vision's mode tuned for dense printed
// text/documents, not scattered signage like plain TEXT_DETECTION) and
// returns the full text it read off the page, top to bottom. Used by the
// As Built Drawings scan flow (see lib/drawingName.ts) to guess a drawing
// number/title from a photographed title block. Returns null if Vision
// found no text, isn't configured, or the request failed -- callers treat
// that the same as "couldn't guess a name" and fall back to letting the
// person type one in.
export async function extractFullText(base64Content: string): Promise<string | null> {
  const credsRaw = process.env.GOOGLE_VISION_CREDENTIALS_JSON;
  if (!credsRaw) return null;

  let credentials: ServiceAccountCredentials;
  try {
    credentials = JSON.parse(credsRaw);
  } catch {
    return null;
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(credentials);
  } catch {
    return null;
  }

  let visionRes: Response;
  try {
    visionRes = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Content },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!visionRes.ok) return null;

  const data = await visionRes.json();
  const text: string = data.responses?.[0]?.fullTextAnnotation?.text || "";
  return text || null;
}

export type BoundingBox = { x0: number; y0: number; x1: number; y1: number };

// Runs TEXT_DETECTION and returns the bounding box of ALL text found in the
// image (textAnnotations[0] is Vision's own union box covering every piece
// of text it detected) -- a decent proxy for "where the nameplate's
// information is" vs. the surrounding equipment/background in the shot.
// Returns null if Vision found no text, or isn't configured.
export async function detectTextBoundingBox(base64Content: string): Promise<BoundingBox | null> {
  const credsRaw = process.env.GOOGLE_VISION_CREDENTIALS_JSON;
  if (!credsRaw) return null;

  let credentials: ServiceAccountCredentials;
  try {
    credentials = JSON.parse(credsRaw);
  } catch {
    return null;
  }

  const accessToken = await getAccessToken(credentials);

  const visionRes = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Content },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!visionRes.ok) return null;

  const data = await visionRes.json();
  const vertices = data.responses?.[0]?.textAnnotations?.[0]?.boundingPoly?.vertices;
  if (!vertices || vertices.length === 0) return null;

  const xs = vertices.map((v: { x?: number }) => v.x || 0);
  const ys = vertices.map((v: { y?: number }) => v.y || 0);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
