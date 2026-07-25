"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          name: mode === "register" ? name : undefined,
          code: mode === "register" ? code : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not sign in.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFaceId() {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        setError(options.error || "Could not start Face ID sign-in.");
        return;
      }
      const authResponse = await startAuthentication(options);
      const verifyRes = await fetch("/api/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResponse),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        setError(data.error || "Face ID sign-in failed.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error && err.name === "NotAllowedError" ? "Cancelled." : "Could not sign in with Face ID.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.png" alt="PrimeCore" className="login-logo" />
        <h1>PrimeCore Field Photos</h1>
        <p className="muted">{mode === "login" ? "Sign in to your account" : "Create your account"}</p>

        <input
          type="text"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
        />
        {mode === "register" && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
          />
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        {mode === "register" && (
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Invite code"
          />
        )}

        {error && <div className="error-text">{error}</div>}

        <button
          type="submit"
          disabled={busy || !username || !password || (mode === "register" && !code)}
        >
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>

        {supported && (
          <>
            <div style={{ height: 10 }} />
            <button type="button" className="secondary-button" onClick={handleFaceId} disabled={busy}>
              Sign in with Face ID
            </button>
          </>
        )}

        <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("register");
                  setError("");
                }}
              >
                Create one
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
