// WebAuthn (Face ID / Touch ID / Windows Hello passkey) configuration.
//
// IMPORTANT: RP_ID is permanently bound to every passkey registered under
// it -- if this value ever changes (e.g. moving from local dev to a real
// domain), every registered device's Face ID stops working and needs to
// be set up again. Defaults to localhost for local dev; once this app is
// deployed online, set WEBAUTHN_RP_ID (bare domain, no scheme/port) and
// WEBAUTHN_ORIGIN (full https:// URL) in the hosting environment.
export const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
export const RP_NAME = "PrimeCore Field Photos";
export const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3001";
