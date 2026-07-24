"use client";

import { useEffect, useState, use as usePromise } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type Project = {
  id: string;
  name: string;
  substationName: string;
  client: string | null;
  date: string | null;
};

type Site = { id: string; name: string; folderCount: number };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
                <div className="category-card-label" style={{ paddingRight: 4 }}>{s.name}</div>
                {s.name !== "Yard" && s.name !== "House" && (
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
        <a className="secondary-button" href={`/api/projects/${id}/zip`}>
          Download full project (ZIP)
        </a>
        <p className="muted" style={{ marginTop: 8 }}>
          Bundles every photo in the project organized by site/folder, ready to drop into your AMP folder.
        </p>
      </main>
    </>
  );
}
