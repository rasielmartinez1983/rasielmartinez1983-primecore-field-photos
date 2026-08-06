import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeForPath } from "@/lib/filename";
import { uploadFile } from "@/lib/msGraph";
import { findProjectFolderPath } from "@/lib/projectFolder";

const AS_BUILT_AREA = "As Built Drawings";

// Manual "Save to OneDrive" for a single folder -- same idea as
// backup-project, just scoped to one folder's own photos (flat, no
// subfolders, matching /api/photos/zip's scope), for the "I'm working in
// this one device's folder on my phone right now" case instead of always
// going back to the project page. Destination folder is found the same
// way as backup-project -- see lib/projectFolder.ts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const folderId = String(body.folderId || "");
  if (!folderId) {
    return NextResponse.json({ error: "Missing 'folderId'." }, { status: 400 });
  }

  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: {
      project: true,
      photos: true,
      parent: { include: { parent: true } }, // two levels up covers every real case (Area/Folder/Subfolder)
    },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  const matchedFolder = await findProjectFolderPath(folder.project.name);
  if (!matchedFolder) {
    return NextResponse.json({
      uploaded: 0,
      failed: 0,
      lastError: `No matching project folder found in OneDrive for "${folder.project.name}". Make sure a project with this exact name exists in ops.primecore first.`,
    });
  }
  // As Built Drawings is its own top-level folder, a sibling of AMPS, not
  // nested inside it -- see backup-project's route for the full rationale.
  const backupRoot = folder.area === AS_BUILT_AREA ? matchedFolder : `${matchedFolder}/AMPS`;

  // Matches backup-project's folderPath() -- Area/Folder/Subfolder as
  // separate path segments, same as the local "save to folder" export,
  // not "Area - Folder" flattened into one name.
  const parts = [sanitizeForPath(folder.name)];
  if (folder.parent) {
    parts.unshift(sanitizeForPath(folder.parent.name));
    if (folder.parent.parent) parts.unshift(sanitizeForPath(folder.parent.parent.name));
  }
  const folderPath = `${sanitizeForPath(folder.area)}/${parts.join("/")}`;

  let uploaded = 0;
  let failed = 0;
  let lastError = "";
  const usedNames = new Set<string>();

  for (const photo of folder.photos) {
    let name = photo.filename;
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = `${name.slice(0, dot)}-${photo.id.slice(0, 5)}${name.slice(dot)}`;
    }
    usedNames.add(name);

    try {
      const base64 = photo.dataUrl.split(",")[1] || "";
      const buffer = Buffer.from(base64, "base64");
      const onedrivePath = `${backupRoot}/${folderPath}/${name}`;
      const contentType = name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg";
      await uploadFile(onedrivePath, buffer, contentType);
      uploaded++;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`OneDrive backup failed for photo ${photo.id}:`, e);
      failed++;
    }
  }

  return NextResponse.json({ uploaded, failed, lastError: failed > 0 ? lastError : undefined });
}
