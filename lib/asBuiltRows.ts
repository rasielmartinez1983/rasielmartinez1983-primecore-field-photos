// Gathers the data that feeds the As-Built Submittal Form (see
// lib/asBuiltExcel.ts) for one project: the header fields (pulled from the
// Project row) and one row per As-Built drawing PDF currently saved in
// field-photos, with drawing #/sheet # parsed back out of the filename
// (see lib/drawingName.ts -- guessDrawingName joins them as "{number}
// {SH-#} {description}" when saving, so extracting them back is just
// re-matching that same shape at the front of the filename) and Panel
// Position taken from whichever folder the photo is actually saved in.

import { prisma } from "@/lib/prisma";
import type { AsBuiltHeader, AsBuiltRow } from "./asBuiltExcel";

const AS_BUILT_AREA = "As Built Drawings";

// The two folders every project starts with under As Built Drawings (see
// app/api/projects/route.ts) aren't real panel/group names -- a photo
// sitting directly in one of these (no group code was set) shouldn't get
// its container's own name stamped into Panel Position.
const DEFAULT_CONTAINER_NAMES = new Set(["As Built Drawings", "Highlighted Drawings"]);

// Matches the print/drawing number at the very start of the filename --
// guessDrawingName() always puts it first when present. Same shape as
// drawingName.ts's own NUMBER_LABELED/CODE patterns, just anchored to the
// start of the string instead of scanning OCR text.
const DRAWING_NUMBER_PATTERN = /^([A-Za-z]{1,4}-\d{2,7})\b/;
const SHEET_NUMBER_PATTERN = /\bSH-(\d{1,3})\b/i;

function extractDrawingNumber(filename: string): string {
  const m = filename.match(DRAWING_NUMBER_PATTERN);
  return m ? m[1].toUpperCase() : "";
}

function extractSheetNumber(filename: string): string {
  const m = filename.match(SHEET_NUMBER_PATTERN);
  return m ? m[1] : "";
}

function dateOnly(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type AsBuiltFormData = { header: AsBuiltHeader; rows: AsBuiltRow[] };

// Returns null if the project doesn't exist. An existing project with no
// As Built Drawings photos yet still returns a valid (empty-rows) result --
// callers decide whether an empty form is worth uploading.
export async function buildAsBuiltFormData(projectId: string): Promise<AsBuiltFormData | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      folders: { where: { area: AS_BUILT_AREA }, include: { photos: true } },
    },
  });
  if (!project) return null;

  // Pulled into a plain local so the type helpers below key off a
  // definitely-non-null value -- `typeof project.folders` in a type
  // position doesn't pick up the `if (!project) return null` narrowing
  // above (TS type queries aren't narrowed by runtime control flow the
  // way expressions are), so it would still see `project` as possibly
  // null and fail to compile.
  const folders = project.folders;
  const foldersById = new Map(folders.map((f) => [f.id, f]));

  function topLevelAncestorName(folder: (typeof folders)[number]): string {
    let cur = folder;
    while (cur.parentId) {
      const parent = foldersById.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur.name;
  }

  type RowSource = { row: AsBuiltRow; folderName: string; createdAt: Date };
  const sources: RowSource[] = [];

  for (const folder of folders) {
    // "Highlighted Drawings" holds marked-up/annotated copies of drawings
    // that are already counted from the plain "As Built Drawings" side --
    // including both would double up rows for the same physical drawing.
    if (topLevelAncestorName(folder) === "Highlighted Drawings") continue;

    for (const photo of folder.photos) {
      const panelPosition = DEFAULT_CONTAINER_NAMES.has(folder.name) ? "" : folder.name;
      sources.push({
        row: {
          drawingNumber: extractDrawingNumber(photo.filename),
          sheetNumber: extractSheetNumber(photo.filename),
          panelPosition,
          cause: "",
        },
        folderName: folder.name,
        createdAt: photo.createdAt,
      });
    }
  }

  // Grouped by folder (Panel Position) then save order within each folder
  // -- keeps drawings for the same panel together instead of interleaved
  // by raw save timestamp across different subfolders.
  sources.sort((a, b) => {
    if (a.folderName !== b.folderName) return a.folderName.localeCompare(b.folderName);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const header: AsBuiltHeader = {
    substationLocation: project.substationName || "",
    projectDescription: project.name || "",
    // project.date already mirrors ops.primecore's project creation date
    // (startDate, falling back to createdAt -- see
    // primecore-ops-local/app/api/internal/create-project's route on the
    // ops-local side); falls back again here to field-photos' own
    // createdAt on the off chance date is null.
    date: dateOnly(project.date) || dateOnly(project.createdAt),
    // "The day the PDFs were collected from field-photos" -- since this
    // form is rebuilt fresh every time (see the OneDrive backup routes),
    // that's today, the day of this rebuild.
    dateCollected: todayIso(),
  };

  return { header, rows: sources.map((s) => s.row) };
}
