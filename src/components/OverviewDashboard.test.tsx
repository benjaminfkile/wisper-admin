import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OverviewDashboard from "./OverviewDashboard";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { AdminOverview } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { getOverview: vi.fn() },
}));

const getOverview = vi.mocked(admin.getOverview);

const OVERVIEW: AdminOverview = {
  revenue_total: 1234567,
  revenue_30d: 45600,
  active_leases: 12,
  hosts_total: 8,
  hosts_suspended: 2,
  users_total: 40,
  users_suspended: 0,
  pending_payouts: 9900,
  generated_at: "2026-07-12T00:00:00Z",
};

describe("OverviewDashboard", () => {
  beforeEach(() => getOverview.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("renders the platform stat tiles from the overview", async () => {
    getOverview.mockResolvedValue(OVERVIEW);
    render(<OverviewDashboard />);

    expect(await screen.findByText("$12,345.67")).toBeInTheDocument();
    expect(screen.getByText("$456.00 in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // active leases
    expect(screen.getByText("$99.00")).toBeInTheDocument(); // pending payouts
    // Suspended hosts surface a warning chip; all-active consumers a success chip.
    expect(screen.getByText("2 of 8 suspended")).toBeInTheDocument();
    expect(screen.getByText("All active")).toBeInTheDocument();
    expect(screen.getByText(/Snapshot generated/)).toBeInTheDocument();
  });

  it("shows an error with a retry that refetches", async () => {
    getOverview.mockRejectedValueOnce(
      new WisperError(500, "internal", "overview exploded"),
    );
    getOverview.mockResolvedValueOnce(OVERVIEW);
    render(<OverviewDashboard />);

    expect(await screen.findByText("overview exploded")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("$12,345.67")).toBeInTheDocument();
    expect(getOverview).toHaveBeenCalledTimes(2);
  });

  it("refetches when Refresh is clicked", async () => {
    getOverview.mockResolvedValue(OVERVIEW);
    render(<OverviewDashboard />);
    await screen.findByText("$12,345.67");

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
  });
});
