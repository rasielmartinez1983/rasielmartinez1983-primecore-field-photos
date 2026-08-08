// Fills FPL's "As-Built Submittal Form" from a project's As Built Drawings
// -- a TypeScript port of primecore-asbuilt-batch's lib/excel_fill.py
// (fill_form), which does the same thing against a Python-side .xlsm
// template with exact cell coordinates read off the real FPL form. Ported
// here so field-photos can generate/refresh this Excel itself as part of
// its existing "Save to OneDrive" flow (see app/api/onedrive/backup-*),
// instead of requiring a separate manual download/re-upload into the
// standalone asbuilt-batch tool.
//
// Difference from the Python version: this produces a plain .xlsx, not
// .xlsm. field-photos is a Node/TypeScript app and there's no library here
// that preserves an .xlsm's embedded VBA project the way Python's openpyxl
// (keep_vba=True) does. Since the macros aren't needed once the form is
// filled in for submission, data/AsBuiltSubmittalFormBlank.xlsx (converted
// from the original .xlsm, same layout, macros dropped) is the template
// here.
//
// IMPLEMENTATION NOTE -- why this edits raw XML instead of using a
// full-featured Excel library like exceljs:
//
// An earlier version of this file used exceljs (load template -> set cell
// values -> writeBuffer). That produced files real Excel refused to open
// cleanly -- "We found a problem with some content" / "Workbook Repaired",
// silently stripping every cell's content down to a blank sheet. Traced
// this down to a genuine exceljs bug: even loading the template and
// writing it back out completely UNMODIFIED corrupts it. Diffing the raw
// OOXML of the original (opens fine) against exceljs's round-tripped copy
// (corrupt) showed exceljs's style-table writer emits an extra
// `<fill><patternFill/></fill>` (no patternType attribute) at a fill index
// other than 0 -- per the OOXML spec, only fill index 0 is allowed to omit
// patternType (it's the implicit "none" builtin); anywhere else that's
// invalid and real Excel's stricter parser rejects it, even though
// exceljs's own (lenient) reader and Python's openpyxl both happily read
// it back and made this very hard to catch locally.
//
// Rather than fight exceljs's style serializer, this module never asks any
// library to re-serialize xl/styles.xml, xl/theme/theme1.xml, or
// xl/sharedStrings.xml at all -- those parts are copied byte-for-byte from
// the known-good template (verified to open cleanly in real Excel) via
// JSZip, and only the worksheet XML's empty <c> cell elements are patched
// in place with inline string values (t="inlineStr"), never touching
// anything that isn't a cell this module actually fills in. Every
// coordinate written here is confirmed (by hand, against the real
// template's XML) to already exist as a pre-styled, empty cell, so this
// never needs to invent a new <c> element or renumber any style index.
//
// Batches over 60 drawings still spill onto additional pages, same as the
// Python version -- done here by duplicating the base worksheet's XML part
// verbatim (same styles/merges/dimension, just filled with the next 60
// rows) rather than asking a library to "clone a worksheet", for the same
// reason: it's a plain copy of already-valid XML, so it can't introduce a
// new style-table bug.

import JSZip from "jszip";
import fs from "fs/promises";
import path from "path";

const TEMPLATE_PATH = path.join(process.cwd(), "data", "AsBuiltSubmittalFormBlank.xlsx");

export const SHEET_NAME = "As Built Submittal Form (1)";

// The template's worksheet parts are xl/worksheets/sheet1.xml (SHEET_NAME)
// and xl/worksheets/sheet2.xml ("Sheet1", an unrelated VBA-helper tab left
// over from the original .xlsm -- see workbook.xml's <sheets> ordering).
const BASE_SHEET_PART = "xl/worksheets/sheet1.xml";

const FIRST_ROW = 12;
const LAST_ROW = 41;
const BLOCK_SIZE = LAST_ROW - FIRST_ROW + 1; // 30 rows per block, 60 drawings per sheet
const ROWS_PER_SHEET = BLOCK_SIZE * 2; // 60

