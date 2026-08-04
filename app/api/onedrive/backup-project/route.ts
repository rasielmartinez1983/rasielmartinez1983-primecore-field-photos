import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";
import { uploadFile } from "@/lib/msGraph";
import { findProjectFolderPath } from "@/lib/projectFolder";

// Manual "Save to OneDrive" action (button on the project page) -- NOT
// automatic. Uploads every photo in this project to OneDrive at
// <matching ops.primecore project folder>/AMPS/<Area>/<Folder>/..., the
// exact same structure the "save to folder on this computer" button
// already produces locally. The destination project folder is found by
// name (see lib/projectFolder.ts) -- ops.primecore is the source of
// truth for where each project's folder lives, since it auto-creates it
// on project creation.
// Runs sequentially (one photo at a time) since these are small resized
// JPEGs (a few hundred KB) and this is a user-initiated action with a
// progress-ish status message, not a background job.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || "");
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
  const backupRoot = `${matchedFolder}/AMPS`;
  // Kept only for the response payload (shown in the UI's status text) --
  // no longer part of the actual upload path, since backupRoot above
  // already points inside the matched project's own folder.
  const projectFolderName = sanitizeForPath(`${project.substationName} - ${project.name}`);

  const folders = project.folders;
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
        const onedrivePath = `${backupRoot}/${relPath}/${name}`;
        await uploadFile(onedrivePath, buffer, "image/jpeg");
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
