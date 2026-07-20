import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApiKeySignIn from "./ApiKeySignIn";
import { AuthContext, type AuthContextValue } from "@/lib/auth/context";
import type { AuthStatus } from "@/lib/auth/jwt";

function renderForm(signInWithKey: (key: string) => Promise<AuthStatus>) {
  const ctx: AuthContextValue = {
    status: "unauthenticated",
    user: null,
    signIn: vi.fn(),
    signInWithKey,
    signOut: vi.fn(),
  };
  render(
    <AuthContext.Provider value={ctx}>
      <ApiKeySignIn />
    </AuthContext.Provider>,
  );
}

describe("ApiKeySignIn", () => {
  it("takes the key as a password input and never renders it as text", async () => {
    renderForm(vi.fn(async () => "authenticated"));
    const field = screen.getByLabelText("Wisper API key");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(field, "wck_live_secret");
    // The value is bound but the field masks it (type=password); it is not echoed.
    expect(field).toHaveValue("wck_live_secret");
    expect(screen.queryByText("wck_live_secret")).not.toBeInTheDocument();
  });

  it("does not submit an empty key", async () => {
    const signInWithKey = vi.fn(async () => "authenticated" as AuthStatus);
    renderForm(signInWithKey);
    // The submit button is disabled until something is typed.
    expect(screen.getByRole("button", { name: /sign in with key/i })).toBeDisabled();
    expect(signInWithKey).not.toHaveBeenCalled();
  });

  it("surfaces an inline error when the backend rejects the key", async () => {
    renderForm(vi.fn(async () => "unauthenticated"));
    await userEvent.type(screen.getByLabelText("Wisper API key"), "wck_live_bad");
    await userEvent.click(screen.getByRole("button", { name: /sign in with key/i }));
    await waitFor(() =>
      expect(screen.getByText(/that key was rejected/i)).toBeInTheDocument(),
    );
  });
});
