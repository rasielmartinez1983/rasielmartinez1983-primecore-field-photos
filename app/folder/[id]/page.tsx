"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type Folder = {
  id: string;
  name: string;
  area: string;
  projectId: string;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  project: { substationName: string; name: string };
};
type Subfolder = { id: string; name: string; photoCount: number; subfolderCount: number };
type Photo = { id: string; description: string; phase: string | null; filename: string; dataUrl: string };

// Resizes/compresses a photo client-side before it's stored as a base64
// data URL, so field photos from a phone camera don't bloat the database.
function resizeImageFile(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read the image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const PHASES = ["", "A", "B", "C"];

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [folder, setFolder] = useState<Folder | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [subfolders, setSubfolders] = useState<Subfolder[] | null>(null);
  const [phase, setPhase] = useState("");
  // Queue of pending photos from the current batch (front = the one being reviewed now).
  const [queue, setQueue] = useState<string[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subfolder create/rename state
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");

  function loadFolder() {
    fetch(`/api/folders/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFolder)
      .catch(() => setFolder(null));
  }

  function loadPhotos() {
    fetch(`/api/photos?folderId=${id}`)
      .then((r) => r.json())
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }

  function loadSubfolders() {
    fetch(`/api/folders?parentId=${id}`)
      .then((r) => r.json())
      .then(setSubfolders)
      .catch(() => setSubfolders([]));
  }

  useEffect(() => {
    loadFolder();
    loadPhotos();
    loadSubfolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const dataUrls = await Promise.all(files.map((f) => resizeImageFile(f)));
    setQueue(dataUrls);
    setBatchTotal(dataUrls.length);
    setPhase("");
    setStatus(null);
  }

  async function saveCurrentPhoto() {
    const current = queue[0];
    if (!current) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: id, phase: phase || null, dataUrl: current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ text: data.error || "Could not save the photo.", ok: false });
      } else {
        setStatus({ text: `Saved as ${data.filename}`, ok: true });
        advanceQueue();
        loadPhotos();
      }
    } catch {
      setStatus({ text: "Could not connect. Try again.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  function advanceQueue() {
    setQueue((q) => q.slice(1));
    setPhase("");
    if (queue.length <= 1 && fileInputRef.current) fileInputRef.current.value = "";
  }

  function skipCurrentPhoto() {
    setStatus(null);
    advanceQueue();
  }

  function discardBatch() {
    setQueue([]);
    setPhase("");
    setBatchTotal(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function deletePhoto(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    loadPhotos();
  }

  async function addSubfolder(e: React.FormEvent) {
    e.preventDefault();
    if (!subName.trim()) return;
    setSubBusy(true);
    setSubError("");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: id, name: subName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubError(data.error || "Could not create the subfolder.");
        return;
      }
      setSubName("");
      setAddingSub(false);
      loadSubfolders();
    } catch {
      setSubError("Could not connect. Try again.");
    } finally {
      setSubBusy(false);
    }
  }

  function startRename(f: Subfolder) {
    setRenamingId(f.id);
    setRenameValue(f.name);
    setRenameError("");
  }

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) return;
    setSubBusy(true);
    setRenameError("");
    try {
      const res = await fetch(`/api/folders/${renamingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameError(data.error || "Could not rename the subfolder.");
        return;
      }
      setRenamingId(null);
      loadSubfolders();
    } catch {
      setRenameError("Could not connect. Try again.");
    } finally {
      setSubBusy(false);
    }
  }

  async function deleteSubfolder(f: Subfolder) {
    const warning =
      f.photoCount > 0 || f.subfolderCount > 0
        ? `Delete "${f.name}" and everything inside it? This can't be undone.`
        : `Delete "${f.name}"?`;
    if (!confirm(warning)) return;
    await fetch(`/api/folders/${f.id}`, { method: "DELETE" });
    loadSubfolders();
  }

  const backHref = folder
    ? folder.parent
      ? `/folder/${folder.parent.id}`
      : `/project/${folder.projectId}/${folder.area}`
    : "/";
  const current = queue[0];
  const doneInBatch = batchTotal - queue.length;

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <a href={backHref} className="app-header-back">
          ‹ Back
        </a>
        <img src="/logo.png" alt="PrimeCore" className="app-logo" />
        <div className="app-header-spacer" />
      </header>
      <main>
        <h1>{folder?.name || "Loading…"}</h1>
        <p className="muted">
          {folder
            ? folder.parent
              ? `${folder.project.substationName} — ${folder.area} — ${folder.parent.name}`
              : `${folder.project.substationName} — ${folder.area}`
            : ""}
        </p>

        <div className="capture-card">
          {current ? (
            <>
              {batchTotal > 1 && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Photo {doneInBatch + 1} of {batchTotal}
                </p>
              )}
              <img src={current} alt="preview" className="preview-thumb" />
              <label className="field-label">Phase (optional)</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {PHASES.map((p) => (
                  <button
                    key={p || "none"}
                    type="button"
                    onClick={() => setPhase(p)}
                    className="secondary-button"
                    style={{
                      flex: 1,
                      background: phase === p ? "#101828" : "#fff",
                      color: phase === p ? "#fff" : "#101828",
                    }}
                  >
                    {p || "None"}
                  </button>
                ))}
              </div>
              <button className="camera-button" onClick={saveCurrentPhoto} disabled={busy}>
                {busy ? "Saving…" : "Save photo"}
              </button>
              <div style={{ height: 10 }} />
              <button
                type="button"
                className="secondary-button"
                onClick={skipCurrentPhoto}
                disabled={busy}
                style={{ width: "100%" }}
              >
                Skip this one
              </button>
              {queue.length > 1 && (
                <>
                  <div style={{ height: 10 }} />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={discardBatch}
                    disabled={busy}
                    style={{ width: "100%" }}
                  >
                    Discard remaining ({queue.length})
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={onFilePicked}
                style={{ display: "none" }}
                id="camera-input"
              />
              <label htmlFor="camera-input" className="camera-button" style={{ display: "block" }}>
                📷 Take photo(s)
              </label>
              <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>
                You can select or take several at once.
              </p>
            </>
          )}
          {status && (
            <div className={`status-text ${status.ok ? "status-ok" : "error-text"}`}>{status.text}</div>
          )}
        </div>

        <div className="gallery-header">
          <h1 style={{ fontSize: 15, margin: 0 }}>Subfolders {subfolders ? `(${subfolders.length})` : ""}</h1>
        </div>

        {subfolders && subfolders.length > 0 && (
          <div className="tile-grid">
            {subfolders.map((f) => (
              <a key={f.id} href={`/folder/${f.id}`} className="tile">
                <span className="tile-label">{f.name}</span>
                <span className="tile-count">
                  {f.photoCount} {f.photoCount === 1 ? "photo" : "photos"}
                  {f.subfolderCount > 0
                    ? ` · ${f.subfolderCount} sub${f.subfolderCount === 1 ? "" : "s"}`
                    : ""}
                </span>
                <span
                  role="button"
                  aria-label={`Rename ${f.name}`}
                  className="tile-edit-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRename(f);
                  }}
                >
                  ✎
                </span>
                <span
                  role="button"
                  aria-label={`Delete ${f.name}`}
                  className="tile-delete-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteSubfolder(f);
                  }}
                >
                  Delete
                </span>
              </a>
            ))}
          </div>
        )}

        {renamingId && (
          <div className="capture-card">
            <label className="field-label" htmlFor="renameSubInput">
              Rename subfolder
            </label>
            <input
              id="renameSubInput"
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
            {renameError && <div className="error-text">{renameError}</div>}
            <button className="camera-button" onClick={saveRename} disabled={subBusy || !renameValue.trim()}>
              {subBusy ? "Saving…" : "Save name"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => setRenamingId(null)}
              disabled={subBusy}
            >
              Cancel
            </button>
          </div>
        )}

        {!addingSub && (
          <button
            type="button"
            className="secondary-button"
            style={{ marginTop: 14, width: "100%" }}
            onClick={() => setAddingSub(true)}
          >
            + Add subfolder
          </button>
        )}

        {addingSub && (
          <form className="capture-card" onSubmit={addSubfolder}>
            <label className="field-label" htmlFor="subName">
              Subfolder name (e.g. Line Arresters)
            </label>
            <input
              id="subName"
              type="text"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder="Line Arresters"
              autoFocus
            />
            {subError && <div className="error-text">{subError}</div>}
            <button className="camera-button" type="submit" disabled={subBusy || !subName.trim()}>
              {subBusy ? "Creating…" : "Create subfolder"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => {
                setAddingSub(false);
                setSubError("");
              }}
              disabled={subBusy}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="gallery-header">
          <h1 style={{ fontSize: 15, margin: 0 }}>
            Photos here {photos ? `(${photos.length})` : ""}
          </h1>
          {photos && photos.length > 0 && (
            <a className="secondary-button" href={`/api/photos/zip?folderId=${id}`}>
              Download ZIP
            </a>
          )}
        </div>

        {photos === null && <p className="muted">Loading…</p>}
        {photos && photos.length === 0 && <div className="empty-state">No photos taken directly in this folder yet.</div>}
        {photos && photos.length > 0 && (
          <div className="gallery-grid">
            {photos.map((p) => (
              <div
                key={p.id}
                className="gallery-item"
                onClick={() => deletePhoto(p.id)}
                title="Tap to delete"
              >
                <img src={p.dataUrl} alt={p.filename} />
                <div className="gallery-item-caption">{p.filename}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
