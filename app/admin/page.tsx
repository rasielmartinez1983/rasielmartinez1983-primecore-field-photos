"use client";

import { useEffect, useState } from "react";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type User = {
  id: string;
  username: string;
  name: string | null;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
};

type AccessCode = {
  id: string;
  code: string;
  note: string | null;
  revoked: boolean;
  usedAt: string | null;
  usedBy: { id: string; username: string } | null;
  createdAt: string;
};

type Me = { id: string; username: string; name: string | null; isAdmin: boolean } | null;

export default function AdminPage() {
  const [me, setMe] = useState<Me>(null);
  const [meChecked, setMeChecked] = useState(false);
  const [users, setUsers] = useState<User[] | null>(null);
  const [codes, setCodes] = useState<AccessCode[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function loadAll() {
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => setUsers([]));
    fetch("/api/access-codes").then((r) => r.json()).then(setCodes).catch(() => setCodes([]));
  }

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          window.location.href = "/login";
          return;
        }
        if (!data.user.isAdmin) {
          window.location.href = "/";
          return;
        }
        setMe(data.user);
        loadAll();
      })
      .catch(() => (window.location.href = "/"))
      .finally(() => setMeChecked(true));
  }, []);

  async function generateCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/access-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not generate a code.");
        return;
      }
      setNote("");
      loadAll();
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeCode(c: AccessCode) {
    if (!confirm(`Revoke code ${c.code}? It will no longer work.`)) return;
    await fetch(`/api/access-codes/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: true }),
    });
    loadAll();
  }

  async function toggleUser(u: User) {
    const goingActive = !u.active;
    if (!goingActive && !confirm(`Remove ${u.username}'s access? They'll be signed out and can't log back in until you restore it.`)) {
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: goingActive }),
    });
    if (res.ok) loadAll();
  }

  if (!meChecked || !me) {
    return null;
  }

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <div className="app-header-row">
          <div className="app-header-left">
            <h1>Admin</h1>
            <p>Grant workers access with a one-time code, and revoke it any time.</p>
          </div>
          <img src="/logo.png" alt="PrimeCore" className="app-logo" />
          <div className="app-header-user">
            <a href="/" className="app-header-user-link">&larr; Back</a>
          </div>
        </div>
      </header>
      <main>
        <h2 className="admin-section-title">Workers</h2>
        {users === null ? (
          <p className="muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="muted">No accounts yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name ? `${u.name} (${u.username})` : u.username}</td>
                  <td>{u.isAdmin ? <span className="admin-badge admin-badge-admin">Admin</span> : "Worker"}</td>
                  <td>
                    {u.active ? (
                      <span className="admin-badge admin-badge-active">Active</span>
                    ) : (
                      <span className="admin-badge admin-badge-inactive">Access removed</span>
                    )}
                  </td>
                  <td>
                    {u.id === me.id ? (
                      <span className="muted">(you)</span>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button admin-btn-small"
                        onClick={() => toggleUser(u)}
                      >
                        {u.active ? "Remove access" : "Restore access"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="admin-section-title">Access codes</h2>
        {codes === null ? (
          <p className="muted">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="muted">No access codes yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Note</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id}>
                  <td className="admin-code-value">{c.code}</td>
                  <td>{c.note || ""}</td>
                  <td>
                    {c.revoked ? (
                      <span className="admin-badge admin-badge-revoked">Revoked</span>
                    ) : c.usedAt ? (
                      <span className="admin-badge admin-badge-inactive">Used by {c.usedBy?.username}</span>
                    ) : (
                      <span className="admin-badge admin-badge-active">Unused</span>
                    )}
                  </td>
                  <td>
                    {!c.revoked && !c.usedAt && (
                      <button
                        type="button"
                        className="secondary-button admin-btn-small"
                        onClick={() => revokeCode(c)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="capture-card" onSubmit={generateCode} style={{ marginTop: 16 }}>
          <label className="field-label" htmlFor="note">
            Note (optional)
          </label>
          <input
            id="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Danys"
          />
          {error && <div className="error-text">{error}</div>}
          <button className="camera-button" type="submit" disabled={busy}>
            {busy ? "Generating…" : "Generate access code"}
          </button>
        </form>
      </main>
    </>
  );
}
