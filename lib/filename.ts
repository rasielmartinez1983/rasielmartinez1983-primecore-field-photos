// Builds photo filenames matching the tech's requested structure:
//   "{Client}_{Substation}_{FolderName}{_Phase Phase?}.jpg"
// e.g. "FPL_Bandit_Arresters_A Phase.jpg" or "FPL_Bandit_DC Load Center.jpg"
// (no phase picked). The folder is whichever folder/subfolder the photo
// was actually taken in.

// Strips only the characters Windows actually forbids in file/folder names
// (< > : " / \ | ? *) and trims trailing dots/spaces (also invalid on
// Windows). Everything else -- parentheses, dashes, commas, & -- is kept,
// since the real convention relies on those.
export function sanitizeForPath(input: string): string {
  return input
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

export function buildPhotoFilename(
  client: string,
  substationName: string,
  folderName: string,
  phase?: string | null
): string {
  const cli = sanitizeForPath(client) || "Client";
  const sub = sanitizeForPath(substationName) || "Substation";
  const folder = sanitizeForPath(folderName) || "Folder";
  const phaseSuffix = phase ? `_${phase} Phase` : "";
  return `${cli}_${sub}_${folder}${phaseSuffix}.jpg`;
}
