import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";
import { uploadFile } from "@/lib/msGraph";
import { findProjectFolderPath } from "@/lib/projectFolder";

const AS_BUILT_AREA = "As Built Drawings";

// Manual "Save to OneDrive" action -- NOT automatic. Uploads photos to
// OneDrive, the exact same structure the "save to folder on this
// computer" button already produces locally, split two ways:
//   - Yard/House (and any other custom site): <project folder>/AMPS/<Area>/<Folder>/...
//   - As Built Drawings: <project folder>/As Built Drawings/<Folder>/...
//     (a sibling of AMPS, not nested inside it -- see lib/projectFolder.ts
//     in ops-local, which eagerly creates both as top-level subfolders).
// The destination project folder is found by name (see
// lib/projectFolder.ts) -- ops.primecore is the source of truth for where
// each project's folder lives, since it auto-creates it on project
// creation.
// Called two ways: the project page's "Save to OneDrive" button uploads
// the whole project (no 'area' in the body); each site page (Yard, House,
// As Built Drawings, or any custom site) also has its own "Save to
// OneDrive" button that passes its own area name here to upload just that
// site's folders, so someone doesn't have to re-upload everything just to
// push up a handful of new As Built Drawings scans.
// Runs sequentially (one photo at a time) since these are small resized
// JPEGs/PDFs (a few hundred KB) and this is a user-initiated action with a
// progress-ish status message, not a background job.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || "");
  const area = body.area ? String(body.area) : null;
  if (!projectId) {
    return NextResponse.json({ error: "Missing 'projectId'." }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { folders: { include: { photos: true } } },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const matchedFolder = await findProjectFolderPath(project.name);
  if (!matchedFolder) {
    return NextResponse.json({
      uploaded: 0,
      failed: 0,
      lastError: `No matching project folder found in OneDrive for "${project.name}". Make sure a project with this exact name exists in ops.primecore first.`,
    });
  }
  // Kept only for the response payload (shown in the UI's status text) --
  // no longer part of the actual upload path, since matchedFolder above
  // already points inside the matched project's own folder.
  const projectFolderName = sanitizeForPath(`${project.substationName} - ${project.name}`);

  const folders = area ? project.folders.filter((f) => f.area === area) : project.folders;
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  function folderPath(folder: (typeof folders)[number]): string {
    const parts = [sanitizeForPath(folder.name)];
    let cur = folder;
    while (cur.parentId) {
      const parent = foldersById.get(cur.parentId);
      if (!parent) break;
      parts.unshift(sanitizeForPath(parent.name));
      cur = parent;
    }
    return `${sanitizeForPath(folder.area)}/${parts.join("/")}`;
  }

  let uploaded = 0;
  let failed = 0;
  let lastError = "";
  const usedNames = new Map<string, Set<string>>();

  for (const folder of folders) {
    const relPath = folderPath(folder);
    if (!usedNames.has(relPath)) usedNames.set(relPath, new Set());
    const used = usedNames.get(relPath)!;

    for (const photo of folder.photos) {
      let name = photo.filename;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        name = `${name.slice(0, dot)}-${photo.id.slice(0, 5)}${name.slice(dot)}`;
      }
      used.add(name);

      try {
        const base64 = photo.dataUrl.split(",")[1] || "";
        const buffer = Buffer.from(base64, "base64");
        // As Built Drawings is its own top-level folder (relPath already
        // starts with "As Built Drawings/..."); everything else nests
        // under AMPS like it always has.
        const backupRoot = folder.area === AS_BUILT_AREA ? matchedFolder : `${matchedFolder}/AMPS`;
        const onedrivePath = `${backupRoot}/${relPath}/${name}`;
        const contentType = name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg";
        await uploadFile(onedrivePath, buffer, contentType);
        uploaded++;
      } catch (e) {
        // Surfaced in the response (not just the server console) so the
        // "X failed" status on the page is actually diagnosable -- e.g.
        // "MICROSOFT_CLIENT_ID is not set" means the dev server needs a
        // restart to pick up a .env change, a 401 means the token/tenant
        // is wrong, a 403 means Files.ReadWrite.All admin consent hasn't
        // actually taken effect yet.
        lastError = e instanceof Error ? e.message : String(e);
        console.error(`OneDrive backup failed for photo ${photo.id}:`, e);
        failed++;
      }
    }
  }

  return NextResponse.json({ uploaded, failed, projectFolderName, lastError: failed > 0 ? lastError : undefined });
}
