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
// searches OneDrive itself (via Microsoft Graph's search, not a database
// lookup) for a folder under any "Projectos <year>" whose name ends with
// "-<that name>".

import { searchDrive } from "./msGraph";

function stripDriveRootPrefix(path: string): string {
  // Graph's parentReference.path looks like "/drive/root:/Projectos 2026"
  // (or just "/drive/root:" for the drive root itself).
  const marker = "/root:";
  const idx = path.indexOf(marker);
  if (idx === -1) return "";
  return decodeURIComponent(path.slice(idx + marker.length)).replace(/^\/+/, "");
}

// Returns the drive-relative path of the matching project folder (e.g.
// "Projectos 2026/2026-2451-Clover Substation"), or null if nothing
// matches.
export async function findProjectFolderPath(name: string): Promise<string | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;

  const results = await searchDrive(name);
  const candidates = results.filter((r) => {
    if (!r.isFolder) return false;
    const parent = stripDriveRootPrefix(r.parentPath || "");
    if (!parent.startsWith("Projectos ")) return false;
    return r.name.trim().toLowerCase().endsWith(`-${target}`);
  });
  if (candidates.length === 0) return null;

  // Graph's search is fuzzy, so more than one folder can match "-<name>"
  // (e.g. a project whose name is itself a suffix of another's). Prefer
  // the shortest name -- the closest match with the least extra text.
  candidates.sort((a, b) => a.name.length - b.name.length);
  const best = candidates[0];
  const parent = stripDriveRootPrefix(best.parentPath || "");
  return `${parent}/${best.name}`;
}
