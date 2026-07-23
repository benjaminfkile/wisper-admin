import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminGate from "./AdminGate";
import { AuthContext, type AuthContextValue } from "@/lib/auth/context";
import type { AuthStatus, AuthUser } from "@/lib/auth/jwt";

function adminUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "u-1",
    email: "admin@wisper.dev",
    username: "admin",
    groups: ["admin"],
    isAdmin: true,
    expiresAt: null,
    ...overrides,
  };
}

/** Pretend Cognito is configured so the Hosted-UI sign-in path renders. */
function configureCognito() {
  vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "https://pool.auth.us-east-1.amazoncognito.com");
  vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "client-123");
}

function renderGate(value: Partial<AuthContextValue>) {
  const ctx: AuthContextValue = {
    status: "loading",
    user: null,
    signIn: vi.fn(),
    signInWithKey: vi.fn(async () => "authenticated" as AuthStatus),
    signOut: vi.fn(),
    ...value,
  };
  render(
    <AuthContext.Provider value={ctx}>
      <AdminGate>
        <div>protected content</div>
      </AdminGate>
    </AuthContext.Provider>,
  );
  return ctx;
}

describe("AdminGate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders children for an authenticated admin", () => {
    renderGate({ status: "authenticated", user: adminUser() });
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("shows the not-authorized screen for a signed-in non-admin", () => {
    renderGate({
      status: "forbidden",
      user: adminUser({ email: "user@wisper.dev", groups: ["consumer"], isAdmin: false }),
    });
    expect(screen.getByText("Not authorized")).toBeInTheDocument();
    expect(screen.getByText("user@wisper.dev")).toBeInTheDocument();
    // The gated content must not leak to non-admins.
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("shows the Hosted-UI sign-in prompt when Cognito is configured and invokes signIn", async () => {
    configureCognito();
    const ctx = renderGate({ status: "unauthenticated", user: null });
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    // No paste-a-key field on the Hosted-UI path.
    expect(screen.queryByLabelText("Wisper API key")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(ctx.signIn).toHaveBeenCalledOnce();
  });

  it("shows the paste-a-key form when Cognito is unset and submits the key", async () => {
    // No Cognito env stubbed -> local-dev API-key sign-in.
    const ctx = renderGate({ status: "unauthenticated", user: null });
    const field = screen.getByLabelText("Wisper API key");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(field, "wck_live_abc");
    await userEvent.click(screen.getByRole("button", { name: /sign in with key/i }));
    expect(ctx.signInWithKey).toHaveBeenCalledWith("wck_live_abc");
  });

  it("shows a loading indicator while resolving", () => {
    renderGate({ status: "loading", user: null });
    expect(screen.getByLabelText("Checking access")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });
});
