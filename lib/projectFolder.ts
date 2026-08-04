// Finds the ops.primecore OneDrive project folder that matches a Field
// Photos project, so "Save to OneDrive" here lands inside the same
// project folder ops.primecore already created (see
// primecore-ops-local/lib/projectFolder.ts -- the folder structure is
// "Projectos <year>/<year>-<Project#>-<Name>/AMPS/...").
//
// Field Photos has its own database, separate from ops.primecore -- there
// is no shared project id or number to join on. Instead, the user names
// the Field Photos project identically to the ops.primecore project's
// Name (the text after the second "-" in the OneDrive folder), and this
// looks for a folder under any "Projectos <year>" whose name ends with
// "-<that name>".
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
// "Projectos 2026/2026-2451-Clover Substation"), or null if nothing
// matches.
export async function findProjectFolderPath(name: string): Promise<string | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;

  const root = await listFolder("");
  const yearFolders = root.filter((r) => r.isFolder && r.name.startsWith("Projectos "));

  const candidates: { path: string; folder: string }[] = [];
  for (const yearFolder of yearFolders) {
    let children;
    try {
      children = await listFolder(yearFolder.name);
    } catch {
      continue; // best-effort -- one bad/empty year folder shouldn't block the others
    }
    for (const child of children) {
      if (!child.isFolder) continue;
      if (child.name.trim().toLowerCase().endsWith(`-${target}`)) {
        candidates.push({ path: `${yearFolder.name}/${child.name}`, folder: child.name });
      }
    }
  }

  if (candidates.length === 0) return null;

  // More than one folder can match "-<name>" (e.g. a project whose name is
  // itself a suffix of another's, or the same project re-created across
  // years). Prefer the shortest name -- the closest match with the least
  // extra text.
  candidates.sort((a, b) => a.folder.length - b.folder.length);
  return candidates[0].path;
}
