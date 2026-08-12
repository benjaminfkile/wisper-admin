import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PolicyEditor from "./PolicyEditor";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { AdminPolicy, PolicyVersion } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { getPolicy: vi.fn(), updatePolicy: vi.fn() },
}));

const getPolicy = vi.mocked(admin.getPolicy);
const updatePolicy = vi.mocked(admin.updatePolicy);

// Real /v1/admin/policy envelope: { active: PolicyView, versions: [PolicyView] }.
// PolicyView fields: fee_bps, min_topup_cents, max_concurrent_leases_per_user,
// max_ttl_seconds_cap, min_isolation, first_topup_max_cents,
// new_account_window_hours, new_account_max_topup_cents_per_day,
// max_spend_cents_per_day, effective_from, host_signups_enabled,
// plus server-assigned: id, created_by.
const ACTIVE: PolicyVersion = {
  id: "pol-3",
  fee_bps: 500,
  min_topup_cents: 1000,           // $10.00
  max_concurrent_leases_per_user: 4,
  host_signups_enabled: true,
  effective_from: "2026-07-10T12:00:00Z",
  created_by: "admin@wisper.dev",
};

const V2: PolicyVersion = {
  id: "pol-2",
  fee_bps: 400,
  min_topup_cents: 1000,           // $10.00
  max_concurrent_leases_per_user: 3,
  host_signups_enabled: true,
  effective_from: "2026-06-01T12:00:00Z",
  created_by: "founder@wisper.dev",
};

const POLICY: AdminPolicy = { active: ACTIVE, versions: [ACTIVE, V2] };

describe("PolicyEditor", () => {
  beforeEach(() => {
    getPolicy.mockReset();
    updatePolicy.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("loads the policy into the form and shows version history", async () => {
    getPolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    // fee_bps loads as bps (500).
    expect(await screen.findByLabelText("Platform fee")).toHaveValue(500);
    // min_topup_cents (1000 cents) displays as dollars ($10 → 10).
    expect(screen.getByLabelText("Minimum top-up")).toHaveValue(10);
    // The active policy id chip renders.
    expect(screen.getAllByText("pol-3").length).toBeGreaterThan(0);

    // Version history table renders the revisions.
    const table = screen.getByRole("table", { name: /policy version history/i });
    expect(within(table).getByText("pol-2")).toBeInTheDocument();
    expect(within(table).getByText("founder@wisper.dev")).toBeInTheDocument();
  });

  it("saves edits via updatePolicy with correct field names and sends cents", async () => {
    getPolicy.mockResolvedValue(POLICY);
    // After save: min_topup_cents updated to 2000 (= $20), version id bumped.
    const savedActive: PolicyVersion = {
      ...ACTIVE,
      id: "pol-4",
      min_topup_cents: 2000,
    };
    updatePolicy.mockResolvedValue({
      active: savedActive,
      versions: [savedActive, ACTIVE, V2],
    });
    render(<PolicyEditor />);

    // min_topup_cents=1000 cents → displayed as "10" dollars; change to "20" dollars.
    const topup = await screen.findByLabelText("Minimum top-up");
    await userEvent.clear(topup);
    await userEvent.type(topup, "20");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    // Sent as cents: $20 → 2000; fee_bps stays at 500.
    expect(updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ min_topup_cents: 2000, fee_bps: 500 }),
    );
    expect(await screen.findByText("Policy saved.")).toBeInTheDocument();
  });

  it("loads the current isolation floor and saves a changed floor", async () => {
    getPolicy.mockResolvedValue({
      active: { ...ACTIVE, min_isolation: "shared" },
      versions: [{ ...ACTIVE, min_isolation: "shared" }, V2],
    });
    const savedActive: PolicyVersion = {
      ...ACTIVE,
      id: "pol-4",
      min_isolation: "vm",
    };
    updatePolicy.mockResolvedValue({
      active: savedActive,
      versions: [savedActive, ACTIVE, V2],
    });
    render(<PolicyEditor />);

    // The floor loaded from the policy is reflected in the select.
    const floor = await screen.findByLabelText("Minimum isolation floor");
    expect(floor).toHaveTextContent("shared");
    // The helper note explains the rejection behaviour.
    expect(
      screen.getByText(/requesting a weaker isolation level than the floor is rejected/i),
    ).toBeInTheDocument();

    // MUI's `TextField select` renders a listbox; pick "vm".
    await userEvent.click(screen.getByLabelText("Minimum isolation floor"));
    await userEvent.click(screen.getByRole("option", { name: "vm" }));

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    expect(updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ min_isolation: "vm" }),
    );
  });

  it("sends null when the isolation floor is 'No floor'", async () => {
    getPolicy.mockResolvedValue({
      active: { ...ACTIVE, min_isolation: "sandboxed" },
      versions: [{ ...ACTIVE, min_isolation: "sandboxed" }, V2],
    });
    updatePolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    const floor = await screen.findByLabelText("Minimum isolation floor");
    expect(floor).toHaveTextContent("sandboxed");

    await userEvent.click(screen.getByLabelText("Minimum isolation floor"));
    await userEvent.click(screen.getByRole("option", { name: "No floor" }));

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    expect(updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ min_isolation: null }),
    );
  });

  it("blocks saving when fee_bps exceeds 10000", async () => {
    getPolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    const fee = await screen.findByLabelText("Platform fee");
    await userEvent.clear(fee);
    await userEvent.type(fee, "10001");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText(/Platform fee must be between 0 and 10000/i),
    ).toBeInTheDocument();
    expect(updatePolicy).not.toHaveBeenCalled();
  });

  it("sends fee_bps as an integer (not the stale platform_fee_bps key)", async () => {
    getPolicy.mockResolvedValue(POLICY);
    updatePolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    // Change any field to make the form dirty.
    const leases = await screen.findByLabelText("Max concurrent leases per user");
    await userEvent.clear(leases);
    await userEvent.type(leases, "5");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    const payload = updatePolicy.mock.calls[0][0];
    // Must send fee_bps, NOT platform_fee_bps.
    expect(payload).toHaveProperty("fee_bps");
    expect(payload).not.toHaveProperty("platform_fee_bps");
    // Must send max_concurrent_leases_per_user, NOT max_active_leases_per_user.
    expect(payload).toHaveProperty("max_concurrent_leases_per_user", 5);
    expect(payload).not.toHaveProperty("max_active_leases_per_user");
    // Must NOT send removed fields.
    expect(payload).not.toHaveProperty("min_price_per_hour");
    expect(payload).not.toHaveProperty("max_price_per_hour");
    expect(payload).not.toHaveProperty("default_network");
    expect(payload).not.toHaveProperty("min_topup");
  });

  it("surfaces a load error with a retry", async () => {
    getPolicy.mockRejectedValueOnce(new WisperError(403, "forbidden", "nope"));
    getPolicy.mockResolvedValueOnce(POLICY);
    render(<PolicyEditor />);

    expect(await screen.findByText("nope")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByLabelText("Platform fee")).toHaveValue(500);
  });
});
