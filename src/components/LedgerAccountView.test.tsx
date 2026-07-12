import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LedgerAccountView from "./LedgerAccountView";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { LedgerAccount } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { getLedgerAccount: vi.fn() },
}));

const getLedgerAccount = vi.mocked(admin.getLedgerAccount);

const ACCOUNT: LedgerAccount = {
  id: "acct-7",
  owner_type: "host",
  owner_id: "h-1",
  balance: 300000,
  currency: "USD",
  entries: [
    {
      id: "le-1",
      amount: 100000,
      balance_after: 250000,
      kind: "payout",
      reference: "lease-42",
      created_at: "2026-07-12T00:00:00Z",
    },
    {
      id: "le-2",
      amount: -5000,
      balance_after: 150000,
      kind: "adjustment",
      created_at: "2026-07-11T00:00:00Z",
    },
  ],
};

describe("LedgerAccountView", () => {
  beforeEach(() => getLedgerAccount.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("looks up an account and shows balance, owner, and entries", async () => {
    getLedgerAccount.mockResolvedValue(ACCOUNT);
    render(<LedgerAccountView />);

    await userEvent.type(screen.getByLabelText("Ledger account id"), "acct-7");
    await userEvent.click(screen.getByRole("button", { name: /look up/i }));

    await waitFor(() => expect(getLedgerAccount).toHaveBeenCalledWith("acct-7"));
    expect(await screen.findByText("$3,000.00")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: /ledger entries/i });
    expect(within(table).getByText("+$1,000.00")).toBeInTheDocument();
    expect(within(table).getByText("−$50.00")).toBeInTheDocument();
    expect(within(table).getByText("lease-42")).toBeInTheDocument();
  });

  it("does not query until an id is entered", async () => {
    render(<LedgerAccountView />);
    expect(screen.getByRole("button", { name: /look up/i })).toBeDisabled();
    expect(getLedgerAccount).not.toHaveBeenCalled();
  });

  it("surfaces a not-found error", async () => {
    getLedgerAccount.mockRejectedValueOnce(
      new WisperError(404, "not_found", "no such account"),
    );
    render(<LedgerAccountView />);

    await userEvent.type(screen.getByLabelText("Ledger account id"), "nope");
    await userEvent.click(screen.getByRole("button", { name: /look up/i }));

    expect(await screen.findByText("no such account")).toBeInTheDocument();
  });
});
