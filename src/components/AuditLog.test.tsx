import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuditLog from "./AuditLog";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import type { AuditEntry, AuditList } from "@/lib/wisper/types";

vi.mock("@/lib/wisper/admin", () => ({
  admin: { getAudit: vi.fn() },
}));

const getAudit = vi.mocked(admin.getAudit);

const ENTRIES: AuditEntry[] = [
  {
    id: "e-1",
    actor: "admin@wisper.dev",
    action: "host.suspend",
    target_type: "host",
    target_id: "h-2",
    metadata: { reason: "fraud" },
    created_at: "2026-07-12T00:00:00Z",
  },
  {
    id: "e-2",
    actor: "founder@wisper.dev",
    action: "policy.update",
    target_type: "policy",
    target_id: "v4",
    created_at: "2026-07-11T00:00:00Z",
  },
];

describe("AuditLog", () => {
  beforeEach(() => {
    getAudit.mockReset().mockResolvedValue({ data: ENTRIES });
  });
  afterEach(() => vi.clearAllMocks());

  it("renders audit entries with their metadata", async () => {
    render(<AuditLog />);

    expect(await screen.findByText("host.suspend")).toBeInTheDocument();
    expect(screen.getByText("policy.update")).toBeInTheDocument();
    expect(screen.getByText(/reason: fraud/)).toBeInTheDocument();
    expect(getAudit).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("applies filters and requeries", async () => {
    render(<AuditLog />);
    await screen.findByText("host.suspend");

    await userEvent.type(screen.getByLabelText("Filter by actor"), "admin@wisper.dev");
    await userEvent.type(screen.getByLabelText("Filter by action"), "host.suspend");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() =>
      expect(getAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actor: "admin@wisper.dev",
          action: "host.suspend",
          limit: 50,
        }),
      ),
    );
  });

  it("pages through results with the cursor", async () => {
    const first: AuditList = { data: [ENTRIES[0]], next_cursor: "cursor-2" };
    const second: AuditList = { data: [ENTRIES[1]] };
    getAudit.mockReset();
    getAudit.mockResolvedValueOnce(first);
    getAudit.mockResolvedValueOnce(second);
    render(<AuditLog />);

    expect(await screen.findByText("host.suspend")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText("policy.update")).toBeInTheDocument();
    expect(getAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-2" }),
    );
    expect(screen.getByText("End of results.")).toBeInTheDocument();
  });

  it("shows an empty state when there are no entries", async () => {
    getAudit.mockReset().mockResolvedValue({ data: [] });
    render(<AuditLog />);
    expect(
      await screen.findByText(/No audit entries match these filters/),
    ).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    getAudit.mockReset().mockRejectedValue(new WisperError(500, "internal", "audit down"));
    render(<AuditLog />);
    expect(await screen.findByText("audit down")).toBeInTheDocument();
  });
});
