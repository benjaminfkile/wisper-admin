import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminGate from "./AdminGate";
import { AuthContext, type AuthContextValue } from "@/lib/auth/context";
import type { AuthUser } from "@/lib/auth/jwt";

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

function renderGate(value: Partial<AuthContextValue>) {
  const ctx: AuthContextValue = {
    status: "loading",
    user: null,
    signIn: vi.fn(),
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

  it("shows a sign-in prompt when unauthenticated and invokes signIn", async () => {
    const ctx = renderGate({ status: "unauthenticated", user: null });
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(ctx.signIn).toHaveBeenCalledOnce();
  });

  it("shows a loading indicator while resolving", () => {
    renderGate({ status: "loading", user: null });
    expect(screen.getByLabelText("Checking access")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });
});
