"use client";

import { useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
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
      Transaction <code>{result.transaction_id}</code> posted:{" "}
      <strong>{formatMoney(result.amount_cents)}</strong> (debit{" "}
      <code>{result.debit_account_id}</code> / credit{" "}
      <code>{result.credit_account_id}</code>).
    </Alert>
  );
}

function RefundForm() {
  const [userId, setUserId] = useState("");
  const [paymentIntent, setPaymentIntent] = useState("");
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
          payment_intent: paymentIntent.trim() || undefined,
          amount_cents: minor,
          reason: reason.trim(),
        },
        keyRef.current,
      );
      setResult(res);
      keyRef.current = null;
      setUserId("");
      setPaymentIntent("");
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
              label="Payment intent id (optional)"
              value={paymentIntent}
              onChange={(e) => setPaymentIntent(e.target.value)}
              helperText="Ties the refund to a specific Stripe charge, if applicable."
              slotProps={{ htmlInput: { "aria-label": "Refund payment intent id" } }}
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

/** Manual double-entry adjustment: the operator picks the two ledger accounts
 *  (money moves from `debit_account_id` to `credit_account_id`). Both must be
 *  real ledger-account UUIDs; the API rejects anything else. Look up an id via
 *  the Ledger forensics page when it isn't already at hand. */
function AdjustmentForm() {
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [result, setResult] = useState<LedgerMutationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);

  const debit = debitAccountId.trim();
  const credit = creditAccountId.trim();
  const magnitude = useMemo(() => parseMoneyToMinor(amount), [amount]);
  const sameAccount = debit !== "" && debit === credit;
  const canSubmit =
    debit !== "" &&
    credit !== "" &&
    !sameAccount &&
    reason.trim() !== "" &&
    magnitude != null &&
    magnitude > 0;

  const submit = async () => {
    if (!canSubmit || magnitude == null) return;
    if (keyRef.current == null) keyRef.current = newIdempotencyKey();
    setBusy(true);
    setError(null);
    setErrorDetails(null);
    setResult(null);
    try {
      const res = await admin.createAdjustment(
        {
          debit_account_id: debit,
          credit_account_id: credit,
          amount_cents: magnitude,
          reason: reason.trim(),
        },
        keyRef.current,
      );
      setResult(res);
      keyRef.current = null;
      setDebitAccountId("");
      setCreditAccountId("");
      setAmount("");
      setReason("");
    } catch (err) {
      if (err instanceof WisperError) {
        setError(err.message);
        setErrorDetails(err.details);
      } else {
        setError("The adjustment failed.");
        setErrorDetails(null);
      }
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
              label="Debit account id"
              required
              value={debitAccountId}
              onChange={(e) => setDebitAccountId(e.target.value)}
              error={sameAccount}
              helperText="Money moves out of this account. Ledger-account UUID."
              slotProps={{
                htmlInput: { "aria-label": "Adjustment debit account id" },
              }}
            />
            <TextField
              label="Credit account id"
              required
              value={creditAccountId}
              onChange={(e) => setCreditAccountId(e.target.value)}
              error={sameAccount}
              helperText={
                sameAccount
                  ? "Debit and credit accounts must be different."
                  : "Money moves into this account. Ledger-account UUID."
              }
              slotProps={{
                htmlInput: { "aria-label": "Adjustment credit account id" },
              }}
            />
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
              debitAccountId={debit}
              creditAccountId={credit}
              magnitude={magnitude}
            />

            {error && <ValidationErrorAlert message={error} details={errorDetails} />}
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

/** Render a WisperError as an Alert, expanding the `details` payload when the
 *  API returned validation feedback so the operator can see which fields the
 *  server flagged. Falls back to just the message when there are no details. */
function ValidationErrorAlert({
  message,
  details,
}: {
  message: string;
  details: unknown;
}) {
  const items = detailLines(details);
  if (items.length === 0) {
    return <Alert severity="error">{message}</Alert>;
  }
  return (
    <Alert severity="error">
      <AlertTitle>{message}</AlertTitle>
      <Box component="ul" sx={{ pl: 3, m: 0 }}>
        {items.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </Box>
    </Alert>
  );
}

/** Flatten the API's `error.details` into human-readable lines. Tolerant of the
 *  shapes wisper-api uses: an array of strings, an array of `{ field, message }`
 *  records, or a `{ field: message }` map. Anything else collapses to zero lines
 *  so the bare error message still renders. */
function detailLines(details: unknown): string[] {
  if (details == null) return [];
  if (Array.isArray(details)) {
    return details
      .map((d) => {
        if (typeof d === "string") return d;
        if (d && typeof d === "object") {
          const rec = d as Record<string, unknown>;
          const field = typeof rec.field === "string" ? rec.field : undefined;
          const message = typeof rec.message === "string" ? rec.message : undefined;
          if (field && message) return `${field}: ${message}`;
          return message ?? field;
        }
        return undefined;
      })
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  }
  if (typeof details === "object") {
    return Object.entries(details as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Show both legs of the double-entry so the admin sees it balances to zero. */
function BalancedPreview({
  debitAccountId,
  creditAccountId,
  magnitude,
}: {
  debitAccountId: string;
  creditAccountId: string;
  magnitude: number | null;
}) {
  if (magnitude == null || magnitude <= 0) return null;
  const money = (n: number) => `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n))}`;

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        Balanced entry
      </Typography>
      <Table size="small" aria-label="Balanced entry preview">
        <TableBody>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5, wordBreak: "break-all" }}>
              {creditAccountId || "credit account"}
            </TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
              {money(magnitude)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5, wordBreak: "break-all" }}>
              {debitAccountId || "debit account"}
            </TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
              {money(-magnitude)}
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
