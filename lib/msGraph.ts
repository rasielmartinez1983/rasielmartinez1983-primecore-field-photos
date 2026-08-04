// Microsoft Graph API client (app-only / client-credentials flow) for
// reading and writing files in a single, specific OneDrive for Business
// account: MICROSOFT_ONEDRIVE_USER (rmartinez@primecoreps.com), inside the
// Primecore Power Solutions Azure AD tenant. This is a single-tenant app
// registration ("PrimeCore Ops OneDrive Integration") with the
// Files.ReadWrite.All application permission granted admin consent.
//
// Deliberately scoped to ONE user's drive via MICROSOFT_ONEDRIVE_USER --
// this app has no access to (and must never be pointed at) any other
// Microsoft 365 tenant's OneDrive, e.g. a client's own NEEC account that
// might happen to be synced locally on someone's machine. That's just a
// local folder on disk; it has nothing to do with this integration.
//
// Same "cache the token, refresh a minute before it expires" pattern as
// lib/googleVision.ts's getAccessToken, just OAuth2 client-credentials
// against Azure AD instead of a Google service-account JWT.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let cachedToken: { token: string; expiresAt: number } | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set -- OneDrive integration is not configured.`);
  return value;
}

async function getGraphAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = requiredEnv("MICROSOFT_CLIENT_ID");
  const clientSecret = requiredEnv("MICROSOFT_CLIENT_SECRET");
  const tenantId = requiredEnv("MICROSOFT_TENANT_ID");

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new Error(`Failed to get Microsoft Graph access token: ${detail}`);
  }

  const tokenData = await tokenRes.json();
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// Root of the one OneDrive this app is allowed to touch.
function driveBase(): string {
  const user = requiredEnv("MICROSOFT_ONEDRIVE_USER");
  return `/users/${encodeURIComponent(user)}/drive`;
}

async function graphFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getGraphAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

export type DriveItem = {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  lastModifiedDateTime: string;
  mimeType?: string;
  // Only present on files; lets the browser UI show a thumbnail/preview
  // without a second round-trip.
  downloadUrl?: string;
  // Only present when requested via $select=parentReference -- the
  // drive-relative path of this item's parent folder, e.g.
  // "/drive/root:/Projectos 2026/2026-2451-Clover Substation". Used by
  // lib/projectFolder.ts to locate the matching ops.primecore project
  // folder by name when saving to OneDrive.
  parentPath?: string;
};

function toDriveItem(raw: any): DriveItem {
  return {
    id: raw.id,
    name: raw.name,
    isFolder: Boolean(raw.folder),
    size: raw.size ?? 0,
    lastModifiedDateTime: raw.lastModifiedDateTime,
    mimeType: raw.file?.mimeType,
    downloadUrl: raw["@microsoft.graph.downloadUrl"],
    parentPath: raw.parentReference?.path,
  };
}

// path is a "/"-separated path relative to the drive root, e.g.
// "FPL/Substations/Bandit/2024 New Solar Substation". Pass "" (or omit)
// for the root folder.
export async function listFolder(path: string = ""): Promise<DriveItem[]> {
  const suffix = path ? `root:/${encodeURIComponent(path).replace(/%2F/g, "/")}:/children` : "root/children";
  const res = await graphFetch(`${driveBase()}/${suffix}?$select=id,name,folder,file,size,lastModifiedDateTime,@microsoft.graph.downloadUrl&$top=200`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive listFolder("${path}") failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  return (data.value || []).map(toDriveItem);
}

// Searches the whole drive for files/folders whose name matches `query`
// (Graph's search is a fuzzy full-text match, not just a substring).
export async function searchDrive(query: string): Promise<DriveItem[]> {
  const res = await graphFetch(
    `${driveBase()}/root/search(q='${encodeURIComponent(query)}')?$select=id,name,folder,file,size,lastModifiedDateTime,@microsoft.graph.downloadUrl,parentReference&$top=50`
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive search("${query}") failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  return (data.value || []).map(toDriveItem);
}

// Downloads a file's raw bytes by item id (from listFolder/searchDrive).
export async function downloadFile(itemId: string): Promise<Buffer> {
  const res = await graphFetch(`${driveBase()}/items/${itemId}/content`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive downloadFile("${itemId}") failed: ${res.status} ${detail}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Uploads a small file (<4MB -- fine for a single photo/PDF/xlsx form; a
// resumable upload session would be needed above that, not implemented
// here since nothing this app generates is anywhere near that size) to
// `path` (relative to drive root), creating any missing parent folders
// automatically (Graph's PUT .../content does this for you). Overwrites
// if a file already exists at that exact path.
export async function uploadFile(path: string, content: Buffer, contentType = "application/octet-stream"): Promise<DriveItem> {
  if (content.byteLength > 4 * 1024 * 1024) {
    throw new Error(`uploadFile("${path}"): ${content.byteLength} bytes exceeds the 4MB simple-upload limit.`);
  }
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const res = await graphFetch(`${driveBase()}/root:/${encodedPath}:/content`, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: content,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive uploadFile("${path}") failed: ${res.status} ${detail}`);
  }
  return toDriveItem(await res.json());
}

// Looks up a single item by its exact drive-relative path. Returns null
// (not an error) if nothing exists there yet.
export async function getItem(path: string): Promise<DriveItem | null> {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const res = await graphFetch(
    `${driveBase()}/root:/${encodedPath}?$select=id,name,folder,file,size,lastModifiedDateTime,parentReference`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive getItem("${path}") failed: ${res.status} ${detail}`);
  }
  return toDriveItem(await res.json());
}

// Renames the item at `path` in place -- same parent folder, just a new
// name -- and returns the updated item. Returns null (not an error) if
// nothing exists at that path yet, e.g. a Field Photos folder that was
// never backed up to OneDrive. Used when a Folder is renamed in the app
// (see /api/folders/[id] PATCH) so its already-uploaded OneDrive folder
// gets renamed to match instead of a future "Save to OneDrive" silently
// creating a second, duplicate folder under the new name.
export async function renameItem(path: string, newName: string): Promise<DriveItem | null> {
  const item = await getItem(path);
  if (!item) return null;
  const res = await graphFetch(`${driveBase()}/items/${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OneDrive renameItem("${path}" -> "${newName}") failed: ${res.status} ${detail}`);
  }
  return toDriveItem(await res.json());
}
