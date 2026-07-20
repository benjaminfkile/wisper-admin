"use client";

import { useState } from "react";
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
import type { LedgerAccount } from "@/lib/wisper/types";

/** Signed amount with a color: green for credits, red for debits. Renders a
 *  dash for a missing amount rather than a misleading zero. */
function SignedAmount({ amount }: { amount?: number }) {
  if (amount == null || !Number.isFinite(amount)) {
    return <Box component="span">—</Box>;
  }
  const positive = amount >= 0;
  return (
    <Box component="span" sx={{ color: positive ? "success.main" : "error.main" }}>
      {positive ? "+" : "−"}
      {formatMoney(Math.abs(amount))}
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

function AccountDetail({ account }: { account: LedgerAccount }) {
  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile
            label="Balance"
            value={formatMoney(account.balance)}
            hint={account.currency}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile
            label="Owner"
            value={
              <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
                {account.owner_id || "—"}
              </Typography>
            }
            hint={
              account.owner_type ? (
                <Chip size="small" variant="outlined" label={account.owner_type} />
              ) : undefined
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatTile label="Account" value={
            <Typography variant="h6" component="p" sx={{ fontWeight: 700, wordBreak: "break-all" }}>
              {account.id}
            </Typography>
          } />
        </Grid>
      </Grid>

      <Typography variant="h6" component="h2" gutterBottom>
        Recent entries
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {account.entries.length === 0 ? (
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
                <TableCell>Kind</TableCell>
                <TableCell>Reference</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Balance after</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {account.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(entry.created_at)}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={entry.kind} />
                  </TableCell>
                  <TableCell sx={{ wordBreak: "break-all" }}>
                    {entry.reference || "—"}
                  </TableCell>
                  <TableCell align="right">
                    <SignedAmount amount={entry.amount} />
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