const HEADER_CELLS: Record<string, string> = {
  fromName: "B6",
  senderPhone: "G6",
  projectEngineer: "B7",
  substationLocation: "G7",
  projectDescription: "B8",
  area: "G8",
  ioNumber: "B9",
  date: "G9",
  comments: "B42",
  collectedBy: "C44",
  dateCollected: "J44",
};

export type AsBuiltHeader = Partial<{
  fromName: string;
  senderPhone: string;
  projectEngineer: string;
  substationLocation: string;
  projectDescription: string;
  area: string;
  ioNumber: string;
  date: string;
  comments: string;
  collectedBy: string;
  dateCollected: string;
}>;

export type AsBuiltRow = {
  drawingNumber: string;
  sheetNumber: string;
  panelPosition: string;
  cause: string;
};

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Excel worksheet titles cap at 31 characters and disallow duplicates in
// the same workbook. Page 1 keeps the template's own sheet name untouched
// (SHEET_NAME above). Page 2+: the real template's name already ends in
// " (1)", so the cleanest option -- guaranteed to fit, since the original
// already fit -- is swapping that trailing number for the page number
// (e.g. "... (2)"). Only falls back to an appended/truncated suffix if the
// title doesn't end that way, and even then truncates at the last whole
// word rather than mid-word.
function sheetTitleForPage(baseTitle: string, pageNum: number): string {
  if (pageNum === 1) return baseTitle;
  const trailingOne = baseTitle.match(/^(.*)\(1\)\s*$/);
  if (trailingOne) {
    const candidate = `${trailingOne[1].trimEnd()} (${pageNum})`;
    if (candidate.length <= 31) return candidate;
  }
  const suffix = ` p${pageNum}`;
  if (baseTitle.length + suffix.length <= 31) return baseTitle + suffix;
  const maxBaseLen = 31 - suffix.length;
  const truncated = baseTitle.slice(0, maxBaseLen).replace(/\s+\S*$/, "");
  return truncated + suffix;
}

