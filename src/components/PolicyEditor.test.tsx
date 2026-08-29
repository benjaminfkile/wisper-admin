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
// max_spend_cents_per_day, effective_from, plus server-assigned: id, created_by.
const ACTIVE: PolicyVersion = {
  id: "pol-3",
  fee_bps: 500,
  min_topup_cents: 1000,           // $10.00
  max_concurrent_leases_per_user: 4,
  effective_from: "2026-07-10T12:00:00Z",
  created_by: "admin@wisper.dev",
};

const V2: PolicyVersion = {
  id: "pol-2",
  fee_bps: 400,
  min_topup_cents: 1000,           // $10.00
  max_concurrent_leases_per_user: 3,
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
    // PUT returns the bare PolicyView (not { active, versions }); the editor
    // re-reads GET to refresh the id chip and history.
    const savedActive: PolicyVersion = {
      ...ACTIVE,
      id: "pol-4",
      min_topup_cents: 2000,
    };
    updatePolicy.mockResolvedValue(savedActive);
    getPolicy.mockResolvedValueOnce(POLICY).mockResolvedValueOnce({
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
    const withFloor: AdminPolicy = {
      active: { ...ACTIVE, min_isolation: "shared" },
      versions: [{ ...ACTIVE, min_isolation: "shared" }, V2],
    };
    getPolicy.mockResolvedValueOnce(withFloor);
    const savedActive: PolicyVersion = {
      ...ACTIVE,
      id: "pol-4",
      min_isolation: "vm",
    };
    updatePolicy.mockResolvedValue(savedActive);
    getPolicy.mockResolvedValueOnce({
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
    updatePolicy.mockResolvedValue(ACTIVE);
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
    updatePolicy.mockResolvedValue(ACTIVE);
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
    // host_signups_enabled is not part of PolicyUpdateRequest / PolicyView; it
    // must not be sent (the API would ignore it and the switch would silently
    // reset to off after every save).
    expect(payload).not.toHaveProperty("host_signups_enabled");
  });

  it("does not render a host-signups toggle (no such field on PolicyView)", async () => {
    getPolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);
    // Wait for the form to hydrate before asserting absence.
    await screen.findByLabelText("Platform fee");
    expect(screen.queryByLabelText(/host signups/i)).toBeNull();
    // The version-history "Signups" column is also gone.
    const table = screen.getByRole("table", { name: /policy version history/i });
    expect(within(table).queryByText(/signups/i)).toBeNull();
  });

  it("does not send effective_from when the admin didn't touch the field", async () => {
    // wisper-api picks the active version by ORDER BY effective_from DESC and
    // only defaults effective_from to now() when it is ABSENT on the PUT body.
    // Echoing the active version's timestamp ties the new revision and leaves
    // the old policy active, so the editor MUST omit the key entirely unless
    // the admin explicitly typed a new value.
    getPolicy.mockResolvedValue(POLICY);
    updatePolicy.mockResolvedValue(ACTIVE);
    render(<PolicyEditor />);

    // Change a different field to make the form dirty.
    const fee = await screen.findByLabelText("Platform fee");
    await userEvent.clear(fee);
    await userEvent.type(fee, "600");

    // The datetime-local input renders blank even though the loaded active
    // revision carries a full DateTimeOffset in effective_from.
    expect(screen.getByLabelText("Effective from")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    const payload = updatePolicy.mock.calls[0][0];
    expect(payload).not.toHaveProperty("effective_from");
  });

  it("sends an entered datetime-local value as an ISO 8601 string with timezone", async () => {
    getPolicy.mockResolvedValue(POLICY);
    updatePolicy.mockResolvedValue(ACTIVE);
    render(<PolicyEditor />);

    const eff = await screen.findByLabelText("Effective from");
    // datetime-local yields "YYYY-MM-DDTHH:MM" (no timezone).
    await userEvent.type(eff, "2026-12-31T09:30");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    const payload = updatePolicy.mock.calls[0][0] as { effective_from?: string };
    expect(typeof payload.effective_from).toBe("string");
    // Must serialize to an ISO 8601 timestamp with a timezone designator (Z or
    // an explicit +HH:MM/-HH:MM offset). The local-time input is interpreted
    // in the runner's timezone, so the exact wall-clock value depends on TZ;
    // the shape check is the invariant.
    expect(payload.effective_from).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/,
    );
    expect(new Date(payload.effective_from!).getTime()).toBe(
      new Date("2026-12-31T09:30").getTime(),
    );
  });

  it("re-reads GET /v1/admin/policy after a save and shows the new active version and history", async () => {
    // PUT /v1/admin/policy returns a bare PolicyView (no { active, versions }
    // envelope). The editor must call GET afterwards or the id chip,
    // effective header and history table would vanish.
    getPolicy.mockResolvedValueOnce(POLICY);
    const savedActive: PolicyVersion = {
      ...ACTIVE,
      id: "pol-4",
      fee_bps: 750,
      effective_from: "2026-08-30T00:00:00Z",
      created_by: "admin@wisper.dev",
    };
    updatePolicy.mockResolvedValue(savedActive);
    getPolicy.mockResolvedValueOnce({
      active: savedActive,
      versions: [savedActive, ACTIVE, V2],
    });

    render(<PolicyEditor />);

    const fee = await screen.findByLabelText("Platform fee");
    await userEvent.clear(fee);
    await userEvent.type(fee, "750");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    // GET is called once at load and once again after the save.
    await waitFor(() => expect(getPolicy).toHaveBeenCalledTimes(2));

    // The new active version's id chip is now visible (appears in the header
    // chip AND the history-table row).
    expect((await screen.findAllByText("pol-4")).length).toBeGreaterThan(0);
    // The history table renders the new revision plus prior ones.
    const table = screen.getByRole("table", { name: /policy version history/i });
    expect(within(table).getByText("pol-4")).toBeInTheDocument();
    expect(within(table).getByText("pol-3")).toBeInTheDocument();
    expect(within(table).getByText("pol-2")).toBeInTheDocument();
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
