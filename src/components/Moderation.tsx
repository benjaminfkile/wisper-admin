"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { AdminHost, AdminUser } from "@/lib/wisper/types";

type Kind = "hosts" | "users";

/** Common shape both hosts and users satisfy, for the shared action column. */
type Account = { id: string; display_name: string; email: string; status: string };

function matches(a: Account, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    a.id.toLowerCase().includes(needle) ||
    a.display_name.toLowerCase().includes(needle) ||
    a.email.toLowerCase().includes(needle)
  );
}

/** Host & user moderation: search the directory and suspend/unsuspend accounts.
 *  Backed by GET /v1/admin/hosts|users and POST .../suspend|unsuspend. */
export default function Moderation() {
  const [tab, setTab] = useState<Kind>("hosts");

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Moderation
        </Typography>
        <Typography color="text.secondary">
          Search hosts and consumers, and suspend or reinstate accounts.
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v: Kind) => setTab(v)}
        sx={{ mb: 2 }}
        aria-label="Account type"
      >
        <Tab label="Hosts" value="hosts" />
        <Tab label="Consumers" value="users" />
      </Tabs>

      {/* Keep both mounted-on-demand: only the active tab's panel renders. */}
      {tab === "hosts" ? <HostsPanel /> : <UsersPanel />}
    </Box>
  );
}

/** Amber "Suspended" or green "Active" status chip. */
function StatusChip({ status }: { status: string }) {
  const suspended = status === "suspended";
  return (
    <Chip
      size="small"
      variant="outlined"
      color={suspended ? "warning" : "success"}
      label={suspended ? "Suspended" : "Active"}
    />
  );
}

type SuspendTarget = { id: string; name: string };

