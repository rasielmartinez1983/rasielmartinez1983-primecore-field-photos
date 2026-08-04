"use client";

import { useEffect, useState } from "react";

type DriveItem = {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  mimeType?: string;
  downloadUrl?: string;
};

function isImage(item: DriveItem): boolean {
  if (item.mimeType) return item.mimeType.startsWith("image/");
  return /\.(jpe?g|png|heic|heif|webp|bmp)$/i.test(item.name);
}

// Turns a downloaded image (Blob) into the same kind of base64 data URL the
// camera-capture flow already produces, so imported photos go through the
// exact same crop/phase/save pipeline as ones taken on the phone.
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// Combined browse + search picker for the one OneDrive account this app is
// scoped to (rmartinez@primecoreps.com, see lib/msGraph.ts). Lets the user
// either type a search (e.g. "Bandit CCVT") across the whole drive, or
// navigate folder-by-folder with breadcrumbs. Selecting an image downloads
// it and hands the resulting data URL to onImport, one at a time --
// selection stays open so several photos can be pulled in in one go.
export default function OneDriveImportModal({
  onImport,
  onClose,
}: {
  onImport: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [path, setPath] = useState(""); // "" = drive root
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DriveItem[] | null>(null);
  const [error, setError] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  function loadBrowse(p: string) {
    setItems(null);
    setError("");
    fetch(`/api/onedrive/browse?path=${encodeURIComponent(p)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setItems([]);
          return;
        }
        setItems(data.items);
      })
      .catch(() => {
        setError("Could not connect to OneDrive.");
        setItems([]);
      });
  }

  function runSearch(q: string) {
    if (!q.trim()) return;
    setItems(null);
    setError("");
    fetch(`/api/onedrive/search?q=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setItems([]);
          return;
        }
        setItems(data.items);
      })
      .catch(() => {
        setError("Could not connect to OneDrive.");
        setItems([]);
      });
  }

  useEffect(() => {
    if (mode === "browse") loadBrowse(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path]);

  async function pickItem(item: DriveItem) {
    if (item.isFolder) {
      setPath((prev) => (prev ? `${prev}/${item.name}` : item.name));
      return;
    }
    if (!isImage(item)) return; // this app only stores photos
    setImportingId(item.id);
    try {
      let blob: Blob;
      if (item.downloadUrl) {
        const res = await fetch(item.downloadUrl);
        if (!res.ok) throw new Error("download failed");
        blob = await res.blob();
      } else {
        const res = await fetch(`/api/onedrive/download?itemId=${item.id}`);
        if (!res.ok) throw new Error("download failed");
        blob = await res.blob();
      }
      const dataUrl = await blobToDataUrl(blob);
      onImport(dataUrl);
      setImportedIds((prev) => new Set(prev).add(item.id));
    } catch {
      setError(`Could not download "${item.name}". Try again.`);
    } finally {
      setImportingId(null);
    }
  }

  const crumbs = path ? ["", ...path.split("/")] : [""];
  let crumbPath = "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="capture-card" style={{ maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h1 style={{ fontSize: 16, margin: 0 }}>Import from OneDrive</h1>
          <button type="button" className="secondary-button" onClick={onClose} style={{ padding: "4px 10px" }}>
            Close
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="secondary-button"
            style={{
              flex: 1,
              background: mode === "browse" ? "#101828" : "#fff",
              color: mode === "browse" ? "#fff" : "#101828",
            }}
            onClick={() => setMode("browse")}
          >
            Browse
          </button>
          <button
            type="button"
            className="secondary-button"
            style={{
              flex: 1,
              background: mode === "search" ? "#101828" : "#fff",
              color: mode === "search" ? "#fff" : "#101828",
            }}
            onClick={() => setMode("search")}
          >
            Search
          </button>
        </div>

        {mode === "search" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            style={{ display: "flex", gap: 8, marginBottom: 12 }}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Bandit CCVT"
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="camera-button" type="submit" style={{ width: "auto", padding: "0 16px" }}>
              Go
            </button>
          </form>
        )}

        {mode === "browse" && (
          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
            {crumbs.map((_, i) => {
              const label = i === 0 ? "OneDrive" : crumbs[i];
              const target = crumbs.slice(1, i + 1).join("/");
              const isLast = i === crumbs.length - 1;
              crumbPath = target;
              return (
                <span key={i}>
                  {i > 0 && " / "}
                  {isLast ? (
                    <strong>{label}</strong>
                  ) : (
                    <a href="#" onClick={(e) => { e.preventDefault(); setPath(crumbPath); }}>
                      {label}
                    </a>
                  )}
                </span>
              );
            })}
          </p>
        )}

        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
        {items === null && <p className="muted">Loading…</p>}
        {items && items.length === 0 && !error && <div className="empty-state">Nothing here.</div>}

        {items && items.length > 0 && (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {items.map((item) => {
              const done = importedIds.has(item.id);
              const busy = importingId === item.id;
              const clickable = item.isFolder || isImage(item);
              return (
                <div
                  key={item.id}
                  onClick={() => clickable && !busy && pickItem(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 6px",
                    borderBottom: "1px solid #eee",
                    cursor: clickable ? "pointer" : "default",
                    opacity: clickable ? 1 : 0.45,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{item.isFolder ? "📁" : isImage(item) ? "🖼️" : "📄"}</span>
                  <span style={{ flex: 1, fontSize: 14 }}>{item.name}</span>
                  {busy && <span className="muted" style={{ fontSize: 12 }}>Importing…</span>}
                  {done && <span style={{ fontSize: 12, color: "#16a34a" }}>✓ Imported</span>}
                </div>
              );
            })}
          </div>
        )}

        <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          Tap an image to pull it in -- you'll get the usual crop and phase step for each one, just like a camera
          photo. Tap a folder to open it.
        </p>
      </div>
    </div>
  );
}
