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

type Me = { id: string; username: string; name: string | null; isAdmin: boolean } | null;

type OnlineUser = { id: string; username: string; name: string | null };

export default function HomePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
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

    // Projects can be deleted from ops.primecore (see /api/internal/delete-
    // project) while this tab sits open in the background -- re-fetch the
    // list whenever the tab comes back into view, so a project removed
    // elsewhere disappears here without needing a manual page reload.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") loadProjects();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // "Who's online" presence indicator (same pattern as ops.primecore and
  // ExcelApp) -- stamp our own lastSeenAt every ~30s, refresh who else is
  // around every ~20s. Only runs once we know who "we" are.
  useEffect(() => {
    if (!me) return;

    function heartbeat() {
      fetch("/api/presence/heartbeat", { method: "POST" }).catch(() => {});
    }
    function refreshOnlineUsers() {
      fetch("/api/presence/online")
        .then((r) => r.json())
        .then((data) => setOnlineUsers(data.users || []))
        .catch(() => {});
    }

    heartbeat();
    refreshOnlineUsers();
    const heartbeatInterval = setInterval(heartbeat, 30000);
    const refreshInterval = setInterval(refreshOnlineUsers, 20000);
    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(refreshInterval);
    };
  }, [me]);

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
          <div className="app-header-left">
            <h1>PrimeCore Power Solution</h1>
            <p>Field photos, organized by project.</p>
          </div>
          <img src="/logo.png" alt="PrimeCore" className="app-logo" />
          {me && (
            <div className="app-header-user">
              {/* Own name's dot is static, not fetched -- if this page is
                  open, we're online, no need to ask the server. Other
                  online people each get their own name+dot chip -- no
                  count, no tooltip text. */}
              <span className="presence-chip">
                <span className="presence-dot" />
                {me.name || me.username}
              </span>
              {onlineUsers.map((u) => (
                <span className="presence-chip" key={u.id}>
                  <span className="presence-dot" />
                  {u.name || u.username}
                </span>
              ))}
              <a href="/settings/face-id" className="app-header-user-link">Set up Face ID</a>
              {me.isAdmin && (
                <a href="/admin" className="app-header-user-link">Admin</a>
              )}
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

        {/* Standalone -- not a project. Lets the substation's one-line
            print get uploaded during the Bid stage, before a project even
            exists (see OneLinePhoto in prisma/schema.prisma). Placed above
            the project list/creation form on purpose, since this is meant
            to be the first thing reached for that workflow. */}
        <a href="/one-line" className="secondary-button" style={{ display: "block", textAlign: "center", marginTop: 14 }}>
          📐 One Line
        </a>

        {!creating && (
          <button className="camera-button" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
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
