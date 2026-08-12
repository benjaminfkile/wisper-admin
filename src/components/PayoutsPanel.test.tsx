import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayoutsPanel from "./PayoutsPanel";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { LedgerMutationResult } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { createRefund: vi.fn(), createAdjustment: vi.fn() },
}));

const createRefund = vi.mocked(admin.createRefund);
const createAdjustment = vi.mocked(admin.createAdjustment);

const RESULT: LedgerMutationResult = {
  transaction_id: "txn-1",
  amount_cents: 1250,
  debit_account_id: "platform",
  credit_account_id: "acct-1",
  debit_balance_cents: -1250,
  credit_balance_cents: 1250,
};

describe("PayoutsPanel", () => {
  beforeEach(() => {
    createRefund.mockReset();
    createAdjustment.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("issues a refund, converting dollars to minor units with an idempotency key", async () => {
    createRefund.mockResolvedValue(RESULT);
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
    // ResultNote reads transaction_id and amount_cents from AdjustmentResponse.
    expect(await screen.findByText(/txn-1/)).toBeInTheDocument();
  });

  it("reuses the same idempotency key when a refund retries after failure", async () => {
    createRefund.mockRejectedValueOnce(new WisperError(500, "internal", "boom"));
    createRefund.mockResolvedValueOnce(RESULT);
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

  it("posts a double-entry debit adjustment and previews the balanced entry", async () => {
    createAdjustment.mockResolvedValue({
      ...RESULT,
      debit_account_id: "acct-9",
      credit_account_id: "platform",
    });
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Adjustment account id"), "acct-9");
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "3");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "correction");

    // Switch to a debit; the balanced preview should show the account leg negative.
    await userEvent.click(screen.getByRole("button", { name: /debit/i }));
    const preview = screen.getByRole("table", { name: /balanced entry preview/i });
    expect(within(preview).getByText("−$3.00")).toBeInTheDocument();
    expect(within(preview).getByText("+$3.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    await waitFor(() => expect(createAdjustment).toHaveBeenCalledTimes(1));
    const [body, key] = createAdjustment.mock.calls[0];
    // Real AdjustmentRequest: double-entry with debit/credit accounts + positive amount_cents.
    // Debiting acct-9 means: debit_account_id=acct-9, credit_account_id=platform.
    expect(body).toMatchObject({
      debit_account_id: "acct-9",
      credit_account_id: "platform",
      amount_cents: 300,
      reason: "correction",
    });
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("account_id");
    expect(typeof key).toBe("string");
  });

  it("posts a double-entry credit adjustment with platform as the debit leg", async () => {
    createAdjustment.mockResolvedValue(RESULT);
    render(<PayoutsPanel />);

    await userEvent.type(screen.getByLabelText("Adjustment account id"), "acct-9");
    await userEvent.type(screen.getByLabelText("Adjustment amount"), "5");
    await userEvent.type(screen.getByLabelText("Adjustment reason"), "goodwill credit");
    // Default direction is credit — no toggle needed.

    await userEvent.click(screen.getByRole("button", { name: /post adjustment/i }));

    await waitFor(() => expect(createAdjustment).toHaveBeenCalledTimes(1));
    const [body] = createAdjustment.mock.calls[0];
    // Crediting acct-9 means: debit_account_id=platform, credit_account_id=acct-9.
    expect(body).toMatchObject({
      debit_account_id: "platform",
      credit_account_id: "acct-9",
      amount_cents: 500,
      reason: "goodwill credit",
    });
  });

  it("keeps the submit button disabled until required fields are valid", async () => {
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
