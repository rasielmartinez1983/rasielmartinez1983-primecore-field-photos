// Parses OCR text from a drawing's title block into the three pieces
// PrimeCore actually wants in the saved filename: the print/drawing
// number (e.g. "E-231722"), the sheet number normalized as "SH-#" (e.g.
// "SH-1"), and a short description line (e.g. "PRIMARY & BACKUP LINE PNL
// AC ELEMENTARY DIAGRAM"). guessDrawingName() below joins them as
// "{number} {SH-#} {description}", matching the title block layout the
// user described (number + sheet bottom-right, description to the left).
// Meant to run against a focused crop of just the title block (see the
// title-block selector in app/folder/[id]/page.tsx) so the OCR text is
// short and clean -- the individual guessXxx() functions are exported too
// in case the review UI ever wants to show/edit the three pieces
// separately, but for now the combined string is always shown as one
// editable field, since the guess is a best effort and never trusted
// blindly.

const NUMBER_LABELED_PATTERN =
  /\b(?:drawing|dwg|print)\.?\s*(?:no|number|#)\.?\s*[:.\-]?\s*([A-Za-z]{1,4}[\s.\-]*\d{2,7})\b/i;
// Bare letter-prefixed code, e.g. "E-231722", "E101", "E- 231722" (OCR/
// dictation sometimes leaves a space around the dash) -- scanned as a
// fallback when there's no explicit "Drawing No." label. Global so a line
// can be checked for every candidate on it, not just the first.
const NUMBER_CODE_PATTERN = /\b([A-Za-z]{1,4})[\s.\-]*(\d{2,7})\b/g;

const SHEET_LABELED_PATTERN = /\bSH(?:EET)?\.?\s*(?:NO\.?|NUMBER|#)?\s*[:\-]?\s*(\d{1,3})\b/i;
const SHEET_OF_PATTERN = /\b(\d{1,3})\s*OF\s*\d{1,3}\b/i;

// The "group code" that sits alone on its own line directly above the
// description block (e.g. "PG-213" over "RINGLING SUBSTATION / 138kV
// STATION COMMON / ..."), used to auto-file the scan into a matching
// subfolder inside As Built Drawings -- see guessGroupCode below. Unlike
// the print number, this only matches a line that's JUST the code (short
// prefix + dash + digits, nothing else on the line), since that's how it
// actually appears in the title block, and it's what distinguishes it
// from the print number/other reference codes that can appear inline
// elsewhere in the block.
const GROUP_CODE_PATTERN = /^([A-Z]{1,3}-\d{2,5})$/i;

// Lines that are clearly title-block boilerplate, not the drawing's
// description -- skipped when guessing the description line.
const JUNK_LINE_PATTERN =
  /^(PRELIMINARY|DIGITAL|ISSUED\b.*|FOR CONSTRUCTION|NOT FOR CONSTRUCTION|APPROVED\b.*|CHECKED\b.*|DRAWN\b.*|SCALE\b.*|DATE\b.*|REV(?:ISION)?S?\b.*)$/i;

function normalizeNumber(raw: string): string {
  const cleaned = raw.trim();
  const m = cleaned.match(/^([A-Za-z]{1,4})[\s.\-]*(\d{2,7})$/);
  if (!m) return cleaned.toUpperCase().replace(/\s+/g, "");
  return `${m[1].toUpperCase()}-${m[2]}`;
}

// The print/drawing number, e.g. "E-231722".
export function guessDrawingNumber(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(NUMBER_LABELED_PATTERN);
  if (labeled) return normalizeNumber(labeled[1]);

  // No explicit label -- collect every letter+digits code on the page,
  // skipping anything that's actually the sheet number ("SH-1"), and
  // prefer the one with the most digits. PrimeCore print numbers run
  // 5-6 digits (e.g. "E-231722"); other reference codes that sometimes
  // sit near the title block (work order #, PL #, etc.) are shorter.
  const candidates: { code: string; digitCount: number }[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    NUMBER_CODE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NUMBER_CODE_PATTERN.exec(line))) {
      const [, letters, digits] = match;
      if (/^SH$/i.test(letters)) continue;
      if (digits.length < 2) continue;
      candidates.push({ code: letters + digits, digitCount: digits.length });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.digitCount - a.digitCount);
  return normalizeNumber(candidates[0].code);
}

// The sheet number, normalized as "SH-1", "SH-2", etc.
export function guessSheetNumber(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(SHEET_LABELED_PATTERN);
  if (labeled) return `SH-${labeled[1]}`;
  const ofMatch = text.match(SHEET_OF_PATTERN);
  if (ofMatch) return `SH-${ofMatch[1]}`;
  return null;
}

// Finds every description-like line (mostly letters, not boilerplate,
// doesn't repeat the number/sheet) and joins all of them, since the
// description is often stacked across 2-3 lines in the title block --
// e.g. "KEENTOWN SUBSTATION" / "DFR CONTROL UNIT" / "ELEMENTARY DIAGRAM"
// is really one description, not three separate candidates to pick just
// one from. Also returns the index of the first matching line so
// guessGroupCode can search only the lines above the description block
// (the group code physically sits right above it in the title block).
function findDescriptionLines(text: string, exclude: string[] = []): { text: string; firstIndex: number } | null {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const matches: string[] = [];
  let firstIndex = -1;
  lines.forEach((line, i) => {
    if (JUNK_LINE_PATTERN.test(line)) return;
    if (SHEET_LABELED_PATTERN.test(line) || SHEET_OF_PATTERN.test(line)) return;
    if (exclude.some((ex) => ex && line.toUpperCase().includes(ex.toUpperCase()))) return;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2) return;
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const digits = (line.match(/[0-9]/g) || []).length;
    if (letters < 6 || digits > letters / 2) return;
    if (firstIndex === -1) firstIndex = i;
    matches.push(line);
  });
  if (matches.length === 0) return null;
  return { text: matches.join(" "), firstIndex };
}

// The description, e.g. "PRIMARY & BACKUP LINE PNL AC ELEMENTARY
// DIAGRAM" -- combines every description-like line into one string (see
// findDescriptionLines above).
export function guessDescription(text: string, exclude: string[] = []): string | null {
  return findDescriptionLines(text, exclude)?.text ?? null;
}

// The group/print-set code above the description (e.g. "PG-213",
// "PL-2314", "S-2345") -- used to auto-file the scan into a matching
// subfolder. Only looks at lines above the description (that's where it
// physically sits in the title block), so it doesn't get confused with
// the print number or other codes that can appear below/beside the
// description instead.
export function guessGroupCode(text: string): string | null {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const description = findDescriptionLines(text);
  const searchLines = description && description.firstIndex >= 0 ? lines.slice(0, description.firstIndex) : lines;
  for (const line of searchLines) {
    const m = line.match(GROUP_CODE_PATTERN);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// Combines the three pieces into "{number} {SH-#} {description}", the
// filename format the user asked for. Any piece that couldn't be found is
// just dropped rather than blocking the guess entirely -- the result is
// always shown as an editable field before saving, never trusted as-is.
export function guessDrawingName(text: string): string | null {
  if (!text) return null;
  const number = guessDrawingNumber(text);
  const sheet = guessSheetNumber(text);
  const description = guessDescription(text, [number || "", sheet || ""]);
  const parts = [number, sheet, description].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" ");
}