// Replaces one <c r="COORD" .../> (or <c r="COORD" ...></c>) element's
// content with an inline string, preserving whatever style (s="N") the
// template cell already had. Every coordinate this module writes to is a
// pre-formatted, empty cell in the real template (confirmed by hand
// against the raw XML) -- a miss here means the template changed shape
// and is worth logging rather than silently swallowing or throwing (a
// missing decorative field shouldn't block the rest of the form).
function setCellValue(sheetXml: string, coord: string, value: string): string {
  const cellPattern = new RegExp(`<c r="${coord}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  if (!cellPattern.test(sheetXml)) {
    console.warn(`asBuiltExcel: cell ${coord} not found in template worksheet XML -- value skipped.`);
    return sheetXml;
  }
  return sheetXml.replace(cellPattern, (_match, attrs: string) => {
    const styleMatch = attrs.match(/\ss="(\d+)"/);
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : "";
    return `<c r="${coord}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  });
}

function fillSheetXml(sheetXml: string, header: AsBuiltHeader, pageRows: AsBuiltRow[]): string {
  let xml = sheetXml;

  for (const [key, coord] of Object.entries(HEADER_CELLS)) {
    const value = (header as Record<string, string | undefined>)[key];
    if (value) xml = setCellValue(xml, coord, value);
  }

  pageRows.forEach((row, i) => {
    let r: number;
    let cols: [string, string, string, string];
    if (i < BLOCK_SIZE) {
      r = FIRST_ROW + i;
      cols = ["B", "C", "D", "E"];
    } else {
      r = FIRST_ROW + (i - BLOCK_SIZE);
      cols = ["G", "H", "I", "J"];
    }
    const [drawingCol, sheetCol, panelCol, causeCol] = cols;
    if (row.drawingNumber) xml = setCellValue(xml, `${drawingCol}${r}`, row.drawingNumber);
    if (row.sheetNumber) xml = setCellValue(xml, `${sheetCol}${r}`, row.sheetNumber);
    if (row.panelPosition) xml = setCellValue(xml, `${panelCol}${r}`, row.panelPosition);
    if (row.cause) xml = setCellValue(xml, `${causeCol}${r}`, row.cause);
  });

  return xml;
}

async function readZipPart(zip: JSZip, partName: string): Promise<string> {
  const file = zip.file(partName);
  if (!file) throw new Error(`Template is missing expected part "${partName}".`);
  return file.async("string");
}

// header is filled onto every page so each one is self-contained if
// printed separately. rows can be any length -- batches beyond the first
// 60 spill onto additional pages (see sheetTitleForPage above), matching
// the Python version's behavior. Returns the filled workbook as .xlsx
// bytes.
export async function fillAsBuiltForm(header: AsBuiltHeader, rows: AsBuiltRow[]): Promise<Buffer> {
  const templateBytes = await fs.readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBytes);

  const baseSheetXml = await readZipPart(zip, BASE_SHEET_PART);

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_SHEET));

  // Page 1: fill straight into the existing part.
  zip.file(BASE_SHEET_PART, fillSheetXml(baseSheetXml, header, rows.slice(0, ROWS_PER_SHEET)));

  if (pageCount > 1) {
    const workbookXml = await readZipPart(zip, "xl/workbook.xml");
    const relsXml = await readZipPart(zip, "xl/_rels/workbook.xml.rels");
    const contentTypesXml = await readZipPart(zip, "[Content_Types].xml");

    const existingRIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    const existingSheetIds = [...workbookXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
    const existingPartNums = Object.keys(zip.files)
      .map((f) => f.match(/^xl\/worksheets\/sheet(\d+)\.xml$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1]));

    let nextPartNum = Math.max(...existingPartNums) + 1;
    let nextRId = Math.max(...existingRIds) + 1;
    let nextSheetId = Math.max(...existingSheetIds) + 1;

    let newWorkbookXml = workbookXml;
    let newRelsXml = relsXml;
    let newContentTypesXml = contentTypesXml;

    // codeName is a VBA-project internal identifier and should be unique
    // per sheet in a workbook with an active VBA project. This .xlsx has
    // no vbaProject.bin (macros were dropped converting from the original
    // .xlsm), so a duplicate codeName is harmless either way -- stripped
    // here anyway since there's no reason to carry it over.
    const cloneTemplateXml = baseSheetXml.replace(/ codeName="[^"]*"/, "");

    for (let pageNum = 2; pageNum <= pageCount; pageNum++) {
      const partName = `xl/worksheets/sheet${nextPartNum}.xml`;
      const rId = `rId${nextRId}`;
      const title = sheetTitleForPage(SHEET_NAME, pageNum);
      const pageRows = rows.slice((pageNum - 1) * ROWS_PER_SHEET, pageNum * ROWS_PER_SHEET);

      zip.file(partName, fillSheetXml(cloneTemplateXml, header, pageRows));

      newRelsXml = newRelsXml.replace(
        "</Relationships>",
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextPartNum}.xml"/></Relationships>`
      );
      newContentTypesXml = newContentTypesXml.replace(
        "</Types>",
        `<Override PartName="/${partName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
      );
      newWorkbookXml = newWorkbookXml.replace(
        "</sheets>",
        `<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${xmlEscape(title)}" sheetId="${nextSheetId}" state="visible" r:id="${rId}"/></sheets>`
      );

      nextPartNum++;
      nextRId++;
      nextSheetId++;
    }

    zip.file("xl/workbook.xml", newWorkbookXml);
    zip.file("xl/_rels/workbook.xml.rels", newRelsXml);
    zip.file("[Content_Types].xml", newContentTypesXml);
  }

  // Explicit DEFLATE -- JSZip defaults to no compression (STORE), which
  // Excel opens fine but produces a needlessly large file compared to a
  // normal .xlsx (every real xlsx writer, including the original
  // openpyxl-produced template, compresses its parts).
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
