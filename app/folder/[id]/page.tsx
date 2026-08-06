"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";
import ManualCropBox from "@/components/ManualCropBox";
import OneDriveImportModal from "@/components/OneDriveImportModal";

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
const AS_BUILT_AREA = "As Built Drawings";

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [folder, setFolder] = useState<Folder | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [subfolders, setSubfolders] = useState<Subfolder[] | null>(null);
  const [phase, setPhase] = useState("");
  // Two-stage pipeline for a batch: raw photos wait in cropQueue, get
  // manually cropped one at a time (cropping = the one currently in the
  // crop tool), and only then land in queue for the phase-pick + save step.
  // Each queue entry keeps the original (pre-crop) photo alongside the
  // cropped result, so "Adjust crop" can reopen the crop tool on the full,
  // untrimmed photo instead of re-cropping an already-cropped image.
  const [cropQueue, setCropQueue] = useState<string[]>([]);
  const [cropping, setCropping] = useState<string | null>(null);
  // Queue of pending photos from the current batch (front = the one being reviewed now).
  const [queue, setQueue] = useState<{ original: string; cropped: string }[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  // As Built Drawings only: the drawing name for the photo currently under
  // review -- pre-filled by OCR (detectDrawingName below) but always
  // editable before saving, since the guess is a best effort.
  const [drawingName, setDrawingName] = useState("");
  const [detectingDrawingName, setDetectingDrawingName] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showOneDrive, setShowOneDrive] = useState(false);
  const [oneDriveSaving, setOneDriveSaving] = useState(false);
  const [oneDriveStatus, setOneDriveStatus] = useState("");

  // Subfolder create/rename state
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");

  // Rename-a-saved-photo state (separate from subfolder rename above).
  const [renamingPhotoId, setRenamingPhotoId] = useState<string | null>(null);
  const [renamePhotoValue, setRenamePhotoValue] = useState("");
  const [renamePhotoBusy, setRenamePhotoBusy] = useState(false);
  const [renamePhotoError, setRenamePhotoError] = useState("");

  const isDrawingArea = folder?.area === AS_BUILT_AREA;

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
    const resized = await Promise.all(files.map((f) => resizeImageFile(f)));
    setCropQueue(resized);
    setBatchTotal(resized.length);
    setPhase("");
    setStatus(null);
  }

  // Same entry point as onFilePicked, just fed from OneDrive instead of the
  // camera/file input -- one imported photo joins the crop queue immediately
  // so it goes through the exact same crop -> phase -> save review step.
  function onOneDriveImport(dataUrl: string) {
    setCropQueue((q) => [...q, dataUrl]);
    setBatchTotal((t) => t + 1);
  }

  // Pulls the next raw photo into the crop tool once there's nothing left
  // to review/save first -- keeps the flow strictly one-at-a-time (crop,
  // then review+save, then crop the next one), instead of racing ahead and
  // yanking the crop tool up mid-review.
  useEffect(() => {
    if (!cropping && queue.length === 0 && cropQueue.length > 0) {
      setCropping(cropQueue[0]);
      setCropQueue((q) => q.slice(1));
    }
  }, [cropping, queue.length, cropQueue]);

  // As Built Drawings only: the moment a photo reaches the review step,
  // OCR it and pre-fill drawingName with the guessed drawing number --
  // still just a starting point, the person can edit or clear it before
  // saving. Keyed off the actual image data (not just "a photo is up")
  // so re-cropping the same photo re-runs detection against the new crop.
  useEffect(() => {
    if (!isDrawingArea) return;
    const image = queue[0]?.cropped;
    if (!image) return;
    let cancelled = false;
    setDetectingDrawingName(true);
    setDrawingName("");
    fetch("/api/photos/detect-drawing-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDrawingName(data.guessedName || "");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDetectingDrawingName(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawingArea, queue[0]?.cropped]);

  function onCropConfirmed(croppedDataUrl: string) {
    if (cropping) setQueue((q) => [...q, { original: cropping, cropped: croppedDataUrl }]);
    setCropping(null);
  }

  function onCropSkipped() {
    if (cropping) setQueue((q) => [...q, { original: cropping, cropped: cropping }]);
    setCropping(null);
  }

  // Reopens the crop tool on this photo's original, untrimmed version, in
  // case the crop didn't come out right -- pulls it back out of the review
  // queue so it goes through the crop step again before returning here.
  function reCropCurrent() {
    const current = queue[0];
    if (!current) return;
    setCropping(current.original);
    setQueue((q) => q.slice(1));
  }

  async function saveCurrentPhoto() {
    const current = queue[0];
    if (!current) return;
    if (isDrawingArea && !drawingName.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isDrawingArea
            ? { folderId: id, name: drawingName.trim(), dataUrl: current.cropped }
            : { folderId: id, phase: phase || null, dataUrl: current.cropped }
        ),
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
    setDrawingName("");
    if (queue.length <= 1 && fileInputRef.current) fileInputRef.current.value = "";
  }

  function skipCurrentPhoto() {
    setStatus(null);
    advanceQueue();
  }

  function discardBatch() {
    setQueue([]);
    setCropQueue([]);
    setCropping(null);
    setPhase("");
    setDrawingName("");
    setBatchTotal(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Manual "Save to OneDrive" for just this folder -- not automatic, same
  // as the project-level one on the project page.
  async function saveFolderToOneDrive() {
    setOneDriveSaving(true);
    setOneDriveStatus("Uploading to OneDrive…");
    try {
      const res = await fetch("/api/onedrive/backup-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOneDriveStatus(data.error || "Could not upload to OneDrive.");
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

  async function deletePhoto(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    loadPhotos();
  }

  function startRenamePhoto(p: Photo) {
    setRenamingPhotoId(p.id);
    // Edit just the name, without whatever extension the field always
    // keeps (.jpg for Yard/House, .pdf for As Built Drawings).
    setRenamePhotoValue(p.filename.replace(/\.[a-zA-Z0-9]+$/, ""));
    setRenamePhotoError("");
  }

  async function saveRenamePhoto() {
    if (!renamingPhotoId || !renamePhotoValue.trim()) return;
    setRenamePhotoBusy(true);
    setRenamePhotoError("");
    try {
      const res = await fetch(`/api/photos/${renamingPhotoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: renamePhotoValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenamePhotoError(data.error || "Could not rename the photo.");
        return;
      }
      setRenamingPhotoId(null);
      loadPhotos();
    } catch {
      setRenamePhotoError("Could not connect. Try again.");
    } finally {
      setRenamePhotoBusy(false);
    }
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
      : `/project/${folder.projectId}/${encodeURIComponent(folder.area)}`
    : "/";
  const current = queue[0];
  const totalRemainingInBatch = cropQueue.length + (cropping ? 1 : 0) + queue.length;
  const doneInBatch = batchTotal - totalRemainingInBatch;

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
          {cropping ? (
            <>
              {batchTotal > 1 && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Photo {doneInBatch + 1} of {batchTotal}
                </p>
              )}
              <ManualCropBox src={cropping} onConfirm={onCropConfirmed} onSkip={onCropSkipped} />
            </>
          ) : current ? (
            <>
              {batchTotal > 1 && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Photo {doneInBatch + 1} of {batchTotal}
                </p>
              )}
              <img src={current.cropped} alt="preview" className="preview-thumb" />
              {isDrawingArea ? (
                <>
                  <label className="field-label" htmlFor="drawingNameInput">
                    Drawing name
                  </label>
                  <input
                    id="drawingNameInput"
                    type="text"
                    value={drawingName}
                    onChange={(e) => setDrawingName(e.target.value)}
                    placeholder={detectingDrawingName ? "Scanning…" : "e.g. E-101"}
                    autoFocus
                    style={{ marginBottom: 4 }}
                  />
                  <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
                    {detectingDrawingName
                      ? "Reading the drawing number off the title block…"
                      : "Pulled from the title block automatically -- check it and edit if needed."}
                  </p>
                </>
              ) : (
                <>
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
                        {p ? `${p} Phase` : "None"}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                className="camera-button"
                onClick={saveCurrentPhoto}
                disabled={busy || (isDrawingArea && !drawingName.trim())}
              >
                {busy ? "Saving…" : isDrawingArea ? "Save as PDF" : "Save photo"}
              </button>
              <div style={{ height: 10 }} />
              <button
                type="button"
                className="secondary-button"
                onClick={reCropCurrent}
                disabled={busy}
                style={{ width: "100%" }}
              >
                Adjust crop
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
              {totalRemainingInBatch > 1 && (
                <>
                  <div style={{ height: 10 }} />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={discardBatch}
                    disabled={busy}
                    style={{ width: "100%" }}
                  >
                    Discard remaining ({totalRemainingInBatch - 1})
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
                {isDrawingArea ? "📷 Scan drawing(s)" : "📷 Take photo(s)"}
              </label>
              <p className="muted" style={{ marginBottom: 8, marginTop: 8 }}>
                {isDrawingArea
                  ? "Each one is saved as a named PDF -- you'll confirm the name before it saves."
                  : "You can select or take several at once."}
              </p>
              <button
                type="button"
                className="secondary-button"
                style={{ width: "100%" }}
                onClick={() => setShowOneDrive(true)}
              >
                📁 Import from OneDrive
              </button>
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

        {photos && photos.length > 0 && (
          <>
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={saveFolderToOneDrive}
              disabled={oneDriveSaving}
            >
              {oneDriveSaving ? "Uploading…" : "Save to OneDrive"}
            </button>
            {oneDriveStatus && (
              <div className={`status-text ${oneDriveStatus.startsWith("Uploaded") ? "status-ok" : "error-text"}`}>
                {oneDriveStatus}
              </div>
            )}
            <div style={{ height: 10 }} />
          </>
        )}

        {renamingPhotoId && (
          <div className="capture-card">
            <label className="field-label" htmlFor="renamePhotoInput">
              Rename photo
            </label>
            <input
              id="renamePhotoInput"
              type="text"
              value={renamePhotoValue}
              onChange={(e) => setRenamePhotoValue(e.target.value)}
              autoFocus
            />
            <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
              "{photos?.find((p) => p.id === renamingPhotoId)?.filename.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".jpg"}" is
              added automatically.
            </p>
            {renamePhotoError && <div className="error-text">{renamePhotoError}</div>}
            <button
              className="camera-button"
              onClick={saveRenamePhoto}
              disabled={renamePhotoBusy || !renamePhotoValue.trim()}
            >
              {renamePhotoBusy ? "Saving…" : "Save name"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => setRenamingPhotoId(null)}
              disabled={renamePhotoBusy}
            >
              Cancel
            </button>
          </div>
        )}

        {photos === null && <p className="muted">Loading…</p>}
        {photos && photos.length === 0 && <div className="empty-state">No photos taken directly in this folder yet.</div>}
        {photos && photos.length > 0 && (
          <div className="gallery-grid">
            {photos.map((p) => (
              <div key={p.id} className="gallery-item">
                {p.filename.toLowerCase().endsWith(".pdf") ? (
                  <a
                    href={p.dataUrl}
                    download={p.filename}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      fontSize: 40,
                      textDecoration: "none",
                    }}
                  >
                    📄
                  </a>
                ) : (
                  <img src={p.dataUrl} alt={p.filename} />
                )}
                <div className="gallery-item-caption">{p.filename}</div>
                <span
                  role="button"
                  aria-label={`Rename ${p.filename}`}
                  className="gallery-item-edit-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRenamePhoto(p);
                  }}
                >
                  ✎
                </span>
                <span
                  role="button"
                  aria-label={`Delete ${p.filename}`}
                  className="gallery-item-delete-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deletePhoto(p.id);
                  }}
                >
                  Delete
                </span>
              </div>
            ))}
          </div>
        )}

        {showOneDrive && (
          <OneDriveImportModal
            onImport={onOneDriveImport}
            onClose={() => setShowOneDrive(false)}
          />
        )}
      </main>
    </>
  );
}
