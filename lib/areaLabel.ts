// Display-only relabeling of the "As Built Drawings" site name. The
// underlying string is left completely untouched everywhere it's used
// for matching, URLs, or the OneDrive folder structure (see the
// AS_BUILT_AREA constants scattered across the app, and the top-level
// "As Built Drawings" OneDrive folder ops-local creates) -- this only
// changes what the person actually reads on screen. Renamed to "As
// Built / Highlighted Drawings" since the area now holds two default
// subfolders (As Built Drawings, Highlighted Drawings) instead of just
// implying as-built prints -- see the project-creation routes.
export function areaLabel(area: string): string {
  return area === "As Built Drawings" ? "As Built / Highlighted Drawings" : area;
}
