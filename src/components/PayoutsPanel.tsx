"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatMoney, parseMoneyToMinor } from "@/lib/format";
import type {
  LedgerAccount,
  LedgerAccountSummary,
  LedgerMutationResult,
  RefundResponse,
} from "@/lib/wisper/types";

/** RFC 4122 UUID matcher (any variant). The API rejects non-UUID ledger
 *  account ids with a `validation_error` that surfaces as the misleading
 *  "The request body is not valid JSON.", so we gate submission client-side. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Preview-lookup debounce: keystroke-quiet before firing GET
 *  /v1/admin/ledger/accounts/:id, matching the moderation search pattern. */
const PREVIEW_DEBOUNCE_MS = 300;

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

/** Success confirmation for the refund form. The RefundResponse carries the
 *  refund id, the refunded amount, the currency, and the wallet's balance
 *  after the refund, so the note reports only those fields. */
function RefundResultNote({ result }: { result: RefundResponse }) {
  return (
    <Alert severity="success" sx={{ mt: 2 }}>
      Refund <code>{result.refund_id}</code>:{" "}
      <strong>{formatMoney(result.amount_cents, result.currency)}</strong>{" "}
      refunded; remaining wallet balance{" "}
      <strong>{formatMoney(result.balance_cents, result.currency)}</strong>.
    </Alert>
  );
}

