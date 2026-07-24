"use client";

import { useEffect, useState } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type Project = {
  id: string;
  name: string;
  substationName: string;
  client: string | null;
  date: string | null;
  folderCount: number;
};

type Me = { id: string; username: string; name: string | null } | null;

export default function HomePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [creating, setCreating] = useState(false);
  const [substationName, setSubstationName] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function loadProjects() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    loadProjects();
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          // A session cookie from before per-account logins existed (or
          // one whose account got deleted) still passes middleware's
          // signature check, but doesn't map to a real account. Send them
          // to sign in for real instead of silently showing a page with
          // no login/logout/Face ID controls.
          window.location.href = "/login";
          return;
        }
        setMe(data.user);
      })
      .catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!substationName.trim() || !name.trim() || !client.trim() || !date) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substationName, name, client, date }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the project.");
        return;
      }
      setSubstationName("");
      setName("");
      setClient("");
      setDate("");
      setCreating(false);
      loadProjects();
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(e: React.MouseEvent, p: Project) {
    e.preventDefault();
    e.stopPropagation();
    const warning =
      p.folderCount > 0
        ? `Delete "${p.substationName} — ${p.name}" and its ${p.folderCount} folder${
            p.folderCount === 1 ? "" : "s"
          } (with all photos inside)? This can't be undone.`
        : `Delete "${p.substationName} — ${p.name}"?`;
    if (!confirm(warning)) return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    loadProjects();
  }

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <div className="app-header-row">
          <div />
          <img src="/logo.png" alt="PrimeCore" className="app-logo" />
          {me && (
            <div className="app-header-user">
              <span>{me.name || me.username}</span>
              <a href="/settings/face-id" className="app-header-user-link">Face ID</a>
              <a
                href="#"
                className="app-header-user-link"
                onClick={(e) => {
                  e.preventDefault();
                  handleLogout();
                }}
              >
                Log out
              </a>
            </div>
          )}
        </div>
      </header>
      <main>
        <h1>Field Photos</h1>
        <p className="muted">Choose a project or create a new one.</p>

        {!creating && (
          <button className="camera-button" style={{ marginTop: 14 }} onClick={() => setCreating(true)}>
            + New project
          </button>
        )}

        {creating && (
          <form className="capture-card" onSubmit={createProject}>
            <label className="field-label" htmlFor="substationName">
              Substation (e.g. Bandit)
            </label>
            <input
              id="substationName"
              type="text"
              value={substationName}
              onChange={(e) => setSubstationName(e.target.value)}
              placeholder="Bandit"
              autoFocus
            />
            <label className="field-label" htmlFor="projectName">
              Project name (e.g. 2024 New Solar Substation)
            </label>
            <input
              id="projectName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2024 New Solar Substation"
            />
            <label className="field-label" htmlFor="client">
              Client
            </label>
            <input
              id="client"
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="FPL"
            />
            <label className="field-label" htmlFor="projectDate">
              Date
            </label>
            <input
              id="projectDate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {error && <div className="error-text">{error}</div>}
            <button
              className="camera-button"
              type="submit"
              disabled={busy || !substationName.trim() || !name.trim() || !client.trim() || !date}
            >
              {busy ? "Creating…" : "Create project"}
            </button>
            <div style={{ height: 10 }} />
            <button
              type="button"
              className="secondary-button"
              style={{ width: "100%" }}
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="gallery-header">
          <h1 style={{ fontSize: 15, margin: 0 }}>Projects</h1>
        </div>

        {projects === null && <p className="muted">Loading…</p>}
        {projects && projects.length === 0 && (
          <div className="empty-state">No projects yet. Create the first one above.</div>
        )}
        {projects && projects.length > 0 && (
          <div className="category-grid" style={{ gridTemplateColumns: "1fr" }}>
            {projects.map((p) => (
              <a
                key={p.id}
                href={`/project/${p.id}`}
                className="category-card"
                style={{ alignItems: "flex-start", textAlign: "left", position: "relative" }}
              >
                <div className="category-card-label" style={{ paddingRight: 60 }}>
                  {p.substationName} — {p.name}
                </div>
                {(p.client || p.date) && (
                  <div className="category-card-count">
                    {[p.client, p.date ? new Date(p.date).toLocaleDateString() : null]
                      .filter(Boolean)
                      .join(" — ")}
                  </div>
                )}
                <div className="category-card-count">
                  {p.folderCount} {p.folderCount === 1 ? "folder" : "folders"}
                </div>
                <span
                  role="button"
                  aria-label={`Delete ${p.substationName} — ${p.name}`}
                  className="category-card-delete-btn"
                  onClick={(e) => deleteProject(e, p)}
                >
                  Delete
                </span>
              </a>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
