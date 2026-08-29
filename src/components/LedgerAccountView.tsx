"use client";

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import StatTile from "@/components/StatTile";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { LedgerAccount, LedgerEntry } from "@/lib/wisper/types";

/** Ledger account kinds whose balance grows with debits (DEBIT-normal per
 *  wisper-api Migrations/0006_Ledger.sql). Every other kind is CREDIT-normal.
 *  Used to sign the per-row delta when we walk the running balance backwards. */
const DEBIT_NORMAL_KINDS = new Set(["platform_cash", "stripe_fees"]);

const PLACEHOLDER = "n/a";

/** Cents amount rendered in the given color; empty when zero/missing so the
 *  double-entry columns read as one number per row. */
function CentsCell({ cents, color }: { cents?: number; color: string }) {
  if (!cents || !Number.isFinite(cents)) {
    return <Box component="span">{PLACEHOLDER}</Box>;
  }
  return (
    <Box component="span" sx={{ color }}>
      {formatMoney(cents)}
    </Box>
  );
}

/** Ledger-account forensics: look up an account by id and inspect its balance,
 *  owner, and recent entries (GET /v1/admin/ledger/accounts/:id). */
export default function LedgerAccountView() {
  const [id, setId] = useState("");
  const [account, setAccount] = useState<LedgerAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    const trimmed = id.trim();
    if (trimmed === "") return;
    setLoading(true);
    setError(null);
    setAccount(null);
    try {
      setAccount(await admin.getLedgerAccount(trimmed));
    } catch (err) {
      setError(
        err instanceof WisperError
          ? err.message
          : "Failed to load the ledger account.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Ledger forensics
        </Typography>
        <Typography color="text.secondary">
          Look up any ledger account to trace its balance and recent entries.
        </Typography>
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
        sx={{ mb: 3 }}
      >
        <Stack direction="row" spacing={2}>
          <TextField
            size="small"
            label="Ledger account id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            sx={{ flexGrow: 1, maxWidth: 480 }}
            slotProps={{ htmlInput: { "aria-label": "Ledger account id" } }}
          />
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading || id.trim() === ""}
          >
            {loading ? "Looking up…" : "Look up"}
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress color="primary" aria-label="Loading account" />
        </Box>
      )}

      {account && !loading && <AccountDetail account={account} />}
    </Box>
  );
}

/** Sort entries newest-first, then compute the running account balance after
 *  each entry. We anchor at the current balance (newest row) and walk older,
 *  subtracting each row's net effect. The sign of that effect depends on
 *  which side of the ledger the account is normalized on: credit-normal
 *  accounts (user_wallet, host_earnings, platform_revenue) grow on credits so
 *  delta = credit - debit; debit-normal accounts (platform_cash, stripe_fees
 *  per wisper-api Migrations/0006_Ledger.sql) grow on debits so
 *  delta = debit - credit. Rows with an unparseable timestamp fall to the
 *  bottom in encounter order. */
function withRunningBalance(
  entries: LedgerEntry[],
  currentBalance?: number,
  kind?: string,
): Array<LedgerEntry & { balance_after?: number }> {
  const sorted = [...entries].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : NaN;
    const tb = b.created_at ? Date.parse(b.created_at) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  if (currentBalance == null || !Number.isFinite(currentBalance)) {
    return sorted.map((e) => ({ ...e }));
  }
  const debitNormal = kind != null && DEBIT_NORMAL_KINDS.has(kind);
  let running = currentBalance;
  return sorted.map((e) => {
    const after = running;
    const credit = e.credit_cents ?? 0;
    const debit = e.debit_cents ?? 0;
    const delta = debitNormal ? debit - credit : credit - debit;
    running = running - delta;
    return { ...e, balance_after: after };
  });
}

function AccountDetail({ account }: { account: LedgerAccount }) {
  const rows = useMemo(
    () => withRunningBalance(account.entries, account.balance_cents, account.kind),
    [account.entries, account.balance_cents, account.kind],
  );

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile
            label="Balance"
            value={formatMoney(account.balance_cents)}
            hint={account.currency}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile
            label="Owner"
            value={
              <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
                {account.owner_user_id || PLACEHOLDER}
              </Typography>
            }
            hint={
              account.kind ? (
                <Chip size="small" variant="outlined" label={account.kind} />
              ) : undefined
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile label="Account" value={
            <Typography variant="h6" component="span" sx={{ fontWeight: 700, wordBreak: "break-all" }}>
              {account.id}
            </Typography>
          } />
        </Grid>
      </Grid>

      <Typography variant="h6" component="h2" gutterBottom>
        Recent entries
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {rows.length === 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography color="text.secondary">
              This account has no ledger entries.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card} variant="outlined">
          <Table size="small" aria-label="Ledger entries">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Reference</TableCell>
                <TableCell align="right">Debit</TableCell>
                <TableCell align="right">Credit</TableCell>
                <TableCell align="right">Balance after</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((entry, i) => (
                <TableRow key={`${entry.transaction_id ?? "txn"}-${i}`}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(entry.created_at)}
                  </TableCell>
                  <TableCell sx={{ wordBreak: "break-all" }}>
                    <Typography variant="body2">
                      {entry.transaction_id || PLACEHOLDER}
                    </Typography>
                    {entry.lease_id && (
                      <Typography variant="caption" color="text.secondary">
                        lease {entry.lease_id}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <CentsCell cents={entry.debit_cents} color="error.main" />
                  </TableCell>
                  <TableCell align="right">
                    <CentsCell cents={entry.credit_cents} color="success.main" />
                  </TableCell>
                  <TableCell align="right">
                    {formatMoney(entry.balance_after)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
