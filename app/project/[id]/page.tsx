"use client";

import { useEffect, useState, use as usePromise } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";
import { saveDirHandle, loadDirHandle } from "@/lib/folderHandleStore";
import { areaLabel } from "@/lib/areaLabel";

type Project = {
  id: string;
  name: string;
  substationName: string;
  client: string | null;
  date: string | null;
};

type Site = { id: string; name: string; folderCount: number };

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fsAccessSupported, setFsAccessSupported] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [oneDriveStatus, setOneDriveStatus] = useState("");
  const [oneDriveSaving, setOneDriveSaving] = useState(false);

  function loadSites() {
    fetch(`/api/project-areas?projectId=${id}`)
      .then((r) => r.json())
      .then(setSites)
      .catch(() => setSites([]));
  }

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setProject)
      .catch(() => setProject(null));
    loadSites();
    setFsAccessSupported(typeof window !== "undefined" && "showDirectoryPicker" in window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Reuses the folder the user picked last time (e.g. "Primecore Field
  // Photos"), re-asking for write permission if it's expired, or falls back
  // to the native folder picker if nothing's saved yet or it was revoked.
  async function pickOrReuseBaseDir(): Promise<any | null> {
    const saved = await loadDirHandle();
    if (saved) {
      try {
        const perm = await saved.queryPermission({ mode: "readwrite" });
        if (perm === "granted") return saved;
        if (perm === "prompt") {
          const req = await saved.requestPermission({ mode: "readwrite" });
          if (req === "granted") return saved;
        }
      } catch {
        // Handle no longer valid (folder moved/deleted) -- fall through to
        // asking the user to pick again below.
      }
    }
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      await saveDirHandle(handle);
      return handle;
    } catch {
      return null; // user cancelled the picker
    }
  }

  async function saveToFolder() {
    setSaving(true);
    setSaveStatus("Choosing folder…");
    try {
      const baseDir = await pickOrReuseBaseDir();
      if (!baseDir) {
        setSaveStatus("");
        return;
      }
      setSaveStatus("Loading photos…");
      const res = await fetch(`/api/projects/${id}/export-files`);
      const data = await res.json();
      if (!res.ok) {
        setSaveStatus(data.error || "Could not load photos.");
        return;
      }
      if (!data.entries || data.entries.length === 0) {
        setSaveStatus("This project doesn't have any photos yet.");
        return;
      }

      const projectDir = await baseDir.getDirectoryHandle(data.projectFolderName, { create: true });
      let done = 0;
      for (const entry of data.entries as { path: string; dataBase64: string }[]) {
        const parts = entry.path.split("/");
        const filename = parts.pop()!;
        let dir = projectDir;
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part, { create: true });
        }
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(base64ToBytes(entry.dataBase64));
        await writable.close();
        done++;
        setSaveStatus(`Saving photos… ${done}/${data.entries.length}`);
      }
      setSaveStatus(`Saved ${done} photo${done === 1 ? "" : "s"} to "${data.projectFolderName}".`);
    } catch {
      setSaveStatus("Something went wrong saving to that folder. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Manual "Save to OneDrive" -- NOT automatic. Uploads every photo in this
  // project to primecoreps' OneDrive (see MICROSOFT_ONEDRIVE_BACKUP_ROOT),
  // mirroring the same folder structure as the local/ZIP exports above, so
  // Danys (or anyone else with access to that OneDrive) sees the same
  // photos without needing this app installed.
  async function saveToOneDrive() {
    setOneDriveSaving(true);
    setOneDriveStatus("Uploading to OneDrive…");
    try {
      const res = await fetch("/api/onedrive/backup-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOneDriveStatus(data.error || "Could not upload to OneDrive.");
        return;
      }
      // lastError can be set even when uploaded/failed are both 0 -- e.g.
      // no matching ops.primecore project folder was found in OneDrive at
      // all, so nothing was even attempted. Show that specific reason
      // instead of the generic "no photos" message.
      if (data.uploaded === 0 && data.failed === 0) {
        setOneDriveStatus(data.lastError || "This project doesn't have any photos yet.");
        return;
      }
      setOneDriveStatus(
        data.failed > 0
          ? `Uploaded ${data.uploaded}, ${data.failed} failed${data.lastError ? `: ${data.lastError}` : ""}`
          : `Uploaded ${data.uploaded} photo${data.uploaded === 1 ? "" : "s"} to OneDrive.`
      );
    } catch {
      setOneDriveStatus("Could not connect. Try again.");
    } finally {
      setOneDriveSaving(false);
    }
  }

  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/project-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, name: siteName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the site.");
        return;
      }
      setSiteName("");
      setAdding(false);
      loadSites();
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(e: React.MouseEvent, site: Site) {
    e.preventDefault();
    e.stopPropagation();
    const warning =
      site.folderCount > 0
        ? `Delete "${site.name}" and its ${site.folderCount} folder${
            site.folderCount === 1 ? "" : "s"
          } (with all photos inside)? This can't be undone.`
        : `Delete "${site.name}"?`;
    if (!confirm(warning)) return;
    await fetch(`/api/project-areas/${site.id}`, { method: "DELETE" });
    loadSites();
  }

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <a href="/" className="app-header-back">‹ Projects</a>
        <img src="/logo.png" alt="PrimeCore" className="app-logo" />
        <div className="app-header-spacer" />
      </header>
      <main>
        <h1>{project ? `${project.substationName} — ${project.name}` : "Loading…"}</h1>
        {project && (project.client || project.date) && (
          <p className="muted" style={{ marginTop: 0 }}>
            {[project.client, project.date ? new Date(project.date).toLocaleDateString() : null]
              .filter(Boolean)
              .join(" — ")}
          </p>
        )}
        <p className="muted">Choose where the equipment is.</p>

        {sites === null && <p className="muted">Loading…</p>}
        {sites && sites.length === 0 && (
          <div className="empty-state">No sites yet. Add one below.</div>
        )}
        {sites && sites.length > 0 && (
          <div className="category-grid" style={{ marginTop: 18 }}>
            {sites.map((s) => (
              <a
                key={s.id}
                href={`/project/${id}/${encodeURIComponent(s.name)}`}
                className="category-card"
                style={{ position: "relative" }}
              >
                <div className="category-card-label" style={{ paddingRight: 4 }}>{areaLabel(s.name)}</div>
                {s.name !== "Yard" && s.name !== "House" && s.name !== "As Built Drawings" && (
                  <span
                    role="button"
                    aria-label={`Delete ${s.name}`}
                    className="category-card-delete-btn"
                    onClick={(e) => deleteSite(e, s)}
                  >
                    Delete
                  </span>
                )}
              </a>
            ))}
          </div>
        )}

        {!adding && (
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14, width: "100%" }}
            onClick={() => setAdding(true)}
          >
            + Add site
          </button>
        )}

        {adding && (
          <form className="capture-card" onSubmit={addSite}>
            <label className="field-label" htmlFor="siteName">
              Site name (e.g. Switchyard 2)
            </label>
            <input
              id="siteName"
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Switchyard 2"
              autoFocus
            />
            {error && <div className="error-text">{error}</div>}
            <button className="camera-button" type="submit" disabled={busy || !siteName.trim()}>
              {busy ? "Creating…" : "Create site"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => {
                setAdding(false);
                setError("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="gallery-header">
          <h1 style={{ fontSize: 15, margin: 0 }}>Download everything</h1>
        </div>

        {fsAccessSupported && (
          <>
            <button
              type="button"
              className="camera-button"
              onClick={saveToFolder}
              disabled={saving}
              style={{ width: "100%" }}
            >
              {saving ? "Saving…" : "Save to folder on this computer"}
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              First time, pick your "Primecore Field Photos" folder (or wherever you keep these). The app
              remembers it and creates a subfolder named after this project automatically next time.
            </p>
            {saveStatus && <div className="status-text status-ok">{saveStatus}</div>}
            <div style={{ height: 10 }} />
          </>
        )}

        <button
          type="button"
          className="camera-button"
          onClick={saveToOneDrive}
          disabled={oneDriveSaving}
          style={{ width: "100%" }}
        >
          {oneDriveSaving ? "Uploading…" : "Save to OneDrive"}
        </button>
        <p className="muted" style={{ marginTop: 8 }}>
          Uploads every photo in this project to primecoreps' OneDrive. You choose when this runs -- it's not automatic.
        </p>
        {oneDriveStatus && (
          <div className={`status-text ${oneDriveStatus.startsWith("Uploaded") ? "status-ok" : "error-text"}`}>
            {oneDriveStatus}
          </div>
        )}
        <div style={{ height: 10 }} />

        <a className="secondary-button" href={`/api/projects/${id}/zip`}>
          Download full project (ZIP)
        </a>
        <p className="muted" style={{ marginTop: 8 }}>
          Bundles every photo in the project organized by site/folder, ready to drop into your AMP folder.
          {fsAccessSupported ? " Use this on the phone, or if \"Save to folder\" above doesn't work." : ""}
        </p>
      </main>
    </>
  );
}
