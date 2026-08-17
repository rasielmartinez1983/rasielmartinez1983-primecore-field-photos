"use client";

import { useRef, useState } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type OneLinePhoto = {
  id: string;
  substationName: string;
  description: string | null;
  filename: string;
  dataUrl: string;
  createdAt: string;
};

// Same client-side resize/compress-before-upload approach as
// app/folder/[id]/page.tsx's resizeImageFile -- duplicated here rather than
// shared, since this page is intentionally standalone (see the comment on
// OneLinePhoto in prisma/schema.prisma for why: it has to work before any
// Project exists, so it can't reuse anything scoped to a project/folder).
// Tightened from 1800/0.85 -- a real phone photo at that setting still hit
// Vercel's ~4.5MB request body limit for a detailed one-line print. 1400/0.75
// leaves plenty of legibility margin for marking up devices while keeping
// the payload comfortably under the limit.
function resizeImageFile(file: File, maxDim = 1400, quality = 0.75): Promise<string> {
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

export default function OneLinePage() {
  const [substationName, setSubstationName] = useState("");
  const [searchedFor, setSearchedFor] = useState("");
  const [photos, setPhotos] = useState<OneLinePhoto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function loadPhotos(name: string) {
    setLoading(true);
    fetch(`/api/one-line-photos?substation=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }

  function search() {
    const name = substationName.trim();
    if (!name) return;
    setSearchedFor(name);
    loadPhotos(name);
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = substationName.trim();
    if (!name) {
      setError("Type the substation name first.");
      e.target.value = "";
      return;
    }
    setError("");
    setUploading(true);
    try {
      const dataUrl = await resizeImageFile(file);
      const res = await fetch("/api/one-line-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substationName: name, filename: file.name, dataUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Could not save the photo (server said ${res.status}). Try again.`);
        return;
      }
      setSearchedFor(name);
      loadPhotos(name);
    } catch {
      setError("Could not read that photo. Try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function deletePhoto(p: OneLinePhoto) {
    if (!confirm(`Delete this one-line photo for "${p.substationName}"?`)) return;
    await fetch(`/api/one-line-photos?id=${p.id}`, { method: "DELETE" });
    loadPhotos(searchedFor);
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
        <h1>One Line</h1>
        <p className="muted">
          Drop the substation&apos;s one-line print photo here -- independent of any project, so it&apos;s ready
          before a bid is even won. ops.primecore&apos;s Bid Takeoff tool pulls it in from here by substation name.
        </p>

        <label className="field-label" htmlFor="substation">
          Substation
        </label>
        <input
          id="substation"
          type="text"
          value={substationName}
          onChange={(e) => setSubstationName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder="Bandit"
          autoFocus
        />
        <div style={{ height: 10 }} />
        <button type="button" className="camera-button" style={{ width: "100%" }} onClick={search} disabled={!substationName.trim()}>
          Search
        </button>

        {searchedFor && (
          <>
            <div style={{ height: 14 }} />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              capture="environment"
              onChange={onFilePicked}
              style={{ display: "none" }}
              id="one-line-input"
              disabled={uploading}
            />
            <label htmlFor="one-line-input" className="camera-button" style={{ display: "block" }}>
              {uploading ? "Uploading…" : `📷 Add one-line photo for "${searchedFor}"`}
            </label>
            {error && <div className="error-text">{error}</div>}

            <div className="gallery-header">
              <h1 style={{ fontSize: 15, margin: 0 }}>Photos for &quot;{searchedFor}&quot;</h1>
            </div>

            {loading && <p className="muted">Loading…</p>}
            {!loading && photos && photos.length === 0 && (
              <div className="empty-state">No one-line photos yet for &quot;{searchedFor}&quot;.</div>
            )}
            {!loading && photos && photos.length > 0 && (
              <div className="gallery-grid">
                {photos.map((p) => (
                  <div key={p.id} className="gallery-item">
                    {p.filename.toLowerCase().endsWith(".pdf") || p.dataUrl.startsWith("data:application/pdf") ? (
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
                      aria-label={`Delete ${p.filename}`}
                      className="gallery-item-delete-btn"
                      onClick={() => deletePhoto(p)}
                    >
                      Delete
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
