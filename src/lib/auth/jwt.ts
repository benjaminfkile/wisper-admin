// Cognito JWT helpers. The admin app decodes the ID token client-side only to
// drive UX (which screen to show, whose name in the AppBar). It never trusts the
// decode for security; the Wisper API independently verifies the token's
// signature and the `admin` group membership on every /v1/admin call.

/** The Cognito group that grants access to this admin app. */
export const ADMIN_GROUP = "admin";

/** Claims we read out of a Cognito ID token. */
export interface CognitoClaims {
  sub?: string;
  email?: string;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  /** Expiry, seconds since the epoch. */
  exp?: number;
  token_use?: string;
  [claim: string]: unknown;
}

/** The authenticated identity, distilled from the token claims. */
export interface AuthUser {
  sub: string;
  email: string;
  username: string;
  groups: string[];
  isAdmin: boolean;
  /** Expiry in ms since the epoch, or null when the token omits `exp`. */
  expiresAt: number | null;
}

/** Where an authenticated-but-loaded session can land. */
export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "forbidden" // valid session, but not in the admin group
  | "authenticated"; // valid session, admin group

/** Resolved auth state consumed by the gate and shell. */
export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

/** Base64url-decode a JWT segment into a UTF-8 string. */
function decodeSegment(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  // Re-interpret the binary string as UTF-8.
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decode a JWT's payload without verifying its signature. Returns null on any
 *  malformed input. */
export function decodeJwt(token: string): CognitoClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decodeSegment(parts[1])) as CognitoClaims;
  } catch {
    return null;
  }
}

/** Build the AuthUser view from decoded claims. */
export function userFromClaims(claims: CognitoClaims): AuthUser {
  const groups = Array.isArray(claims["cognito:groups"])
    ? (claims["cognito:groups"] as string[])
    : [];
  return {
    sub: claims.sub ?? "",
    email: claims.email ?? "",
    username: claims["cognito:username"] ?? claims.email ?? claims.sub ?? "",
    groups,
    isAdmin: groups.includes(ADMIN_GROUP),
    expiresAt: typeof claims.exp === "number" ? claims.exp * 1000 : null,
  };
}

/** Resolve a raw token (or its absence) into gate-ready auth state.
 *  `now` is injectable for deterministic tests. */
export function resolveAuth(token: string | null, now = Date.now()): AuthState {
  if (!token) return { status: "unauthenticated", user: null };

  const claims = decodeJwt(token);
  if (!claims) return { status: "unauthenticated", user: null };

  const user = userFromClaims(claims);
  if (user.expiresAt !== null && user.expiresAt <= now) {
    // Expired sessions are treated as signed-out.
    return { status: "unauthenticated", user: null };
  }

  return { status: user.isAdmin ? "authenticated" : "forbidden", user };
}
