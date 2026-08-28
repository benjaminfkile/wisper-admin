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

/** The real API shape after admin.getLedgerAccount flattens
 *  `{ account, entries }`: account fields promoted to top level, entries
 *  carry double-entry debit/credit + a transaction / lease reference. */
const ACCOUNT: LedgerAccount = {
  id: "acct-7",
  kind: "host_earnings",
  owner_user_id: "u-9",
  balance_cents: 300000,
  currency: "USD",
  entries: [
    {
      credit_cents: 100000,
      transaction_id: "txn-1",
      lease_id: "lease-42",
      created_at: "2026-07-12T00:00:00Z",
    },
    {
      debit_cents: 5000,
      transaction_id: "txn-2",
      created_at: "2026-07-11T00:00:00Z",
    },
  ],
};

describe("LedgerAccountView", () => {
  beforeEach(() => getLedgerAccount.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("looks up an account and shows balance, owner (kind + user), and debit/credit entries", async () => {
    getLedgerAccount.mockResolvedValue(ACCOUNT);
    render(<LedgerAccountView />);

    await userEvent.type(screen.getByLabelText("Ledger account id"), "acct-7");
    await userEvent.click(screen.getByRole("button", { name: /look up/i }));

    await waitFor(() => expect(getLedgerAccount).toHaveBeenCalledWith("acct-7"));
    // Balance tile shows the account's current balance_cents (also appears in
    // the running-balance column of the newest row, hence findAllByText).
    expect((await screen.findAllByText("$3,000.00")).length).toBeGreaterThan(0);
    // Owner surfaces owner_user_id + a kind chip.
    expect(screen.getByText("u-9")).toBeInTheDocument();
    expect(screen.getByText("host_earnings")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: /ledger entries/i });
    // Credit column shows the $1,000.00 credit; debit column shows the $50 debit.
    expect(within(table).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(table).getByText("$50.00")).toBeInTheDocument();
    // Transaction + lease references render.
    expect(within(table).getByText("txn-1")).toBeInTheDocument();
    expect(within(table).getByText(/lease-42/)).toBeInTheDocument();
    expect(within(table).getByText("txn-2")).toBeInTheDocument();
  });

  it("computes a running balance client-side, anchored at the current balance", async () => {
    getLedgerAccount.mockResolvedValue(ACCOUNT);
    render(<LedgerAccountView />);

    await userEvent.type(screen.getByLabelText("Ledger account id"), "acct-7");
    await userEvent.click(screen.getByRole("button", { name: /look up/i }));

    const table = await screen.findByRole("table", { name: /ledger entries/i });
    // Newest entry (txn-1, credit 1000): balance-after = current 3000.
    // Older entry (txn-2, debit 50): balance-after = 3000 - (0 - 1000) = 2000.
    const balances = within(table).getAllByText(/^\$[\d,]+\.\d{2}$/);
    // Balance-after cells appear in the last column; both current-balance
    // ($3,000.00) and the older row's balance ($2,000.00) should be present.
    const shown = balances.map((n) => n.textContent);
    expect(shown).toContain("$3,000.00");
    expect(shown).toContain("$2,000.00");
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
