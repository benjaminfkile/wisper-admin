import { describe, expect, it } from "vitest";
import { decodeJwt, resolveAuth, userFromClaims, type CognitoClaims } from "./jwt";

/** Encode claims into an unsigned JWT (header.payload.signature) for tests. */
function makeToken(claims: CognitoClaims): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.sig`;
}

const NOW = 1_700_000_000_000; // fixed "now" in ms
const FUTURE = Math.floor(NOW / 1000) + 3600; // exp 1h ahead (seconds)
const PAST = Math.floor(NOW / 1000) - 3600; // exp 1h ago (seconds)

describe("decodeJwt", () => {
  it("decodes the payload of a well-formed token", () => {
    const token = makeToken({ sub: "u-1", email: "a@b.co" });
    expect(decodeJwt(token)?.email).toBe("a@b.co");
  });

  it("handles UTF-8 claims", () => {
    const token = makeToken({ email: "tëst@ex½mple.co" });
    expect(decodeJwt(token)?.email).toBe("tëst@ex½mple.co");
  });

  it("returns null for a non-JWT string", () => {
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("a.b")).toBeNull();
  });
});

describe("userFromClaims", () => {
  it("flags admin membership from cognito:groups", () => {
    const user = userFromClaims({
      sub: "u-1",
      email: "admin@wisper.dev",
      "cognito:groups": ["admin", "ops"],
      exp: FUTURE,
    });
    expect(user.isAdmin).toBe(true);
    expect(user.groups).toEqual(["admin", "ops"]);
    expect(user.expiresAt).toBe(FUTURE * 1000);
  });

  it("defaults groups to empty when the claim is absent", () => {
    const user = userFromClaims({ sub: "u-2" });
    expect(user.groups).toEqual([]);
    expect(user.isAdmin).toBe(false);
    expect(user.expiresAt).toBeNull();
  });
});

describe("resolveAuth", () => {
  it("is unauthenticated with no token", () => {
    expect(resolveAuth(null, NOW).status).toBe("unauthenticated");
  });

  it("is authenticated for an admin with a live token", () => {
    const token = makeToken({ email: "admin@wisper.dev", "cognito:groups": ["admin"], exp: FUTURE });
    const state = resolveAuth(token, NOW);
    expect(state.status).toBe("authenticated");
    expect(state.user?.isAdmin).toBe(true);
  });

  it("is forbidden for a signed-in non-admin", () => {
    const token = makeToken({ email: "user@wisper.dev", "cognito:groups": ["consumer"], exp: FUTURE });
    const state = resolveAuth(token, NOW);
    expect(state.status).toBe("forbidden");
    expect(state.user?.email).toBe("user@wisper.dev");
  });

  it("treats an expired admin token as unauthenticated", () => {
    const token = makeToken({ email: "admin@wisper.dev", "cognito:groups": ["admin"], exp: PAST });
    expect(resolveAuth(token, NOW).status).toBe("unauthenticated");
  });

  it("is unauthenticated for a malformed token", () => {
    expect(resolveAuth("garbage", NOW).status).toBe("unauthenticated");
  });
});
