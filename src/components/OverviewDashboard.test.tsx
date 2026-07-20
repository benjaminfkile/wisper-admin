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

// Real /v1/admin/overview shape, live-verified 2026-07-20.
const OVERVIEW: AdminOverview = {
  currency: "usd",
  revenue_cents: 1234567,
  wallet_liability_cents: 45600,
  host_earnings_cents: 9900,
  active_lease_count: 12,
  host_count: 8,
  online_host_count: 5,
  user_count: 40,
  health: "ok",
};

describe("OverviewDashboard", () => {
  beforeEach(() => getOverview.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("renders the platform stat tiles from the overview", async () => {
    getOverview.mockResolvedValue(OVERVIEW);
    render(<OverviewDashboard />);

    expect(await screen.findByText("$12,345.67")).toBeInTheDocument(); // revenue
    expect(screen.getByText("$456.00")).toBeInTheDocument(); // wallet liability
    expect(screen.getByText("$99.00")).toBeInTheDocument(); // host earnings
    expect(screen.getByText("12")).toBeInTheDocument(); // active leases
    expect(screen.getByText("8")).toBeInTheDocument(); // hosts
    expect(screen.getByText("5 online")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument(); // consumers
    expect(screen.getByText("Health: ok")).toBeInTheDocument();
  });

  it("renders dashes instead of crashing when numeric fields are missing", async () => {
    // Contract drift: a partial body must not throw (the original crash bug).
    getOverview.mockResolvedValue({ currency: "usd" } as AdminOverview);
    render(<OverviewDashboard />);

    expect(await screen.findByText("Active leases")).toBeInTheDocument();
    // Every numeric tile falls back to an em-dash rather than "$NaN"/"NaN".
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
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
