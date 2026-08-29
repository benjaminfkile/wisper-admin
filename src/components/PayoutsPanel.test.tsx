import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayoutsPanel from "./PayoutsPanel";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type {
  LedgerAccount,
  LedgerMutationResult,
  RefundResponse,
} from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: {
    createRefund: vi.fn(),
    createAdjustment: vi.fn(),
    getLedgerAccount: vi.fn(),
    listLedgerAccounts: vi.fn(),
    listUsers: vi.fn(),
  },
}));

const createRefund = vi.mocked(admin.createRefund);
const createAdjustment = vi.mocked(admin.createAdjustment);
const getLedgerAccount = vi.mocked(admin.getLedgerAccount);
const listLedgerAccounts = vi.mocked(admin.listLedgerAccounts);
const listUsers = vi.mocked(admin.listUsers);

// Two real ledger-account UUIDs used by the adjustment tests. The API requires
// both legs to be existing, distinct account ids that parse as UUIDs.
const DEBIT_ACCT = "11111111-1111-1111-1111-111111111111";
const CREDIT_ACCT = "22222222-2222-2222-2222-222222222222";

const DEBIT_LOOKUP: LedgerAccount = {
  id: DEBIT_ACCT,
  kind: "platform_revenue",
  balance_cents: 1000000,
  currency: "USD",
  entries: [],
};
const CREDIT_LOOKUP: LedgerAccount = {
  id: CREDIT_ACCT,
  kind: "user_wallet",
  owner_user_id: "u-42",
  balance_cents: 4200,
  currency: "USD",
  entries: [],
};

// AdjustmentResponse (used for the ledger-adjustment tests).
const RESULT: LedgerMutationResult = {
  transaction_id: "txn-1",
  amount_cents: 1250,
  debit_account_id: DEBIT_ACCT,
  credit_account_id: CREDIT_ACCT,
  debit_balance_cents: -1250,
  credit_balance_cents: 1250,
};

// RefundResponse (used for the refund tests). Distinct from the ledger
// adjustment response: the refund envelope is exactly { refund_id,
// amount_cents, currency, balance_cents }: the refund id, the amount that
// came off the wallet, the currency, and the wallet's new balance after the
// refund. It has no user_id, status, payment_intent, transaction_id,
// debit_account_id, or credit_account_id.
const REFUND: RefundResponse = {
  refund_id: "rfnd_1",
  amount_cents: 1250,
  currency: "USD",
  balance_cents: 3750,
};

/** Wire the account-preview mock so each UUID resolves to its fixture; other
 *  ids reject with 404 so the "no such account" branch renders. */
function stubAccountLookups() {
  getLedgerAccount.mockImplementation(async (id: string) => {
    if (id === DEBIT_ACCT) return DEBIT_LOOKUP;
    if (id === CREDIT_ACCT) return CREDIT_LOOKUP;
    throw new WisperError(404, "not_found", "no such account");
  });
}

