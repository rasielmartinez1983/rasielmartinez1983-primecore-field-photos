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
// (keep_vba=True) does -- exceljs only round-trips it. Since the macros
// aren't needed once the form is filled in for submission, data/
// AsBuiltSubmittalFormBlank.xlsx (converted from the original .xlsm, same
// layout, macros dropped) is the template here.
//
// Layout (identical to the Python version -- read off the same real FPL
// template):
//   - One-time header fields, filled once per document.
//   - A 30-row table repeated in TWO side-by-side blocks (drawings 1-30 in
//     columns B/C/D/E, drawings 31-60 in columns G/H/I/J), rows 12-41 in
//     both blocks.
//   - Batches over 60 drawings spill onto additional copies of the sheet
//     (see cloneWorksheet below), same as the Python version.

import ExcelJS from "exceljs";
import fs from "fs/promises";
import path from "path";

const TEMPLATE_PATH = path.join(process.cwd(), "data", "AsBuiltSubmittalFormBlank.xlsx");

export const SHEET_NAME = "As Built Submittal Form (1)";

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

// Excel worksheet titles cap at 31 characters and disallow duplicates in
// the same workbook. Page 1 keeps the template's own sheet name untouched
// (SHEET_NAME above). Page 2+: the real template's name already ends in
// " (1)", so the cleanest option -- guaranteed to fit, since the original
// already fit -- is swapping that trailing number for the page number
// (e.g. "... (2)"). Only falls back to an appended/truncated suffix if the
// title doesn't end that way, and even then truncates at the last whole
// word rather than mid-word (see the matching comment in excel_fill.py --
// an earlier version of that logic cut "...Submittal Form (1)" down to
// "...Submittal For (page 2)", silently dropping the "m" off "Form").
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

// exceljs has no built-in "duplicate this worksheet" -- this copies
// values, per-cell styles (font/fill/border/alignment/numFmt), row
// heights, column widths, and merged-cell ranges from `source` onto a
// freshly added worksheet named `title`. Good enough for this form (no
// images/charts/data-validation dropdowns on it to worry about losing).
function cloneWorksheet(workbook: ExcelJS.Workbook, source: ExcelJS.Worksheet, title: string): ExcelJS.Worksheet {
  const target = workbook.addWorksheet(title);

  source.eachRow({ includeEmpty: true }, (row: ExcelJS.Row, rowNumber: number) => {
    const targetRow = target.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, colNumber: number) => {
      const targetCell = targetRow.getCell(colNumber);
      targetCell.value = cell.value;
      targetCell.style = { ...cell.style };
    });
    if (row.height) targetRow.height = row.height;
    targetRow.commit();
  });

  source.columns.forEach((col: Partial<ExcelJS.Column>, i: number) => {
    const targetCol = target.getColumn(i + 1);
    if (col.width) targetCol.width = col.width;
  });

  // source.model.merges is a flat array of range strings, e.g. "B6:F6".
  for (const range of (source.model as any).merges || []) {
    try {
      target.mergeCells(range);
    } catch {
      // Skip a merge that doesn't apply cleanly rather than failing the
      // whole page -- cosmetic only, never blocks getting the data in.
    }
  }

  return target;
}

function setHeaderCells(ws: ExcelJS.Worksheet, header: AsBuiltHeader) {
  for (const [key, coord] of Object.entries(HEADER_CELLS)) {
    const value = (header as Record<string, string | undefined>)[key];
    if (value) ws.getCell(coord).value = value;
  }
}

function setRowCells(ws: ExcelJS.Worksheet, pageRows: AsBuiltRow[]) {
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
    if (row.drawingNumber) ws.getCell(`${drawingCol}${r}`).value = row.drawingNumber;
    if (row.sheetNumber) ws.getCell(`${sheetCol}${r}`).value = row.sheetNumber;
    if (row.panelPosition) ws.getCell(`${panelCol}${r}`).value = row.panelPosition;
    if (row.cause) ws.getCell(`${causeCol}${r}`).value = row.cause;
  });
}

// header is filled onto every page so each one is self-contained if
// printed separately. rows can be any length -- batches beyond the first
// 60 spill onto additional pages (see sheetTitleForPage/cloneWorksheet
// above), matching the Python version's behavior. Returns the filled
// workbook as .xlsx bytes.
export async function fillAsBuiltForm(header: AsBuiltHeader, rows: AsBuiltRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const templateBytes = await fs.readFile(TEMPLATE_PATH);
  // exceljs's bundled type declarations predate the newer generic
  // Buffer<ArrayBufferLike> shape @types/node now returns from
  // fs.readFile() (it added maxByteLength/resizable/resize/detached etc.),
  // so TS sees them as structurally incompatible even though this is a
  // real Node Buffer at runtime, which is all xlsx.load() actually needs.
  // The cast-through-unknown just satisfies the compiler.
  await workbook.xlsx.load(templateBytes as unknown as Buffer);

  const baseWs = workbook.getWorksheet(SHEET_NAME);
  if (!baseWs) {
    throw new Error(`Template is missing the expected "${SHEET_NAME}" sheet.`);
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_SHEET));

  const worksheets: ExcelJS.Worksheet[] = [baseWs];
  for (let pageNum = 2; pageNum <= pageCount; pageNum++) {
    worksheets.push(cloneWorksheet(workbook, baseWs, sheetTitleForPage(SHEET_NAME, pageNum)));
  }

  worksheets.forEach((ws, idx) => {
    const pageNum = idx + 1;
    setHeaderCells(ws, header);
    const pageRows = rows.slice((pageNum - 1) * ROWS_PER_SHEET, pageNum * ROWS_PER_SHEET);
    setRowCells(ws, pageRows);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
