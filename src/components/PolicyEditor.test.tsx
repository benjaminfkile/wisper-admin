import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PolicyEditor from "./PolicyEditor";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { AdminPolicy } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { getPolicy: vi.fn(), updatePolicy: vi.fn() },
}));

const getPolicy = vi.mocked(admin.getPolicy);
const updatePolicy = vi.mocked(admin.updatePolicy);

const POLICY: AdminPolicy = {
  platform_fee_bps: 500,
  min_price_per_hour: 100,
  max_price_per_hour: 5000,
  min_topup: 1000,
  default_network: "egress",
  max_active_leases_per_user: 4,
  host_signups_enabled: true,
  version: 3,
  updated_at: "2026-07-10T12:00:00Z",
  updated_by: "admin@wisper.dev",
  history: [
    {
      version: 2,
      platform_fee_bps: 400,
      min_price_per_hour: 100,
      max_price_per_hour: 4000,
      min_topup: 1000,
      default_network: "egress",
      max_active_leases_per_user: 3,
      host_signups_enabled: true,
      updated_at: "2026-06-01T12:00:00Z",
      updated_by: "founder@wisper.dev",
    },
  ],
};

describe("PolicyEditor", () => {
  beforeEach(() => {
    getPolicy.mockReset();
    updatePolicy.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("loads the policy into the form and shows version history", async () => {
    getPolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    expect(await screen.findByLabelText("Platform fee")).toHaveValue(500);
    expect(screen.getByLabelText("Minimum top-up")).toHaveValue(1000);
    expect(screen.getByText("v3")).toBeInTheDocument();

    // Version history table renders the prior revision.
    const table = screen.getByRole("table", { name: /policy version history/i });
    expect(within(table).getByText("v2")).toBeInTheDocument();
    expect(within(table).getByText("founder@wisper.dev", { exact: false })).toBeInTheDocument();
  });

  it("saves edits via updatePolicy and confirms success", async () => {
    getPolicy.mockResolvedValue(POLICY);
    updatePolicy.mockResolvedValue({ ...POLICY, version: 4, min_topup: 2000 });
    render(<PolicyEditor />);

    const topup = await screen.findByLabelText("Minimum top-up");
    await userEvent.clear(topup);
    await userEvent.type(topup, "2000");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledTimes(1));
    expect(updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ min_topup: 2000, platform_fee_bps: 500 }),
    );
    expect(await screen.findByText("Policy saved.")).toBeInTheDocument();
  });

  it("blocks saving when the minimum price exceeds the maximum", async () => {
    getPolicy.mockResolvedValue(POLICY);
    render(<PolicyEditor />);

    const min = await screen.findByLabelText("Minimum price per hour");
    await userEvent.clear(min);
    await userEvent.type(min, "9999");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText(/Minimum price cannot exceed the maximum price/i),
    ).toBeInTheDocument();
    expect(updatePolicy).not.toHaveBeenCalled();
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