describe("PayoutsPanel", () => {
  beforeEach(() => {
    createRefund.mockReset();
    createAdjustment.mockReset();
    getLedgerAccount.mockReset();
    listLedgerAccounts.mockReset();
    listUsers.mockReset();
    stubAccountLookups();
  });
  afterEach(() => vi.clearAllMocks());

  it("issues a refund, converting dollars to minor units with an idempotency key", async () => {
    createRefund.mockResolvedValue(REFUND);
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund amount"), "12.50");
    await userEvent.type(screen.getByLabelText("Refund reason"), "service outage");
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    await waitFor(() => expect(createRefund).toHaveBeenCalledTimes(1));
    const [body, key] = createRefund.mock.calls[0];
    // Real AdminRefundRequest: user_id + amount_cents + reason; no lease_id.
    expect(body).toMatchObject({ user_id: "u-1", amount_cents: 1250, reason: "service outage" });
    expect(body).not.toHaveProperty("lease_id");
    expect(typeof key).toBe("string");
    expect((key as string).length).toBeGreaterThan(0);
    // The success note reads the RefundResponse's actual fields: refund_id,
    // amount_cents, currency, balance_cents. It renders the refund id, the
    // amount refunded, and the wallet's remaining balance, and nothing else
    // (no user id, status, payment intent, or ledger-transaction field).
    const note = (await screen.findByText(/rfnd_1/)).closest(
      "[role='alert']",
    ) as HTMLElement;
    expect(note).not.toBeNull();
    expect(within(note).getByText(/\$12\.50/)).toBeInTheDocument();
    expect(within(note).getByText(/remaining wallet balance/i)).toBeInTheDocument();
    expect(within(note).getByText(/\$37\.50/)).toBeInTheDocument();
    // Nothing on the note describes fields the RefundResponse does not carry.
    expect(within(note).queryByText(/u-1/)).not.toBeInTheDocument();
    expect(within(note).queryByText(/succeeded/i)).not.toBeInTheDocument();
    expect(within(note).queryByText(/payment intent/i)).not.toBeInTheDocument();
    expect(within(note).queryByText(/txn-/)).not.toBeInTheDocument();
    expect(within(note).queryByText(/debit/i)).not.toBeInTheDocument();
    expect(within(note).queryByText(/credit/i)).not.toBeInTheDocument();
  });

  it("formats the refund note in the currency the server returned (currency-aware)", async () => {
    createRefund.mockResolvedValue({
      refund_id: "rfnd_eur",
      amount_cents: 500,
      currency: "EUR",
      balance_cents: 1500,
    });
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund amount"), "5");
    await userEvent.type(screen.getByLabelText("Refund reason"), "goodwill");
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    const note = (await screen.findByText(/rfnd_eur/)).closest(
      "[role='alert']",
    ) as HTMLElement;
    expect(note).not.toBeNull();
    // Intl.NumberFormat en-US formats EUR as "€5.00" / "€15.00".
    expect(within(note).getByText(/€5\.00/)).toBeInTheDocument();
    expect(within(note).getByText(/€15\.00/)).toBeInTheDocument();
  });

  it("sends the payment intent to the API when the operator provides one", async () => {
    createRefund.mockResolvedValue(REFUND);
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund payment intent id"), "pi_abc123");
    await userEvent.type(screen.getByLabelText("Refund amount"), "12.50");
    await userEvent.type(screen.getByLabelText("Refund reason"), "service outage");
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    await waitFor(() => expect(createRefund).toHaveBeenCalledTimes(1));
    const [body] = createRefund.mock.calls[0];
    expect(body.payment_intent).toBe("pi_abc123");
  });

  it("reuses the same idempotency key when a refund retries after failure", async () => {
    createRefund.mockRejectedValueOnce(new WisperError(500, "internal", "boom"));
    createRefund.mockResolvedValueOnce(REFUND);
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund amount"), "5");
    await userEvent.type(screen.getByLabelText("Refund reason"), "goodwill");
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    await waitFor(() => expect(createRefund).toHaveBeenCalledTimes(2));
    const firstKey = createRefund.mock.calls[0][1];
    const secondKey = createRefund.mock.calls[1][1];
    expect(secondKey).toBe(firstKey);
  });

  it("posts a double-entry adjustment with the two operator-supplied account ids", async () => {
    createAdjustment.mockResolvedValue({
      ...RESULT,
      amount_cents: 300,
    });
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "3");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "correction");

    // Balanced preview mirrors what will be posted: the credit leg gains the
    // amount and the debit leg loses it, netting to zero.
    const preview = screen.getByRole("table", { name: /balanced entry preview/i });
    expect(within(preview).getByText("−$3.00")).toBeInTheDocument();
    expect(within(preview).getByText("+$3.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    await waitFor(() => expect(createAdjustment).toHaveBeenCalledTimes(1));
    const [body, key] = createAdjustment.mock.calls[0];
    // Real AdjustmentRequest: two real ledger-account UUIDs + positive amount_cents.
    // The literal string "platform" is no longer sent for either leg.
    expect(body).toMatchObject({
      debit_account_id: DEBIT_ACCT,
      credit_account_id: CREDIT_ACCT,
      amount_cents: 300,
      reason: "correction",
    });
    expect(body.debit_account_id).not.toBe("platform");
    expect(body.credit_account_id).not.toBe("platform");
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("account_id");
    expect(typeof key).toBe("string");
  });

  it("blocks submission and flags the field when both accounts are the same", async () => {
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "1");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "typo");

    expect(
      screen.getAllByText(/debit and credit accounts must be different/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /post adjustment/i })).toBeDisabled();
    expect(createAdjustment).not.toHaveBeenCalled();
  });

  it("blocks submission and flags the field when an account id is not a UUID", async () => {
    // Prior behavior forwarded whatever was typed and the operator got the
    // misleading "The request body is not valid JSON." from the API. The form
    // now enforces the UUID shape client-side.
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      "not-a-uuid",
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "1");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "typo");

    expect(
      screen.getByText(/enter a ledger-account uuid/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /post adjustment/i })).toBeDisabled();
    expect(createAdjustment).not.toHaveBeenCalled();
  });

  it("keeps the adjustment submit disabled until both accounts, amount, and reason are set", async () => {
    render(<PayoutsPanel />);
    const submit = screen.getByRole("button", { name: /post adjustment/i });
    expect(submit).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "1");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "note");
    // Still disabled without a credit account.
    expect(submit).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );
    expect(submit).toBeEnabled();
  });

  it("previews kind, owner, and balance for each typed account (debounced UUID lookup)", async () => {
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );

    // Debit leg preview: platform kind + balance, no owner.
    const debitPreview = await screen.findByRole("status", {
      name: /debit account preview/i,
    });
    expect(within(debitPreview).getByText("platform_revenue")).toBeInTheDocument();
    expect(within(debitPreview).getByText(/platform account/i)).toBeInTheDocument();
    expect(within(debitPreview).getByText(/\$10,000\.00/)).toBeInTheDocument();

    // Credit leg preview: user_wallet kind + owner + balance.
    const creditPreview = await screen.findByRole("status", {
      name: /credit account preview/i,
    });
    expect(within(creditPreview).getByText("user_wallet")).toBeInTheDocument();
    expect(within(creditPreview).getByText(/owner u-42/)).toBeInTheDocument();
    expect(within(creditPreview).getByText(/\$42\.00/)).toBeInTheDocument();

    expect(getLedgerAccount).toHaveBeenCalledWith(DEBIT_ACCT);
    expect(getLedgerAccount).toHaveBeenCalledWith(CREDIT_ACCT);
  });

  it("shows 'no such account' inline when the previewed account 404s", async () => {
    render(<PayoutsPanel />);

    // Well-formed UUID that has no matching account. The lookup returns 404
    // and the operator sees it inline before submitting.
    const MISSING_UUID = "33333333-3333-3333-3333-333333333333";
    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      MISSING_UUID,
    );

    expect(
      await screen.findByText(/debit account: no such account/i),
    ).toBeInTheDocument();
  });

  it("does not fire the preview lookup for a non-UUID debit id", async () => {
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      "not-a-uuid",
    );
    // Wait past the debounce and let any queued microtasks settle. The
    // useEffect gates the fetch on isUuid(), so `getLedgerAccount` must
    // never be called for a non-UUID input.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(getLedgerAccount).not.toHaveBeenCalled();
  });

  it("surfaces the API's validation_error message and the flat { field } details", async () => {
    // The real wisper-api validation_error today sends `details` as a flat
    // object like `{ field: "credit_account_id" }` (a single-field marker
    // with no per-field message). Cover that real shape.
    createAdjustment.mockRejectedValueOnce(
      new WisperError(422, "validation_error", "Request failed validation.", {
        field: "credit_account_id",
      }),
    );
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "2");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "oops");
    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    expect(
      await screen.findByText("Request failed validation."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/field: credit_account_id/),
    ).toBeInTheDocument();
  });

  it("reuses the adjustment idempotency key when a retry follows a failure", async () => {
    createAdjustment.mockRejectedValueOnce(new WisperError(500, "internal", "boom"));
    createAdjustment.mockResolvedValueOnce(RESULT);
    render(<PayoutsPanel />);

    await userEvent.type(
      screen.getByLabelText("Adjustment debit account id"),
      DEBIT_ACCT,
    );
    await userEvent.type(
      screen.getByLabelText("Adjustment credit account id"),
      CREDIT_ACCT,
    );
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "5");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "retry");
    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    await waitFor(() => expect(createAdjustment).toHaveBeenCalledTimes(2));
    const firstKey = createAdjustment.mock.calls[0][1];
    const secondKey = createAdjustment.mock.calls[1][1];
    expect(secondKey).toBe(firstKey);
  });

  it("picks a platform account from the picker and fills the debit id (no owner filter required)", async () => {
    // Platform-scoped kinds (platform_revenue, platform_cash, stripe_fees) do
    // not require an owner filter: the picker fires listLedgerAccounts as soon
    // as a kind is chosen and the selected id fills the debit leg.
    const PLATFORM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    listLedgerAccounts.mockResolvedValueOnce({
      data: [
        {
          id: PLATFORM_ID,
          kind: "platform_revenue",
          currency: "USD",
          balance_cents: 1000000,
        },
      ],
      next_offset: null,
    });
    render(<PayoutsPanel />);

    await userEvent.click(
      screen.getByRole("button", { name: /pick debit account/i }),
    );

    const dialog = await screen.findByRole("dialog");
    // MUI's <TextField select> renders as a listbox opener; pick the option
    // by clicking the button then the surfaced option.
    await userEvent.click(within(dialog).getByLabelText(/picker account kind/i));
    await userEvent.click(
      await screen.findByRole("option", { name: "platform_revenue" }),
    );

    await waitFor(() =>
      expect(listLedgerAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "platform_revenue", limit: 25, offset: 0 }),
      ),
    );
    // No owner filter fires for a platform-scoped kind.
    const [call] = listLedgerAccounts.mock.calls;
    expect(call[0].owner_user_id).toBeUndefined();

    // Row appears; hit Use → picker closes and the debit field fills.
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: `Use account ${PLATFORM_ID}`,
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      (screen.getByLabelText("Adjustment debit account id") as HTMLInputElement)
        .value,
    ).toBe(PLATFORM_ID);
  });

  it("picks a user wallet by owner email and fills the credit id", async () => {
    // user_wallet is owner-scoped: the operator types an owner (email or user
    // id); the picker resolves the email via listUsers and then queries
    // listLedgerAccounts with kind=user_wallet + owner_user_id.
    const OWNER_ID = "u-42";
    const WALLET_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    listUsers.mockResolvedValueOnce({
      data: [{ id: OWNER_ID, email: "dana@example.com", status: "active" }],
      next_offset: null,
    });
    listLedgerAccounts.mockResolvedValueOnce({
      data: [
        {
          id: WALLET_ID,
          kind: "user_wallet",
          owner_user_id: OWNER_ID,
          owner_email: "dana@example.com",
          currency: "USD",
          balance_cents: 4200,
        },
      ],
      next_offset: null,
    });
    render(<PayoutsPanel />);

    await userEvent.click(
      screen.getByRole("button", { name: /pick credit account/i }),
    );

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText(/picker account kind/i));
    await userEvent.click(
      await screen.findByRole("option", { name: "user_wallet" }),
    );

    // Owner filter now appears for the owner-scoped kind.
    const ownerField = await within(dialog).findByLabelText(
      /picker owner email or user id/i,
    );
    await userEvent.type(ownerField, "dana@example.com");

    // The email resolves to the owner id via listUsers.
    await waitFor(() =>
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ query: "dana@example.com" }),
      ),
    );

    // The accounts query fires with the resolved owner id.
    await waitFor(() =>
      expect(listLedgerAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "user_wallet",
          owner_user_id: OWNER_ID,
        }),
      ),
    );

    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: `Use account ${WALLET_ID}`,
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      (screen.getByLabelText("Adjustment credit account id") as HTMLInputElement)
        .value,
    ).toBe(WALLET_ID);
  });

  it("keeps the refund submit button disabled until required fields are valid", async () => {
    render(<PayoutsPanel />);
    const submit = screen.getByRole("button", { name: /issue refund/i });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund reason"), "x");
    // Still disabled without a valid amount.
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Refund amount"), "10");
    expect(submit).toBeEnabled();
  });
});
