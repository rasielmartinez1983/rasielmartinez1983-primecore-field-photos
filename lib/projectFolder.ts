// Finds the ops.primecore OneDrive project folder that matches a Field
// Photos project, so "Save to OneDrive" here lands inside the same
// project folder ops.primecore already created (see
// primecore-ops-local/lib/projectFolder.ts -- the folder structure is
// "Projectos <year>/<Project#>_<Client>_<Name>_<Date>/AMPS/...").
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

import { listFolder } from "./msGraph";

// Returns the drive-relative path of the matching project folder (e.g.
// "Projectos 2026/2451_FPL_Clover Substation_2026-08-05"), or null if
// nothing matches.
export async function findProjectFolderPath(name: string): Promise<string | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;

  const root = await listFolder("");
  const yearFolders = root.filter((r) => r.isFolder && r.name.startsWith("Projectos "));

  const candidates: { path: string; folder: string; exact: boolean }[] = [];
  for (const yearFolder of yearFolders) {
    let children;
    try {
      children = await listFolder(yearFolder.name);
    } catch {
      continue; // best-effort -- one bad/empty year folder shouldn't block the others
    }
    for (const child of children) {
      if (!child.isFolder) continue;
      const folderName = child.name.trim();

      // New format: "<Project#>_<Client>_<Name>_<Date>" -- exactly 4
      // underscore-delimited segments (each segment has its own
      // underscores stripped when the folder is created, so a real match
      // always has exactly 4 parts). The Name is the 3rd segment.
      const parts = folderName.split("_");
      if (parts.length === 4 && parts[2].trim().toLowerCase() === target) {
        candidates.push({ path: `${yearFolder.name}/${folderName}`, folder: folderName, exact: true });
        continue;
      }

      // Old format: "<year>-<Project#>-<Name>".
      if (folderName.toLowerCase().endsWith(`-${target}`)) {
        candidates.push({ path: `${yearFolder.name}/${folderName}`, folder: folderName, exact: false });
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
