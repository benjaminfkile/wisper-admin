"use client";

import { useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatMoney, parseMoneyToMinor } from "@/lib/format";
import type { LedgerMutationResult } from "@/lib/wisper/types";

/** Refunds and manual ledger adjustments. Both are money-moving POSTs guarded by
 *  an Idempotency-Key that survives retries of a single submission. */
export default function PayoutsPanel() {
  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Payouts &amp; adjustments
        </Typography>
        <Typography color="text.secondary">
          Issue consumer refunds and post manual, balanced ledger adjustments.
          Each submission carries an idempotency key so a retry can&apos;t
          double-post.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <RefundForm />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <AdjustmentForm />
        </Grid>
      </Grid>
    </Box>
  );
}

/** Success confirmation shared by both forms. */
function ResultNote({ result }: { result: LedgerMutationResult }) {
  return (
    <Alert severity="success" sx={{ mt: 2 }}>
      Posted <strong>{formatMoney(result.amount)}</strong> to account{" "}
      <code>{result.account_id}</code> (entry <code>{result.id}</code>).
    </Alert>
  );
}

function RefundForm() {
  const [userId, setUserId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LedgerMutationResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Held across retries of the same submission; cleared on success so the next
  // refund gets a fresh key.
  const keyRef = useRef<string | null>(null);

  const minor = useMemo(() => parseMoneyToMinor(amount), [amount]);
  const canSubmit =
    userId.trim() !== "" && reason.trim() !== "" && minor != null && minor > 0;

  const submit = async () => {
    if (!canSubmit || minor == null) return;
    if (keyRef.current == null) keyRef.current = newIdempotencyKey();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await admin.createRefund(
        {
          user_id: userId.trim(),
          lease_id: leaseId.trim() || undefined,
          amount_cents: minor,
          reason: reason.trim(),
        },
        keyRef.current,
      );
      setResult(res);
      keyRef.current = null;
      setUserId("");
      setLeaseId("");
      setAmount("");
      setReason("");
    } catch (err) {
      // Keep keyRef so a retry reuses the same idempotency key.
      setError(err instanceof WisperError ? err.message : "The refund failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Refund a consumer
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Box
          component="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Stack spacing={2}>
            <TextField
              label="Consumer account id"
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              slotProps={{ htmlInput: { "aria-label": "Refund consumer id" } }}
            />
            <TextField
              label="Lease id (optional)"
              value={leaseId}
              onChange={(e) => setLeaseId(e.target.value)}
              helperText="Ties the refund to a specific lease, if applicable."
              slotProps={{ htmlInput: { "aria-label": "Refund lease id" } }}
            />
            <TextField
              label="Amount"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={amount !== "" && (minor == null || minor <= 0)}
              helperText={
                amount === ""
                  ? "Major units, e.g. 12.50"
                  : minor != null && minor > 0
                    ? `Refunds ${formatMoney(minor)}`
                    : "Enter a positive amount with up to two decimals."
              }
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">$</InputAdornment>
                  ),
                },
                htmlInput: { inputMode: "decimal", "aria-label": "Refund amount" },
              }}
            />
            <TextField
              label="Reason"
              required
              multiline
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { "aria-label": "Refund reason" } }}
            />

            {error && <Alert severity="error">{error}</Alert>}
            {result && <ResultNote result={result} />}

            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={busy || !canSubmit}
            >
              {busy ? "Issuing…" : "Issue refund"}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

type Direction = "credit" | "debit";

function AdjustmentForm() {
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<Direction>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LedgerMutationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);

  const magnitude = useMemo(() => parseMoneyToMinor(amount), [amount]);
  // The account leg is signed: credits add, debits subtract.
  const signed =
    magnitude != null ? (direction === "credit" ? magnitude : -magnitude) : null;
  const canSubmit =
    accountId.trim() !== "" &&
    reason.trim() !== "" &&
    magnitude != null &&
    magnitude > 0;

  const submit = async () => {
    if (!canSubmit || signed == null) return;
    if (keyRef.current == null) keyRef.current = newIdempotencyKey();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await admin.createAdjustment(
        { account_id: accountId.trim(), amount: signed, reason: reason.trim() },
        keyRef.current,
      );
      setResult(res);
      keyRef.current = null;
      setAccountId("");
      setAmount("");
      setReason("");
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "The adjustment failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Ledger adjustment
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Box
          component="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Stack spacing={2}>
            <TextField
              label="Ledger account id"
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              slotProps={{ htmlInput: { "aria-label": "Adjustment account id" } }}
            />
            <ToggleButtonGroup
              exclusive
              color="primary"
              value={direction}
              onChange={(_, v: Direction | null) => v && setDirection(v)}
              aria-label="Adjustment direction"
              size="small"
            >
              <ToggleButton value="credit" aria-label="Credit">
                Credit (+)
              </ToggleButton>
              <ToggleButton value="debit" aria-label="Debit">
                Debit (−)
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label="Amount"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={amount !== "" && (magnitude == null || magnitude <= 0)}
              helperText={
                amount === ""
                  ? "Major units, e.g. 12.50"
                  : magnitude != null && magnitude > 0
                    ? "Preview the balanced entry below."
                    : "Enter a positive amount with up to two decimals."
              }
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">$</InputAdornment>
                  ),
                },
                htmlInput: {
                  inputMode: "decimal",
                  "aria-label": "Adjustment amount",
                },
              }}
            />
            <TextField
              label="Reason"
              required
              multiline
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { "aria-label": "Adjustment reason" } }}
            />

            <BalancedPreview
              accountId={accountId.trim()}
              magnitude={magnitude}
              direction={direction}
            />

            {error && <Alert severity="error">{error}</Alert>}
            {result && <ResultNote result={result} />}

            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={busy || !canSubmit}
            >
              {busy ? "Posting…" : "Post adjustment"}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

/** Show both legs of the double-entry so the admin sees it balances to zero:
 *  the target account and the offsetting platform clearing account. */
function BalancedPreview({
  accountId,
  magnitude,
  direction,
}: {
  accountId: string;
  magnitude: number | null;
  direction: Direction;
}) {
  if (magnitude == null || magnitude <= 0) return null;
  const account = direction === "credit" ? magnitude : -magnitude;
  const platform = -account;
  const money = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n))}`;

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        Balanced entry
      </Typography>
      <Table size="small" aria-label="Balanced entry preview">
        <TableBody>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5 }}>
              {accountId || "target account"}
            </TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
              {money(account)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5 }}>platform clearing</TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
              {money(platform)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 700 }}>Net</TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5, fontWeight: 700 }}>
              {formatMoney(0)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Box>
  );
}