/** Modal that collects a required reason before suspending an account. */
function SuspendDialog({
  target,
  kind,
  busy,
  onClose,
  onConfirm,
}: {
  target: SuspendTarget | null;
  kind: Kind;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const label = kind === "hosts" ? "host" : "consumer";

  return (
    <Dialog open={target != null} onClose={busy ? undefined : onClose} fullWidth>
      <DialogTitle>Suspend {label}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Suspending <strong>{target?.name}</strong> immediately blocks their
          access. Record a reason for the audit log.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          slotProps={{ htmlInput: { "aria-label": "Suspension reason" } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          disabled={busy || reason.trim() === ""}
          onClick={() => onConfirm(reason.trim())}
        >
          {busy ? "Suspending…" : "Suspend"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Shared list scaffolding: search box, refresh, loading/error/empty states. */
function DirectoryFrame({
  kind,
  query,
  onQuery,
  onRefresh,
  loading,
  error,
  actionError,
  empty,
  children,
}: {
  kind: Kind;
  query: string;
  onQuery: (v: string) => void;
  onRefresh: () => void;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  empty: boolean;
  children: ReactNode;
}) {
  const noun = kind === "hosts" ? "hosts" : "consumers";
  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center" }}>
        <TextField
          size="small"
          placeholder={`Search ${noun} by name, email, or id`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: 420 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { "aria-label": `Search ${noun}` },
          }}
        />
        <Button
          onClick={onRefresh}
          startIcon={<RefreshIcon />}
          disabled={loading}
        >
          Refresh
        </Button>
      </Stack>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress color="primary" aria-label={`Loading ${noun}`} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : empty ? (
        <Typography color="text.secondary" sx={{ py: 4 }}>
          No {noun} match your search.
        </Typography>
      ) : (
        children
      )}
    </Box>
  );
}

/** Hosts directory with suspend/unsuspend. */
function HostsPanel() {
  const [hosts, setHosts] = useState<AdminHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<SuspendTarget | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setHosts(null);
    try {
      setHosts(await admin.listHosts());
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Failed to load hosts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (hosts ?? []).filter((h) => matches(h, query)),
    [hosts, query],
  );

  const replace = (updated: AdminHost) =>
    setHosts((list) =>
      (list ?? []).map((h) => (h.id === updated.id ? updated : h)),
    );

  const runAction = async (id: string, fn: () => Promise<AdminHost>) => {
    setBusyId(id);
    setActionError(null);
    try {
      replace(await fn());
      setSuspendTarget(null);
    } catch (err) {
      setActionError(
        err instanceof WisperError ? err.message : "The action failed.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DirectoryFrame
      kind="hosts"
      query={query}
      onQuery={setQuery}
      onRefresh={() => void load()}
      loading={hosts === null && error === null}
      error={error}
      actionError={actionError}
      empty={shown.length === 0}
    >
      <TableContainer component={Card} variant="outlined">
        <Table size="small" aria-label="Hosts">
          <TableHead>
            <TableRow>
              <TableCell>Host</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Machines</TableCell>
              <TableCell align="right">Earnings</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((h) => (
              <TableRow key={h.id}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {h.display_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {h.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <StatusChip status={h.status} />
                </TableCell>
                <TableCell align="right">
                  {formatNumber(h.machines_online)} / {formatNumber(h.machines_total)}
                </TableCell>
                <TableCell align="right">{formatMoney(h.earnings_total)}</TableCell>
                <TableCell>{formatDateTime(h.created_at)}</TableCell>
                <TableCell align="right">
                  {h.status === "suspended" ? (
                    <Tooltip title={h.suspended_reason || ""}>
                      <span>
                        <Button
                          size="small"
                          disabled={busyId === h.id}
                          onClick={() =>
                            void runAction(h.id, () => admin.unsuspendHost(h.id))
                          }
                        >
                          Unsuspend
                        </Button>
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      size="small"
                      color="warning"
                      disabled={busyId === h.id}
                      onClick={() =>
                        setSuspendTarget({ id: h.id, name: h.display_name })
                      }
                    >
                      Suspend
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <SuspendDialog
        key={suspendTarget?.id ?? "closed"}
        target={suspendTarget}
        kind="hosts"
        busy={busyId != null}
        onClose={() => setSuspendTarget(null)}
        onConfirm={(reason) => {
          if (suspendTarget) {
            void runAction(suspendTarget.id, () =>
              admin.suspendHost(suspendTarget.id, reason),
            );
          }
        }}
      />
    </DirectoryFrame>
  );
}

/** Consumers directory with suspend/unsuspend. */
function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<SuspendTarget | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setUsers(null);
    try {
      setUsers(await admin.listUsers());
    } catch (err) {
      setError(err instanceof WisperError ? err.message : "Failed to load consumers.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (users ?? []).filter((u) => matches(u, query)),
    [users, query],
  );

  const replace = (updated: AdminUser) =>
    setUsers((list) =>
      (list ?? []).map((u) => (u.id === updated.id ? updated : u)),
    );

  const runAction = async (id: string, fn: () => Promise<AdminUser>) => {
    setBusyId(id);
    setActionError(null);
    try {
      replace(await fn());
      setSuspendTarget(null);
    } catch (err) {
      setActionError(
        err instanceof WisperError ? err.message : "The action failed.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DirectoryFrame
      kind="users"
      query={query}
      onQuery={setQuery}
      onRefresh={() => void load()}
      loading={users === null && error === null}
      error={error}
      actionError={actionError}
      empty={shown.length === 0}
    >
      <TableContainer component={Card} variant="outlined">
        <Table size="small" aria-label="Consumers">
          <TableHead>
            <TableRow>
              <TableCell>Consumer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Active leases</TableCell>
              <TableCell align="right">Wallet</TableCell>
              <TableCell align="right">Spend</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {u.display_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {u.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <StatusChip status={u.status} />
                </TableCell>
                <TableCell align="right">{formatNumber(u.active_leases)}</TableCell>
                <TableCell align="right">{formatMoney(u.wallet_balance)}</TableCell>
                <TableCell align="right">{formatMoney(u.spend_total)}</TableCell>
                <TableCell>{formatDateTime(u.created_at)}</TableCell>
                <TableCell align="right">
                  {u.status === "suspended" ? (
                    <Tooltip title={u.suspended_reason || ""}>
                      <span>
                        <Button
                          size="small"
                          disabled={busyId === u.id}
                          onClick={() =>
                            void runAction(u.id, () => admin.unsuspendUser(u.id))
                          }
                        >
                          Unsuspend
                        </Button>
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      size="small"
                      color="warning"
                      disabled={busyId === u.id}
                      onClick={() =>
                        setSuspendTarget({ id: u.id, name: u.display_name })
                      }
                    >
                      Suspend
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <SuspendDialog
        key={suspendTarget?.id ?? "closed"}
        target={suspendTarget}
        kind="users"
        busy={busyId != null}
        onClose={() => setSuspendTarget(null)}
        onConfirm={(reason) => {
          if (suspendTarget) {
            void runAction(suspendTarget.id, () =>
              admin.suspendUser(suspendTarget.id, reason),
            );
          }
        }}
      />
    </DirectoryFrame>
  );
}
