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
  },
}));

const createRefund = vi.mocked(admin.createRefund);
const createAdjustment = vi.mocked(admin.createAdjustment);
const getLedgerAccount = vi.mocked(admin.getLedgerAccount);

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
// adjustment response: the refund envelope carries the refund's own fields
// (refund_id / user_id / amount / status / optional payment_intent) and has
// no transaction_id, debit_account_id, or credit_account_id.
const REFUND: RefundResponse = {
  refund_id: "rfnd_1",
  user_id: "u-1",
  amount_cents: 1250,
  currency: "USD",
  status: "succeeded",
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
    // amount, status, and the user id. It does NOT print ledger fields the
    // API does not return on this envelope (transaction_id / debit_account_id
    // / credit_account_id).
    const note = (await screen.findByText(/rfnd_1/)).closest(
      "[role='alert']",
    ) as HTMLElement;
    expect(note).not.toBeNull();
    expect(within(note).getByText(/succeeded/)).toBeInTheDocument();
    expect(within(note).getByText(/\$12\.50/)).toBeInTheDocument();
    expect(within(note).getByText(/u-1/)).toBeInTheDocument();
    // Nothing on the note describes a double-entry transaction.
    expect(within(note).queryByText(/txn-/)).not.toBeInTheDocument();
    expect(within(note).queryByText(/debit/i)).not.toBeInTheDocument();
    expect(within(note).queryByText(/credit/i)).not.toBeInTheDocument();
  });

  it("shows the payment intent on the refund success note when provided", async () => {
    createRefund.mockResolvedValue({
      ...REFUND,
      payment_intent: "pi_abc123",
    });
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Refund consumer id"), "u-1");
    await userEvent.type(screen.getByLabelText("Refund payment intent id"), "pi_abc123");
    await userEvent.type(screen.getByLabelText("Refund amount"), "12.50");
    await userEvent.type(screen.getByLabelText("Refund reason"), "service outage");
    await userEvent.click(screen.getByRole("button", { name: /issue refund/i }));

    expect(await screen.findByText(/pi_abc123/)).toBeInTheDocument();
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
