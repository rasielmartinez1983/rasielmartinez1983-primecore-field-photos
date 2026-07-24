"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import HeaderBgStrip from "@/components/HeaderBgStrip";

type Passkey = { id: string; label: string | null; deviceType: string | null; createdAt: string };

export default function FaceIdSettingsPage() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/webauthn")
      .then((r) => r.json())
      .then(setPasskeys)
      .catch(() => setPasskeys([]));
  }

  useEffect(load, []);

  async function addDevice() {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/webauthn/register-options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        setError(options.error || "Could not start Face ID setup.");
        return;
      }
      const attestation = await startRegistration(options);
      const label = guessDeviceLabel();
      const verifyRes = await fetch("/api/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attestation, label }),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        setError(data.error || "Could not add this device.");
        return;
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof Error && err.name === "NotAllowedError" ? "Cancelled." : "Could not add this device.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(pk: Passkey) {
    if (!confirm(`Remove "${pk.label || "this device"}"? It won't be able to sign in anymore.`)) return;
    setError("");
    const res = await fetch("/api/webauthn/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pk.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove that device.");
      return;
    }
    load();
  }

  return (
    <>
      <header className="app-header">
        <HeaderBgStrip />
        <a href="/" className="app-header-back">‹ Home</a>
        <img src="/logo.png" alt="PrimeCore" className="app-logo" />
        <div className="app-header-spacer" />
      </header>
      <main>
        <h1>Face ID Devices</h1>
        <p className="muted">Every device below can sign in with Face ID / Touch ID.</p>

        {passkeys === null && <p className="muted">Loading…</p>}
        {passkeys && passkeys.length === 0 && <div className="empty-state">No devices set up.</div>}
        {passkeys && passkeys.length > 0 && (
          <div className="tile-grid">
            {passkeys.map((pk) => (
              <div key={pk.id} className="tile" style={{ cursor: "default" }}>
                <span className="tile-label">{pk.label || "Device"}</span>
                <span className="tile-count">{new Date(pk.createdAt).toLocaleDateString()}</span>
                <span
                  role="button"
                  aria-label={`Remove ${pk.label || "this device"}`}
                  className="tile-delete-btn"
                  onClick={() => removeDevice(pk)}
                >
                  Delete
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <div className="error-text" style={{ marginTop: 14 }}>{error}</div>}

        <button
          className="camera-button"
          style={{ marginTop: 18 }}
          onClick={addDevice}
          disabled={busy}
        >
          {busy ? "Setting up…" : "+ Add this device's Face ID"}
        </button>
      </main>
    </>
  );
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Android/.test(ua)) return "Android device";
  return "Device";
}
