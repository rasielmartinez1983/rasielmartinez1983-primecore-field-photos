// Guesses a drawing number/title from a photographed drawing's OCR text,
// for the As Built Drawings scan flow (see app/api/photos/route.ts). This
// is a best-effort heuristic -- title blocks vary a lot between drawing
// sets -- so the caller always shows the result to the person as an
// editable field before saving, never silently trusts it. Returns null if
// nothing plausible was found; the UI falls back to a blank/typed name.

// Label patterns that precede an actual drawing number on the same line,
// e.g. "DWG NO: E-101", "Drawing Number SK-2045", "DWG. NO. 4521-A".
const LABELED_PATTERN =
  /\b(?:drawing|dwg)\.?\s*(?:no|number|#)\.?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\-.\/]{2,24})/i;

// A bare drawing-number-shaped code anywhere in the text, e.g. "E-101",
// "SK-2045", "S-1.1", "12345-E1", "PE-4521-A" -- letters/digits with at
// least one dash, dot, or digit run, not just a plain word. Sheet-style
// numbers (single digit, like "S-1" or "E-2.1") are just as common as
// longer ones, so the digit run only needs to be at least 1 long.
const CODE_PATTERN = /\b([A-Z]{1,4}-?\d{1,6}(?:[-.][A-Z0-9]{1,6})?)\b/;

export function guessDrawingName(text: string): string | null {
  if (!text) return null;

  const labeled = text.match(LABELED_PATTERN);
  if (labeled) {
    const candidate = labeled[1].trim().replace(/[.\-]+$/, "");
    if (candidate.length >= 2) return candidate;
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Title blocks are usually near the bottom of the sheet -- Vision reads
  // in roughly top-to-bottom order, so scan from the end first.
  for (const line of [...lines].reverse()) {
    const code = line.match(CODE_PATTERN);
    if (code) return code[1];
  }

  return null;
}
