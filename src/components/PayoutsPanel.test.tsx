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
  id: "entry-1",
  account_id: "acct-1",
  amount: 1250,
  reason: "outage",
  created_at: "2026-07-12T00:00:00Z",
  created_by: "admin@wisper.dev",
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
    expect(body).toMatchObject({ user_id: "u-1", amount: 1250, reason: "service outage" });
    expect(typeof key).toBe("string");
    expect((key as string).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Posted/)).toBeInTheDocument();
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

  it("posts a signed debit adjustment and previews the balanced entry", async () => {
    createAdjustment.mockResolvedValue({ ...RESULT, amount: -300 });
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
    expect(body).toMatchObject({ account_id: "acct-9", amount: -300, reason: "correction" });
    expect(typeof key).toBe("string");
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
