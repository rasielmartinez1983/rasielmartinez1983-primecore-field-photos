import { NextRequest, NextResponse } from "next/server";

// As Built Drawings scan flow: given a photo of a drawing (usually a
// focused crop of just the title block -- see the title-block selector
// in app/folder/[id]/page.tsx, though this falls back to the full photo
// if that step was skipped), reads the title block directly with
// Claude's vision and guesses the drawing number/sheet/description/
// group-code that pre-fill the save screen's editable fields. Replaces
// the old Google Vision DOCUMENT_TEXT_DETECTION + regex-parsing
// approach (see the previous lib/googleVision.ts + lib/drawingName.ts
// pairing, now removed) -- those regexes had to guess which line was
// the description vs. boilerplate, which code was the print number vs.
// some other reference code, etc.; Claude reads the title block the way
// a person would and reports the four pieces directly.
//
// Talks to Anthropic's Messages API over raw fetch, same pattern as
// primecore-ops-local's lib/assistant.ts and scan-receipt route: npm's
// registry is blocked from the sandbox this gets built/tested in, so
// @anthropic-ai/sdk can't be installed here, but a raw HTTP call works
// identically once deployed on Vercel.
//
// Detection failing (ANTHROPIC_API_KEY not configured, no text found,
// network hiccup) should never block someone from typing a name
// themselves, so this always returns 200 with guessedName/guessedGroup:
// null rather than an error status -- same fail-soft rule the old
// implementation followed.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const DRAWING_TITLE_BLOCK_TOOL = {
  name: "report_title_block",
  description: "Report the print number, sheet number, description, and group code read from a drawing's title block.",
  input_schema: {
    type: "object",
    properties: {
      number: {
        type: ["string", "null"],
        description:
          'The print/drawing number, normalized as LETTERS-DIGITS (e.g. "E-231722"). Usually labeled "Drawing No." / "Dwg No." / "Print No.", or just printed bare near the title block. Prefer the code with the most digits if several codes appear and none is explicitly labeled -- PrimeCore print numbers run 5-6 digits, other reference codes nearby (work order #, PL #) are shorter. Null if unreadable.',
      },
      sheet: {
        type: ["string", "null"],
        description:
          'The sheet number, normalized as "SH-#" (e.g. "SH-1"). Usually labeled "SHEET" / "SH NO." or written as "1 OF 3". Null if unreadable or not present.',
      },
      description: {
        type: ["string", "null"],
        description:
          'The drawing\'s descriptive title, e.g. "PRIMARY & BACKUP LINE PNL AC ELEMENTARY DIAGRAM". This is often stacked across 2-3 lines in the title block (e.g. substation name / equipment / diagram type) -- join those into one string. Do not include boilerplate like "PRELIMINARY", "ISSUED FOR CONSTRUCTION", "APPROVED BY", scale, date, or revision notes. Null if unreadable.',
      },
      groupCode: {
        type: ["string", "null"],
        description:
          'A short print-set code that sits ALONE on its own line directly above the description block (e.g. "PG-213", "PL-2314", "S-2345") -- a prefix of 1-3 letters, a dash, then 2-5 digits, with nothing else on that line. This is different from the print number -- do not confuse them. Null if no such standalone code line is present.',
      },
    },
    required: ["number", "sheet", "description", "groupCode"],
  },
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function cleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.image) {
    return NextResponse.json({ error: "image is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ guessedName: null, guessedGroup: null, rawText: "" });
  }

  const dataUrl: string = body.image;
  const commaIdx = dataUrl.indexOf(",");
  const base64Content = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const mediaTypeMatch = commaIdx >= 0 ? dataUrl.slice(0, commaIdx).match(/data:([^;]+);base64/) : null;
  const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : "image/jpeg";

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [DRAWING_TITLE_BLOCK_TOOL],
        tool_choice: { type: "tool", name: "report_title_block" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Content } },
              {
                type: "text",
                text: "Read this drawing's title block and report the print number, sheet number, description, and group code via the report_title_block tool.",
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ guessedName: null, guessedGroup: null, rawText: "" });
    }

    const data = await res.json();
    const content: AnthropicContentBlock[] = data.content || [];
    const toolUse = content.find(
      (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === "report_title_block"
    );
    if (!toolUse) {
      return NextResponse.json({ guessedName: null, guessedGroup: null, rawText: "" });
    }

    const input = toolUse.input || {};
    const number = cleanString(input.number);
    const sheet = cleanString(input.sheet);
    const description = cleanString(input.description);
    const groupCode = cleanString(input.groupCode);

    // Combines the three pieces into "{number} {SH-#} {description}", the
    // filename format the save screen expects (matches the old
    // guessDrawingName()'s output shape) -- any missing piece is just
    // dropped rather than blocking the guess entirely.
    const nameParts = [number, sheet, description].filter(Boolean);
    const guessedName = nameParts.length ? nameParts.join(" ") : null;

    return NextResponse.json({ guessedName, guessedGroup: groupCode, rawText: "" });
  } catch {
    return NextResponse.json({ guessedName: null, guessedGroup: null, rawText: "" });
  }
}
