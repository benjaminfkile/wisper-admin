import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Moderation from "./Moderation";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { AdminHost, AdminUser } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: {
    listHosts: vi.fn(),
    listUsers: vi.fn(),
    suspendHost: vi.fn(),
    unsuspendHost: vi.fn(),
    suspendUser: vi.fn(),
    unsuspendUser: vi.fn(),
  },
}));

const listHosts = vi.mocked(admin.listHosts);
const listUsers = vi.mocked(admin.listUsers);
const suspendHost = vi.mocked(admin.suspendHost);
const unsuspendHost = vi.mocked(admin.unsuspendHost);

// Real /v1/admin/hosts item fields, live-verified 2026-07-20.
const HOSTS: AdminHost[] = [
  {
    id: "h-1",
    owner_user_id: "user-acme",
    name: "Acme Compute",
    label: "acme-box",
    status: "active",
    online: true,
    isolation_levels: ["shared", "sandboxed", "vm"],
    default_isolation: "sandboxed",
    last_seen_at: "2026-07-19T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "h-2",
    owner_user_id: "user-bad",
    name: "Bad Actor Co",
    label: "bad-box",
    status: "suspended",
    online: false,
    last_seen_at: "2026-03-01T00:00:00Z",
    created_at: "2026-02-01T00:00:00Z",
    suspended_at: "2026-03-01T00:00:00Z",
    suspended_reason: "fraud",
  },
];

// Real /v1/admin/users item fields, live-verified 2026-07-20.
const USERS: AdminUser[] = [
  {
    id: "u-1",
    email: "dana@example.com",
    status: "active",
    connect_status: "complete",
    has_stripe_customer: true,
    has_connect_account: false,
    created_at: "2026-01-15T00:00:00Z",
  },
];

describe("Moderation", () => {
  beforeEach(() => {
    listHosts.mockReset().mockResolvedValue(HOSTS);
    listUsers.mockReset().mockResolvedValue(USERS);
    suspendHost.mockReset();
    unsuspendHost.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("lists hosts and filters them by search", async () => {
    render(<Moderation />);

    expect(await screen.findByText("Acme Compute")).toBeInTheDocument();
    expect(screen.getByText("Bad Actor Co")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search hosts"), "acme");
    expect(screen.getByText("Acme Compute")).toBeInTheDocument();
    expect(screen.queryByText("Bad Actor Co")).not.toBeInTheDocument();
  });

  it("shows each host's isolation levels as labeled chips and marks the default", async () => {
    render(<Moderation />);

    const acmeRow = (await screen.findByText("Acme Compute")).closest("tr")!;
    // Every supported level is shown with its human label; the default is tagged.
    expect(within(acmeRow).getByText("Shared kernel")).toBeInTheDocument();
    expect(within(acmeRow).getByText("gVisor sandbox (default)")).toBeInTheDocument();
    expect(within(acmeRow).getByText("VM isolation")).toBeInTheDocument();

    // A host with no reported levels renders a dash rather than crashing.
    const badRow = (await screen.findByText("Bad Actor Co")).closest("tr")!;
    expect(within(badRow).queryByText(/kernel|sandbox|isolation/i)).toBeNull();
  });

  it("suspends a host with a reason", async () => {
    suspendHost.mockResolvedValue({ ...HOSTS[0], status: "suspended" });
    render(<Moderation />);

    // Click the Suspend button in the Acme row.
    const acmeRow = (await screen.findByText("Acme Compute")).closest("tr")!;
    await userEvent.click(within(acmeRow).getByRole("button", { name: /suspend/i }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Suspension reason"),
      "abuse detected",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^suspend$/i }),
    );

    await waitFor(() =>
      expect(suspendHost).toHaveBeenCalledWith("h-1", "abuse detected"),
    );
  });

  it("unsuspends a suspended host", async () => {
    unsuspendHost.mockResolvedValue({ ...HOSTS[1], status: "active" });
    render(<Moderation />);

    const badRow = (await screen.findByText("Bad Actor Co")).closest("tr")!;
    await userEvent.click(
      within(badRow).getByRole("button", { name: /unsuspend/i }),
    );

    await waitFor(() => expect(unsuspendHost).toHaveBeenCalledWith("h-2"));
  });

  it("switches to the consumers tab and lists users", async () => {
    render(<Moderation />);
    await screen.findByText("Acme Compute");

    await userEvent.click(screen.getByRole("tab", { name: /consumers/i }));

    expect(await screen.findByText("dana@example.com")).toBeInTheDocument();
    expect(listUsers).toHaveBeenCalled();
  });

  it("surfaces a load error with a retry", async () => {
    listHosts.mockReset();
    listHosts.mockRejectedValueOnce(new WisperError(500, "internal", "hosts down"));
    listHosts.mockResolvedValueOnce(HOSTS);
    render(<Moderation />);

    expect(await screen.findByText("hosts down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Acme Compute")).toBeInTheDocument();
  });
});
