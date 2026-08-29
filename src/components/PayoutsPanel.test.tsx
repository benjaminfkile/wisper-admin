import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayoutsPanel from "./PayoutsPanel";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { LedgerMutationResult, RefundResponse } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { createRefund: vi.fn(), createAdjustment: vi.fn() },
}));

const createRefund = vi.mocked(admin.createRefund);
const createAdjustment = vi.mocked(admin.createAdjustment);

// Two real ledger-account UUIDs used by the adjustment tests. The API requires
// both legs to be existing, distinct account ids.
const DEBIT_ACCT = "11111111-1111-1111-1111-111111111111";
const CREDIT_ACCT = "22222222-2222-2222-2222-222222222222";

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

describe("PayoutsPanel", () => {
  beforeEach(() => {
    createRefund.mockReset();
    createAdjustment.mockReset();
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
      screen.getByText(/debit and credit accounts must be different/i),
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

  it("surfaces the API's validation_error message and field details", async () => {
    createAdjustment.mockRejectedValueOnce(
      new WisperError(422, "validation_error", "Request failed validation.", [
        { field: "debit_account_id", message: "account not found" },
        { field: "amount_cents", message: "must be positive" },
      ]),
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
      screen.getByText(/debit_account_id: account not found/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/amount_cents: must be positive/),
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
