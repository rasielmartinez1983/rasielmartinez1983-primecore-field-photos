// Finds the ops.primecore OneDrive project folder that matches a Field
// Photos project, so "Save to OneDrive" here lands inside the same
// project folder ops.primecore already created (see
// primecore-ops-local/lib/projectFolder.ts -- the folder structure is
// "Projectos <year>/<Project#>_<Client>_<Substation>_<Name>_<Date>/AMPS/...").
//
// Field Photos has its own database, separate from ops.primecore -- there
// is no shared project id or number to join on. Instead, the user names
// the Field Photos project identically to the ops.primecore project's
// Name (the 3rd underscore-delimited segment of the folder name), and
// this looks for a folder under any "Projectos <year>" whose Name segment
// matches.
//
// Also still recognizes the OLD "<year>-<Project#>-<Name>" folder format
// (folders created before this naming change) by falling back to an
// endsWith("-<name>") check, so projects created before this rewrite keep
// working without needing to be renamed in OneDrive.
//
// Deliberately lists folders directly (root/children, then each "Projectos
// <year>"/children) instead of using Microsoft Graph's search API --
// search runs against a separate index that can lag several minutes
// (sometimes longer) behind a folder that was just created, which made
// "Save to OneDrive" fail right after a brand-new project's folder had
// already been created. Listing children reads the live folder structure
// directly, so a folder created seconds ago is found immediately.

import { listFolder, getItem } from "./msGraph";

// Root folder inside the drive that everything else here lives under --
// "General" is the actual folder name backing Teams' default channel (see
// primecore-ops-local/lib/projectFolder.ts's sharepointRoot(), which this
// mirrors). Must stay in sync with that app and with ExcelApp's
// onedrive_backup.py, since all three find these same project folders by
// name within this same root.
function sharepointRoot(): string {
  return process.env.MICROSOFT_SHAREPOINT_ROOT_FOLDER || "General";
}

// Returns the drive-relative path of the matching project folder (e.g.
// "General/Projectos 2026/2451_FPL_Clover Substation_2026-08-05"), or null
// if nothing matches.
export async function findProjectFolderPath(name: string): Promise<string | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;

  const root = await listFolder(sharepointRoot());
  const yearFolders = root.filter((r) => r.isFolder && r.name.startsWith("Projectos "));

  const candidates: { path: string; folder: string; exact: boolean }[] = [];
  for (const yearFolder of yearFolders) {
    let children;
    try {
      children = await listFolder(`${sharepointRoot()}/${yearFolder.name}`);
    } catch {
      continue; // best-effort -- one bad/empty year folder shouldn't block the others
    }
    for (const child of children) {
      if (!child.isFolder) continue;
      const folderName = child.name.trim();

      // Current format: "<Project#>_<Client>_<Substation>_<Name>_<Date>"
      // -- exactly 5 underscore-delimited segments (each segment has its
      // own underscores stripped when the folder is created, so a real
      // match always has exactly 5 parts). The Name is the 4th segment.
      //
      // Previous format: "<Project#>_<Client>_<Name>_<Date>" -- 4
      // segments, Name is the 3rd. Folders created before Substation was
      // added are NOT renamed in OneDrive, so both are still matched.
      const parts = folderName.split("_");
      if (parts.length === 5 && parts[3].trim().toLowerCase() === target) {
        candidates.push({ path: `${sharepointRoot()}/${yearFolder.name}/${folderName}`, folder: folderName, exact: true });
        continue;
      }
      if (parts.length === 4 && parts[2].trim().toLowerCase() === target) {
        candidates.push({ path: `${sharepointRoot()}/${yearFolder.name}/${folderName}`, folder: folderName, exact: true });
        continue;
      }

      // Old format: "<year>-<Project#>-<Name>".
      if (folderName.toLowerCase().endsWith(`-${target}`)) {
        candidates.push({ path: `${sharepointRoot()}/${yearFolder.name}/${folderName}`, folder: folderName, exact: false });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Prefer an exact new-format Name match over an old-format suffix
  // match; among ties, prefer the shortest folder name -- the closest
  // match with the least extra text.
  candidates.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return a.folder.length - b.folder.length;
  });
  return candidates[0].path;
}

// ops.primecore now names each of a project's subfolders
// "<Client>_<Substation>_<Type>_<Date>" (e.g. "FPL_Sheridan_AMPS_2026-08-05")
// instead of the old plain type name ("AMPS") -- see the matching change
// in primecore-ops-local's lib/projectFolder.ts (subfolderName). That's
// new-projects-only, so an already-existing project's subfolders are still
// plain. Rather than re-deriving Client/Substation from field-photos' own
// (separate) database -- which could drift from what ops.primecore actually
// used -- this pulls them straight out of the matched project folder's own
// name, guaranteeing an exact match whenever that folder does use the
// 5-segment new format. Returns null (caller should use the plain name
// instead) for the legacy 4-segment format, which predates Substation
// entirely and therefore can't have gotten new-format subfolders either.
function newFormatSubfolderName(projectFolderName: string, type: string): string | null {
  const parts = projectFolderName.split("_");
  if (parts.length < 5) return null;
  const client = parts[1];
  const substation = parts[2];
  const date = parts[parts.length - 1];
  return `${client}_${substation}_${type}_${date}`;
}

// Resolves the actual on-disk path of one of a project's subfolders
// (matchedFolderPath is findProjectFolderPath's result, the project's own
// folder). Tries the new Client_Substation_Type_Date name first (the
// common case for any project created after that change shipped), falling
// back to the old plain type name otherwise -- see newFormatSubfolderName
// above. If neither exists yet, returns the plain path (matches this
// route's own long-standing behavior for a folder OneDrive will create on
// first upload into it).
export async function resolveSubfolderPath(matchedFolderPath: string, type: string): Promise<string> {
  const folderName = matchedFolderPath.split("/").pop() || "";
  const newName = newFormatSubfolderName(folderName, type);
  if (newName) {
    const newPath = `${matchedFolderPath}/${newName}`;
    if (await getItem(newPath)) return newPath;
  }
  return `${matchedFolderPath}/${type}`;
}
