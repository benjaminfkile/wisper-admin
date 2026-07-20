import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";
import { API_KEY_KEY } from "./storage";
import { WisperError } from "@/lib/wisper/client";

// Mock at the admin-client boundary: the gate's backend probe is admin.getOverview.
vi.mock("@/lib/wisper/admin", () => ({
  admin: { getOverview: vi.fn() },
}));
import { admin } from "@/lib/wisper/admin";

const getOverview = admin.getOverview as unknown as ReturnType<typeof vi.fn>;

/** Surfaces the gate state and session actions for assertions. */
function Harness() {
  const { status, user, signInWithKey, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="isAdmin">{String(user?.isAdmin ?? false)}</span>
      <button onClick={() => void signInWithKey("wck_live_key")}>sign-in-key</button>
      <button onClick={() => signOut()}>sign-out</button>
    </div>
  );
}

function renderApp() {
  render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

const status = () => screen.getByTestId("status").textContent;

describe("AuthProvider — API key sign-in", () => {
  beforeEach(() => {
    getOverview.mockReset();
    window.localStorage.clear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("happy path: a 200 overview probe signs in an admin", async () => {
    getOverview.mockResolvedValue({});
    renderApp();
    await waitFor(() => expect(status()).toBe("unauthenticated"));

    await userEvent.click(screen.getByText("sign-in-key"));

    await waitFor(() => expect(status()).toBe("authenticated"));
    expect(screen.getByTestId("isAdmin").textContent).toBe("true");
    expect(getOverview).toHaveBeenCalled();
    // The key is persisted so the session survives a reload.
    expect(window.localStorage.getItem(API_KEY_KEY)).toBe("wck_live_key");
  });

  it("403: a valid key without admin scope lands on forbidden (key kept)", async () => {
    getOverview.mockRejectedValue(new WisperError(403, "forbidden", "not an admin"));
    renderApp();
    await waitFor(() => expect(status()).toBe("unauthenticated"));

    await userEvent.click(screen.getByText("sign-in-key"));

    await waitFor(() => expect(status()).toBe("forbidden"));
    expect(screen.getByTestId("isAdmin").textContent).toBe("false");
    expect(window.localStorage.getItem(API_KEY_KEY)).toBe("wck_live_key");
  });

  it("401: a bad/revoked key is cleared and left unauthenticated", async () => {
    getOverview.mockRejectedValue(new WisperError(401, "unauthorized", "bad key"));
    renderApp();
    await waitFor(() => expect(status()).toBe("unauthenticated"));

    await userEvent.click(screen.getByText("sign-in-key"));

    await waitFor(() => expect(status()).toBe("unauthenticated"));
    expect(window.localStorage.getItem(API_KEY_KEY)).toBeNull();
  });

  it("restore-on-mount: a stored key is re-probed and restored on load", async () => {
    window.localStorage.setItem(API_KEY_KEY, "wck_live_key");
    getOverview.mockResolvedValue({});
    renderApp();

    await waitFor(() => expect(status()).toBe("authenticated"));
    expect(getOverview).toHaveBeenCalled();
  });

  it("sign-out clears the held key and drops back to unauthenticated", async () => {
    window.localStorage.setItem(API_KEY_KEY, "wck_live_key");
    getOverview.mockResolvedValue({});
    renderApp();
    await waitFor(() => expect(status()).toBe("authenticated"));

    await userEvent.click(screen.getByText("sign-out"));

    await waitFor(() => expect(status()).toBe("unauthenticated"));
    expect(window.localStorage.getItem(API_KEY_KEY)).toBeNull();
  });
});
