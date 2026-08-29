import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Moderation from "./Moderation";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type {
  AdminHost,
  AdminHostList,
  AdminListQuery,
  AdminUser,
  AdminUserList,
} from "@/lib/wisper/types";

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

/** Envelope helper: the paginated endpoint contract is `{ data, next_offset }`. */
function page<T>(data: T[], next_offset: number | null = null): { data: T[]; next_offset: number | null } {
  return { data, next_offset };
}

describe("Moderation", () => {
  beforeEach(() => {
    listHosts
      .mockReset()
      .mockResolvedValue(page(HOSTS) as AdminHostList);
    listUsers
      .mockReset()
      .mockResolvedValue(page(USERS) as AdminUserList);
    suspendHost.mockReset();
    unsuspendHost.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("lists the first page of hosts and sends the API's limit/offset params", async () => {
    render(<Moderation />);

    expect(await screen.findByText("Acme Compute")).toBeInTheDocument();
    expect(screen.getByText("Bad Actor Co")).toBeInTheDocument();

    // The client asked for a page bounded by ?limit=25&offset=0, not a bare fetch.
    const params = listHosts.mock.calls[0][0] as AdminListQuery | undefined;
    expect(params).toMatchObject({ limit: 25, offset: 0 });
    expect(params?.query).toBeUndefined();
  });

  it("sends the search box as the server's ?query= (not a client-side filter)", async () => {
    // First a bare load, then a search-triggered load that echoes the query.
    listHosts
      .mockReset()
      .mockResolvedValueOnce(page(HOSTS) as AdminHostList)
      .mockResolvedValueOnce(page([HOSTS[0]]) as AdminHostList);

    render(<Moderation />);
    await screen.findByText("Acme Compute");

    await userEvent.type(screen.getByLabelText("Search hosts"), "acme");

    // Debounced fetch fires with the trimmed query; the server, not the client,
    // decides which rows come back.
    await waitFor(() => expect(listHosts).toHaveBeenCalledTimes(2));
    const second = listHosts.mock.calls[1][0] as AdminListQuery | undefined;
    expect(second).toMatchObject({ query: "acme", limit: 25, offset: 0 });

    expect(await screen.findByText("Acme Compute")).toBeInTheDocument();
    expect(screen.queryByText("Bad Actor Co")).not.toBeInTheDocument();
  });

  it("reveals rows past the first page via Load more (uses next_offset)", async () => {
    const MORE: AdminHost = {
      id: "h-3",
      owner_user_id: "user-c",
      name: "Overflow Host",
      status: "active",
      online: true,
    };
    listHosts
      .mockReset()
      // First page reports there's more (next_offset = 25).
      .mockResolvedValueOnce(page(HOSTS, 25) as AdminHostList)
      // Second page returns the overflow row with no further pages.
      .mockResolvedValueOnce(page([MORE], null) as AdminHostList);

    render(<Moderation />);
    await screen.findByText("Acme Compute");

    // The overflow row is not on the first page yet.
    expect(screen.queryByText("Overflow Host")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /load more/i }),
    );

    expect(await screen.findByText("Overflow Host")).toBeInTheDocument();
    // The second call used the echoed next_offset (25), not another 0-page fetch.
    const nextCall = listHosts.mock.calls[1][0] as AdminListQuery | undefined;
    expect(nextCall).toMatchObject({ limit: 25, offset: 25 });
    // Once next_offset is null, "End of results." replaces the button.
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/end of results/i)).toBeInTheDocument();
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
    const params = listUsers.mock.calls[0][0] as AdminListQuery | undefined;
    expect(params).toMatchObject({ limit: 25, offset: 0 });
  });

  it("surfaces a load error with a retry", async () => {
    listHosts.mockReset();
    listHosts.mockRejectedValueOnce(new WisperError(500, "internal", "hosts down"));
    listHosts.mockResolvedValueOnce(page(HOSTS) as AdminHostList);
    render(<Moderation />);

    expect(await screen.findByText("hosts down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Acme Compute")).toBeInTheDocument();
  });
});