/** Success confirmation for the adjustment form: a double-entry ledger post. */
function AdjustmentResultNote({ result }: { result: LedgerMutationResult }) {
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
  const [result, setResult] = useState<RefundResponse | null>(null);
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
            {result && <RefundResultNote result={result} />}

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
 *  real ledger-account UUIDs; the API rejects anything else with a generic
 *  "The request body is not valid JSON." message, so we enforce the UUID shape
 *  client-side and preview each account (kind / owner / current balance) so a
 *  swapped debit/credit or a wrong id is visible before posting.
 *
 *  Each leg has a picker (GET /v1/admin/ledger/accounts, narrowed by kind and,
 *  for owner-scoped kinds like user_wallet / host_earnings, an owner filter)
 *  that fills the id, plus a raw UUID text field as a fallback for the case
 *  where the operator already has the id in hand. */
function AdjustmentForm() {
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [result, setResult] = useState<LedgerMutationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerLeg, setPickerLeg] = useState<"debit" | "credit" | null>(null);
  const keyRef = useRef<string | null>(null);

  const debit = debitAccountId.trim();
  const credit = creditAccountId.trim();
  const debitValid = debit === "" || isUuid(debit);
  const creditValid = credit === "" || isUuid(credit);
  const magnitude = useMemo(() => parseMoneyToMinor(amount), [amount]);
  const sameAccount = debit !== "" && debit === credit;

  const debitPreview = useAccountPreview(debit);
  const creditPreview = useAccountPreview(credit);

  const canSubmit =
    isUuid(debit) &&
    isUuid(credit) &&
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

  const debitHelper = accountFieldHelper({
    valid: debitValid,
    sameAccount,
    fallback: "Money moves out of this account. Ledger-account UUID.",
  });
  const creditHelper = accountFieldHelper({
    valid: creditValid,
    sameAccount,
    fallback: "Money moves into this account. Ledger-account UUID.",
  });

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
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <TextField
                  fullWidth
                  label="Debit account id"
                  required
                  value={debitAccountId}
                  onChange={(e) => setDebitAccountId(e.target.value)}
                  error={!debitValid || sameAccount}
                  helperText={debitHelper}
                  slotProps={{
                    htmlInput: { "aria-label": "Adjustment debit account id" },
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={() => setPickerLeg("debit")}
                  aria-label="Pick debit account"
                  sx={{ mt: 1, whiteSpace: "nowrap" }}
                >
                  Pick account
                </Button>
              </Stack>
              <AccountPreview
                label="Debit account"
                preview={debitPreview}
                shouldFetch={isUuid(debit)}
              />
            </Box>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <TextField
                  fullWidth
                  label="Credit account id"
                  required
                  value={creditAccountId}
                  onChange={(e) => setCreditAccountId(e.target.value)}
                  error={!creditValid || sameAccount}
                  helperText={creditHelper}
                  slotProps={{
                    htmlInput: { "aria-label": "Adjustment credit account id" },
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={() => setPickerLeg("credit")}
                  aria-label="Pick credit account"
                  sx={{ mt: 1, whiteSpace: "nowrap" }}
                >
                  Pick account
                </Button>
              </Stack>
              <AccountPreview
                label="Credit account"
                preview={creditPreview}
                shouldFetch={isUuid(credit)}
              />
            </Box>
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
              debitAccount={debitPreview.account}
              creditAccount={creditPreview.account}
              magnitude={magnitude}
            />

            {error && <ValidationErrorAlert message={error} details={errorDetails} />}
            {result && <AdjustmentResultNote result={result} />}

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

      <AccountPickerDialog
        key={pickerLeg ?? "closed"}
        leg={pickerLeg}
        onClose={() => setPickerLeg(null)}
        onSelect={(id) => {
          if (pickerLeg === "debit") setDebitAccountId(id);
          else if (pickerLeg === "credit") setCreditAccountId(id);
          setPickerLeg(null);
        }}
      />
    </Card>
  );
}

function accountFieldHelper({
  valid,
  sameAccount,
  fallback,
}: {
  valid: boolean;
  sameAccount: boolean;
  fallback: string;
}): string {
  if (sameAccount) return "Debit and credit accounts must be different.";
  if (!valid) return "Enter a ledger-account UUID (36-character, RFC 4122).";
  return fallback;
}

/** Fetched-account snapshot for the inline preview. `account` is set when a
 *  lookup succeeded; `notFound` is set when the API returned 404 for the id;
 *  `error` carries any other failure message. */
interface AccountPreviewState {
  loading: boolean;
  notFound: boolean;
  error: string | null;
  account: LedgerAccount | null;
}

const EMPTY_PREVIEW: AccountPreviewState = {
  loading: false,
  notFound: false,
  error: null,
  account: null,
};

/** Debounced GET /v1/admin/ledger/accounts/:id for the given input. Only fires
 *  when the trimmed id parses as a UUID; 404 becomes `notFound` so callers can
 *  render "no such account" inline. A stale response (the id has since
 *  changed) is discarded via a monotonically increasing request seq. */
function useAccountPreview(id: string): AccountPreviewState {
  const [state, setState] = useState<AccountPreviewState>(EMPTY_PREVIEW);
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = id.trim();
    if (trimmed === "" || !isUuid(trimmed)) {
      seqRef.current += 1;
      setState(EMPTY_PREVIEW);
      return;
    }
    const seq = ++seqRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null, notFound: false }));
    const timer = setTimeout(() => {
      admin
        .getLedgerAccount(trimmed)
        .then((account) => {
          if (seqRef.current !== seq) return;
          setState({ loading: false, notFound: false, error: null, account });
        })
        .catch((err: unknown) => {
          if (seqRef.current !== seq) return;
          if (err instanceof WisperError && err.status === 404) {
            setState({
              loading: false,
              notFound: true,
              error: null,
              account: null,
            });
            return;
          }
          setState({
            loading: false,
            notFound: false,
            error:
              err instanceof WisperError
                ? err.message
                : "Failed to load the account.",
            account: null,
          });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [id]);

  return state;
}

/** Inline account snapshot rendered under a debit/credit id field: the account
 *  kind, owner id, and current balance for the typed UUID. Renders nothing
 *  until an id is typed; shows a small spinner while the lookup is in flight;
 *  shows "no such account" on 404 so a swapped or wrong id is obvious before
 *  posting the adjustment. */
function AccountPreview({
  label,
  preview,
  shouldFetch,
}: {
  label: string;
  preview: AccountPreviewState;
  shouldFetch: boolean;
}) {
  if (!shouldFetch) return null;
  if (preview.loading) {
    return (
      <Box
        sx={{
          mt: 1,
          color: "text.secondary",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <CircularProgress
          size={14}
          aria-label={`Looking up ${label.toLowerCase()}`}
        />
        <Typography variant="caption">Looking up account…</Typography>
      </Box>
    );
  }
  if (preview.notFound) {
    return (
      <Typography
        variant="caption"
        color="error"
        sx={{ mt: 1, display: "block" }}
        role="status"
      >
        {label}: no such account.
      </Typography>
    );
  }
  if (preview.error) {
    return (
      <Typography
        variant="caption"
        color="error"
        sx={{ mt: 1, display: "block" }}
        role="status"
      >
        {label}: {preview.error}
      </Typography>
    );
  }
  if (!preview.account) return null;
  const acct = preview.account;
  return (
    <Box
      sx={{
        mt: 1,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
      }}
      role="status"
      aria-label={`${label} preview`}
    >
      {acct.kind ? (
        <Chip size="small" variant="outlined" label={acct.kind} />
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {acct.owner_user_id
          ? `owner ${acct.owner_user_id}`
          : "platform account"}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        &middot; balance {formatMoney(acct.balance_cents, acct.currency)}
      </Typography>
    </Box>
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

/** Flatten the API's `error.details` into human-readable lines. Tolerant of
 *  the shapes wisper-api uses: the real shape today is a FLAT
 *  `{ field: "credit_account_id" }` object (a single-field marker), but the
 *  server may also send an array of strings, an array of `{ field, message }`
 *  records, or a `{ field: message }` map. Anything else collapses to zero
 *  lines so the bare error message still renders. */
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
    const rec = details as Record<string, unknown>;
    // Real API shape today: `{ field: "credit_account_id" }` marks which field
    // was invalid, with no per-field message. Surface that as "field: <name>"
    // rather than swallowing it and leaving only the top-line message.
    const entries = Object.entries(rec);
    if (
      entries.length === 1 &&
      entries[0][0] === "field" &&
      typeof entries[0][1] === "string"
    ) {
      return [`field: ${entries[0][1]}`];
    }
    return entries
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Show both legs of the double-entry so the admin sees it balances to zero.
 *  When a lookup has fetched the account (kind + owner), we label the leg with
 *  those attributes as well as the UUID, so a swapped debit/credit stands out
 *  visually before the operator posts. */
function BalancedPreview({
  debitAccountId,
  creditAccountId,
  debitAccount,
  creditAccount,
  magnitude,
}: {
  debitAccountId: string;
  creditAccountId: string;
  debitAccount: LedgerAccount | null;
  creditAccount: LedgerAccount | null;
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
              <LegLabel
                id={creditAccountId}
                account={creditAccount}
                fallback="credit account"
              />
            </TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
              {money(magnitude)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ border: 0, py: 0.5, wordBreak: "break-all" }}>
              <LegLabel
                id={debitAccountId}
                account={debitAccount}
                fallback="debit account"
              />
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

/** One leg's label in the balanced-entry preview: the raw UUID, plus the
 *  fetched kind / owner when a preview lookup has resolved for that id. */
function LegLabel({
  id,
  account,
  fallback,
}: {
  id: string;
  account: LedgerAccount | null;
  fallback: string;
}) {
  const primary = id || fallback;
  if (!account) {
    return <Typography variant="body2">{primary}</Typography>;
  }
  const details: string[] = [];
  if (account.kind) details.push(account.kind);
  if (account.owner_user_id) details.push(`owner ${account.owner_user_id}`);
  return (
    <Box>
      <Typography variant="body2">{primary}</Typography>
      {details.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {details.join(" / ")}
        </Typography>
      )}
    </Box>
  );
}

/** Ledger-account kinds the picker offers. The two owner-scoped kinds live in
 *  {@link OWNER_SCOPED_KINDS} so the picker knows when to surface an owner
 *  filter as an optional narrowing. GET /v1/admin/ledger/accounts does NOT
 *  require `owner_user_id` for these kinds: querying by kind alone returns
 *  every wallet / host_earnings account paged, so the owner filter is offered
 *  only to narrow the results. */
const KIND_OPTIONS = [
  "user_wallet",
  "host_earnings",
  "platform_revenue",
  "platform_cash",
  "stripe_fees",
] as const;

const OWNER_SCOPED_KINDS = new Set<string>(["user_wallet", "host_earnings"]);

/** How many rows we request per accounts page. */
const PICKER_PAGE = 25;

/** Debounce for the owner search box: wait this long after the last keystroke
 *  before resolving the typed value to an owner user id. */
const PICKER_DEBOUNCE_MS = 300;

/** Convert the API's `next_offset` (number, numeric string, or null) into a
 *  plain number, or `null` when there is no next page. */
function toOffset(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** How many users to fetch when the owner filter is an email substring: a
 *  partial email frequently matches more than one account, so the picker
 *  requests a small page and surfaces every hit for the operator to pick from
 *  rather than silently taking the first row. */
const PICKER_OWNER_LOOKUP_LIMIT = 10;

/** A single candidate user for the owner filter. Returned from
 *  {@link useOwnerLookup}: a UUID input yields one synthesized candidate; an
 *  email substring yields every match on the fetched page. */
interface OwnerCandidate {
  id: string;
  email: string | null;
}

/** Resolves a typed owner filter (email or user id) into one or more
 *  candidate users for the accounts query. A UUID passes through directly as a
 *  single candidate; an email substring is looked up via GET
 *  /v1/admin/users?query= with a small page and every match is returned so the
 *  caller can auto-select on one hit or present a chooser on many. Debounced
 *  so a fresh keystroke doesn't fire a request per character. */
function useOwnerLookup(input: string, enabled: boolean): {
  loading: boolean;
  candidates: OwnerCandidate[];
  notFound: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    candidates: OwnerCandidate[];
    notFound: boolean;
    error: string | null;
  }>({
    loading: false,
    candidates: [],
    notFound: false,
    error: null,
  });
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = input.trim();
    if (!enabled || trimmed === "") {
      seqRef.current += 1;
      setState({
        loading: false,
        candidates: [],
        notFound: false,
        error: null,
      });
      return;
    }
    if (isUuid(trimmed)) {
      seqRef.current += 1;
      setState({
        loading: false,
        candidates: [{ id: trimmed, email: null }],
        notFound: false,
        error: null,
      });
      return;
    }
    const seq = ++seqRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null, notFound: false }));
    const timer = setTimeout(() => {
      admin
        .listUsers({
          query: trimmed,
          limit: PICKER_OWNER_LOOKUP_LIMIT,
          offset: 0,
        })
        .then((res) => {
          if (seqRef.current !== seq) return;
          if (res.data.length === 0) {
            setState({
              loading: false,
              candidates: [],
              notFound: true,
              error: null,
            });
            return;
          }
          setState({
            loading: false,
            candidates: res.data.map((u) => ({
              id: u.id,
              email: u.email ?? null,
            })),
            notFound: false,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (seqRef.current !== seq) return;
          setState({
            loading: false,
            candidates: [],
            notFound: false,
            error:
              err instanceof WisperError
                ? err.message
                : "Failed to look up the owner.",
          });
        });
    }, PICKER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, enabled]);

  return state;
}

/** Modal-backed picker for one leg of the adjustment. The operator narrows by
 *  kind (required) and, for owner-scoped kinds, optionally by owner (email or
 *  user id) as an extra filter, then picks a row from the paged GET
 *  /v1/admin/ledger/accounts result. The API does not require `owner_user_id`
 *  for owner-scoped kinds, so leaving the owner filter blank browses every
 *  account of that kind. When an email substring matches more than one user,
 *  the picker surfaces every match for the operator to pick from rather than
 *  silently picking the first row. The selected id is handed back to the
 *  caller, which fills the leg's field. */
function AccountPickerDialog({
  leg,
  onClose,
  onSelect,
}: {
  leg: "debit" | "credit" | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const open = leg != null;
  const [kind, setKind] = useState<string>("");
  const [ownerInput, setOwnerInput] = useState("");
  const [rows, setRows] = useState<LedgerAccountSummary[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const ownerScoped = OWNER_SCOPED_KINDS.has(kind);
  const owner = useOwnerLookup(ownerInput, ownerScoped);
  const ownerInputTrimmed = ownerInput.trim();
  const singleOwner =
    owner.candidates.length === 1 ? owner.candidates[0] : null;
  const multipleOwners =
    owner.candidates.length > 1 ? owner.candidates : [];
  // No owner input → browse every account of the kind. Owner input → the
  // accounts query waits until the input resolves to exactly one user (either
  // a single API match / UUID passthrough, or the operator picked one of the
  // several matches from the list below the field).
  const ownerFilterReady =
    !ownerScoped || ownerInputTrimmed === "" || singleOwner != null;
  const canQuery = kind !== "" && ownerFilterReady;
  const ownerUserId = ownerScoped ? singleOwner?.id ?? null : null;

  const runFirst = useCallback(async () => {
    if (!canQuery) {
      setRows(null);
      setNextOffset(null);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    setRows(null);
    setNextOffset(null);
    try {
      const res = await admin.listLedgerAccounts({
        kind,
        owner_user_id: ownerUserId ?? undefined,
        limit: PICKER_PAGE,
        offset: 0,
      });
      if (requestSeqRef.current !== seq) return;
      setRows(res.data);
      setNextOffset(toOffset(res.next_offset));
    } catch (err) {
      if (requestSeqRef.current !== seq) return;
      setError(
        err instanceof WisperError ? err.message : "Failed to load accounts.",
      );
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }, [canQuery, kind, ownerUserId]);

  useEffect(() => {
    if (!open) return;
    void runFirst();
  }, [open, runFirst]);

  const loadMore = async () => {
    if (nextOffset == null) return;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    try {
      const res = await admin.listLedgerAccounts({
        kind,
        owner_user_id: ownerUserId ?? undefined,
        limit: PICKER_PAGE,
        offset: nextOffset,
      });
      if (requestSeqRef.current !== seq) return;
      setRows((prev) => [...(prev ?? []), ...res.data]);
      setNextOffset(toOffset(res.next_offset));
    } catch (err) {
      if (requestSeqRef.current !== seq) return;
      setError(
        err instanceof WisperError
          ? err.message
          : "Failed to load more accounts.",
      );
    } finally {
      if (requestSeqRef.current === seq) setLoadingMore(false);
    }
  };

  const shown = rows ?? [];
  const legLabel = leg === "debit" ? "debit" : leg === "credit" ? "credit" : "";
  const ownerHelper = (() => {
    if (!ownerScoped) return "";
    if (ownerInputTrimmed === "")
      return "Optional. Leave blank to browse every account of this kind, or enter an email or user id to narrow.";
    if (owner.loading) return "Looking up owner…";
    if (owner.error) return owner.error;
    if (owner.notFound) return "No matching user.";
    if (singleOwner) {
      return singleOwner.email
        ? `Owner ${singleOwner.email} (${singleOwner.id}).`
        : `Owner ${singleOwner.id}.`;
    }
    if (multipleOwners.length > 0) {
      return `${multipleOwners.length} users match. Pick one below to narrow the accounts.`;
    }
    return "";
  })();

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Pick {legLabel} account</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            helperText="Narrow the accounts list by ledger kind."
            slotProps={{ htmlInput: { "aria-label": "Picker account kind" } }}
          >
            <MenuItem value="">Choose a kind</MenuItem>
            {KIND_OPTIONS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>

          {ownerScoped && (
            <TextField
              label="Owner (email or user id, optional)"
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              helperText={ownerHelper}
              error={owner.notFound || owner.error != null}
              slotProps={{
                htmlInput: { "aria-label": "Picker owner email or user id" },
              }}
            />
          )}

          {ownerScoped && multipleOwners.length > 0 && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                Multiple users match. Pick one to narrow the accounts to their
                wallet:
              </Typography>
              <Table
                size="small"
                aria-label="Owner match candidates"
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Email</TableCell>
                    <TableCell>User id</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {multipleOwners.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell sx={{ wordBreak: "break-all" }}>
                        {c.email ?? "(no email)"}
                      </TableCell>
                      <TableCell sx={{ wordBreak: "break-all" }}>
                        {c.id}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={() => setOwnerInput(c.id)}
                          aria-label={`Use owner ${c.email ?? c.id}`}
                        >
                          Use
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          {kind === "" ? (
            <Typography variant="caption" color="text.secondary">
              Choose a kind to list accounts.
            </Typography>
          ) : !canQuery ? (
            <Typography variant="caption" color="text.secondary">
              {multipleOwners.length > 0
                ? `Pick one of the matching users above to narrow the ${kind} accounts, or clear the owner filter to browse every account of this kind.`
                : `Resolve the owner filter above, or clear it to browse every ${kind} account.`}
            </Typography>
          ) : loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={20} aria-label="Loading accounts" />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : shown.length === 0 ? (
            <Typography color="text.secondary">
              No accounts match this filter.
            </Typography>
          ) : (
            <>
              <Table
                size="small"
                aria-label={`Picker ${legLabel} account results`}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Account id</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell sx={{ wordBreak: "break-all" }}>
                        <Typography variant="body2">{a.id}</Typography>
                        {a.kind && (
                          <Typography variant="caption" color="text.secondary">
                            {a.kind}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ wordBreak: "break-all" }}>
                        {a.owner_email || a.owner_user_id || "platform"}
                      </TableCell>
                      <TableCell align="right">
                        {a.balance_cents != null
                          ? formatMoney(a.balance_cents, a.currency)
                          : ""}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => onSelect(a.id)}
                          aria-label={`Use account ${a.id}`}
                        >
                          Use
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                {nextOffset != null ? (
                  <Button onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    End of results.
                  </Typography>
                )}
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
