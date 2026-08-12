"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { formatBps, formatDateTime, formatMoney, parseMoneyToMinor } from "@/lib/format";
import type {
  AdminPolicy,
  IsolationLevel,
  PolicyRules,
  PolicyVersion,
} from "@/lib/wisper/types";

/** Isolation floor options; `""` is the "No floor" sentinel (sends `null`). */
const ISOLATION_LEVELS: IsolationLevel[] = ["shared", "sandboxed", "vm"];

type Form = {
  /** Required: platform take rate 0..10000 bps. */
  fee_bps: string;
  /** Optional cents fields — entered as dollars (e.g. "10.00" → 1000 cents). */
  min_topup_cents: string;
  first_topup_max_cents: string;
  new_account_max_topup_cents_per_day: string;
  max_spend_cents_per_day: string;
  /** Optional int fields. */
  max_concurrent_leases_per_user: string;
  max_ttl_seconds_cap: string;
  new_account_window_hours: string;
  /** `""` = No floor (sent as `null`); otherwise an isolation level. */
  min_isolation: "" | IsolationLevel;
  host_signups_enabled: boolean;
  /** ISO-8601 datetime; empty = immediate effect. */
  effective_from: string;
};

/** Stringify a possibly-missing numeric field for a controlled text input. */
function numStr(v: number | undefined | null): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

/** Convert a cents value to a dollar string for display (1000 → "10"). */
function centsToDisplay(cents: number | undefined | null): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return String(cents / 100);
}

/** Build the editable form from an active policy revision. */
function toForm(p: Partial<PolicyRules>): Form {
  return {
    fee_bps: numStr(p.fee_bps),
    min_topup_cents: centsToDisplay(p.min_topup_cents),
    first_topup_max_cents: centsToDisplay(p.first_topup_max_cents),
    new_account_max_topup_cents_per_day: centsToDisplay(p.new_account_max_topup_cents_per_day),
    max_spend_cents_per_day: centsToDisplay(p.max_spend_cents_per_day),
    max_concurrent_leases_per_user: numStr(p.max_concurrent_leases_per_user),
    max_ttl_seconds_cap: numStr(p.max_ttl_seconds_cap),
    new_account_window_hours: numStr(p.new_account_window_hours),
    min_isolation: p.min_isolation ?? "",
    host_signups_enabled: p.host_signups_enabled ?? false,
    effective_from: p.effective_from ?? "",
  };
}

/** Validate an optional non-negative integer field. Returns `{ value }` on
 *  success (undefined when empty) or `{ error }` on invalid input. */
function parseOptInt(
  raw: string,
  label: string,
): { value: number | undefined } | { error: string } {
  if (raw === "") return { value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { error: `${label} must be a non-negative whole number.` };
  }
  return { value: n };
}

/** Validate an optional dollar-entry field and return cents, or an error. */
function parseOptCents(
  raw: string,
  label: string,
): { value: number | undefined } | { error: string } {
  if (raw === "") return { value: undefined };
  const cents = parseMoneyToMinor(raw);
  if (cents === null) {
    return { error: `${label} must be a valid dollar amount (e.g. "10.00").` };
  }
  return { value: cents };
}

/** Parse the form into a PolicyRules payload, or return the first validation error. */
function parseForm(f: Form): { rules: PolicyRules } | { error: string } {
  // fee_bps is required.
  const feeBps = Number(f.fee_bps);
  if (f.fee_bps === "" || !Number.isInteger(feeBps) || Number.isNaN(feeBps)) {
    return { error: "Platform fee must be a whole number (basis points)." };
  }
  if (feeBps < 0 || feeBps > 10000) {
    return { error: "Platform fee must be between 0 and 10000 bps (0–100%)." };
  }

  const rules: PolicyRules = { fee_bps: feeBps };

  // Optional int fields.
  const intFields: [keyof Form, string, keyof PolicyRules][] = [
    ["max_concurrent_leases_per_user", "Max concurrent leases", "max_concurrent_leases_per_user"],
    ["max_ttl_seconds_cap", "Max TTL cap", "max_ttl_seconds_cap"],
    ["new_account_window_hours", "New account window hours", "new_account_window_hours"],
  ];
  for (const [field, label, key] of intFields) {
    const res = parseOptInt(f[field] as string, label);
    if ("error" in res) return res;
    if (res.value !== undefined) (rules as unknown as Record<string, unknown>)[key] = res.value;
  }

  // Optional cents fields (user enters dollars, API expects cents).
  const centsFields: [keyof Form, string, keyof PolicyRules][] = [
    ["min_topup_cents", "Minimum top-up", "min_topup_cents"],
    ["first_topup_max_cents", "First top-up max", "first_topup_max_cents"],
    ["new_account_max_topup_cents_per_day", "New account max top-up/day", "new_account_max_topup_cents_per_day"],
    ["max_spend_cents_per_day", "Max spend/day", "max_spend_cents_per_day"],
  ];
  for (const [field, label, key] of centsFields) {
    const res = parseOptCents(f[field] as string, label);
    if ("error" in res) return res;
    if (res.value !== undefined) (rules as unknown as Record<string, unknown>)[key] = res.value;
  }

  // min_isolation: "" → null (no floor), otherwise the chosen level.
  rules.min_isolation = f.min_isolation === "" ? null : f.min_isolation;

  rules.host_signups_enabled = f.host_signups_enabled;

  // effective_from: optional ISO-8601 datetime.
  if (f.effective_from !== "") {
    if (Number.isNaN(new Date(f.effective_from).getTime())) {
      return { error: "Effective from must be a valid ISO-8601 date-time." };
    }
    rules.effective_from = f.effective_from;
  }

  return { rules };
}

/** Editor for GET/PUT /v1/admin/policy: fee, top-up limits, lease caps, new-account
 *  throttles, isolation floor, and host-signup toggle — plus version history. */
export default function PolicyEditor() {
  const [policy, setPolicy] = useState<AdminPolicy | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setPolicy(null);
    setForm(null);
    try {
      const p = await admin.getPolicy();
      setPolicy(p);
      setForm(toForm(p.active ?? {}));
    } catch (err) {
      setLoadError(
        err instanceof WisperError ? err.message : "Failed to load the policy.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
    setSaveError(null);
  };

  const dirty = useMemo(() => {
    if (!policy || !form) return false;
    return JSON.stringify(form) !== JSON.stringify(toForm(policy.active ?? {}));
  }, [policy, form]);

  const onSave = async () => {
    if (!form) return;
    const parsed = parseForm(form);
    if ("error" in parsed) {
      setSaveError(parsed.error);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await admin.updatePolicy(parsed.rules);
      setPolicy(updated);
      setForm(toForm(updated.active ?? parsed.rules));
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof WisperError ? err.message : "Failed to save the policy.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Box>
        <Header />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      </Box>
    );
  }

  if (!form || !policy) {
    return (
      <Box>
        <Header />
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress color="primary" aria-label="Loading policy" />
        </Box>
      </Box>
    );
  }

  const feePreview = Number.isNaN(Number(form.fee_bps))
    ? "—"
    : formatBps(Number(form.fee_bps));

  const active = policy.active ?? {};

  return (
    <Box>
      <Header
        id={active.id}
        effectiveFrom={active.effective_from}
        createdBy={active.created_by}
      />

      <Card variant="outlined" sx={{ mb: 4 }}>
        <CardContent>
          <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
            <Grid container spacing={3}>
              {/* ── Core ── */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Platform fee"
                  type="number"
                  fullWidth
                  value={form.fee_bps}
                  onChange={(e) => set("fee_bps", e.target.value)}
                  helperText={`Basis points — currently ${feePreview}`}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">bps</InputAdornment>
                      ),
                    },
                    htmlInput: { min: 0, max: 10000, "aria-label": "Platform fee" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Minimum top-up"
                  type="number"
                  fullWidth
                  value={form.min_topup_cents}
                  onChange={(e) => set("min_topup_cents", e.target.value)}
                  helperText="Dollars — empty = no minimum"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">$</InputAdornment>
                      ),
                    },
                    htmlInput: { min: 0, step: "0.01", "aria-label": "Minimum top-up" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Max concurrent leases / user"
                  type="number"
                  fullWidth
                  value={form.max_concurrent_leases_per_user}
                  onChange={(e) => set("max_concurrent_leases_per_user", e.target.value)}
                  helperText="Empty = no limit"
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      "aria-label": "Max concurrent leases per user",
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Max TTL cap"
                  type="number"
                  fullWidth
                  value={form.max_ttl_seconds_cap}
                  onChange={(e) => set("max_ttl_seconds_cap", e.target.value)}
                  helperText="Seconds — empty = no cap"
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">s</InputAdornment>
                      ),
                    },
                    htmlInput: { min: 0, "aria-label": "Max TTL cap" },
                  }}
                />
              </Grid>

              {/* ── New-account throttles ── */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="First top-up max"
                  type="number"
                  fullWidth
                  value={form.first_topup_max_cents}
                  onChange={(e) => set("first_topup_max_cents", e.target.value)}
                  helperText="Dollars — max a new account may top up first time; empty = no limit"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">$</InputAdornment>
                      ),
                    },
                    htmlInput: { min: 0, step: "0.01", "aria-label": "First top-up max" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="New account window"
                  type="number"
                  fullWidth
                  value={form.new_account_window_hours}
                  onChange={(e) => set("new_account_window_hours", e.target.value)}
                  helperText="Hours — rolling window for new-account daily limit; empty = no window"
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">hr</InputAdornment>
                      ),
                    },
                    htmlInput: { min: 0, "aria-label": "New account window hours" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="New account max top-up / day"
                  type="number"
                  fullWidth
                  value={form.new_account_max_topup_cents_per_day}
                  onChange={(e) => set("new_account_max_topup_cents_per_day", e.target.value)}
                  helperText="Dollars — per-day top-up cap for new accounts; empty = no limit"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">$</InputAdornment>
                      ),
                    },
                    htmlInput: {
                      min: 0,
                      step: "0.01",
                      "aria-label": "New account max top-up per day",
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Max spend / day"
                  type="number"
                  fullWidth
                  value={form.max_spend_cents_per_day}
                  onChange={(e) => set("max_spend_cents_per_day", e.target.value)}
                  helperText="Dollars — platform-wide daily spend cap; empty = no cap"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">$</InputAdornment>
                      ),
                    },
                    htmlInput: {
                      min: 0,
                      step: "0.01",
                      "aria-label": "Max spend per day",
                    },
                  }}
                />
              </Grid>

              {/* ── Access controls ── */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label="Minimum isolation floor"
                  fullWidth
                  value={form.min_isolation}
                  onChange={(e) =>
                    set("min_isolation", e.target.value as "" | IsolationLevel)
                  }
                  helperText="When a floor is set, a consumer requesting a weaker isolation level than the floor is rejected by the API."
                  slotProps={{ htmlInput: { "aria-label": "Minimum isolation floor" } }}
                >
                  <MenuItem value="">No floor</MenuItem>
                  {ISOLATION_LEVELS.map((level) => (
                    <MenuItem key={level} value={level}>
                      {level}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Effective from"
                  type="datetime-local"
                  fullWidth
                  value={form.effective_from}
                  onChange={(e) => set("effective_from", e.target.value)}
                  helperText="ISO-8601 — leave empty to apply immediately"
                  slotProps={{ htmlInput: { "aria-label": "Effective from" } }}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.host_signups_enabled}
                      onChange={(e) => set("host_signups_enabled", e.target.checked)}
                    />
                  }
                  label="Host signups enabled"
                />
              </Grid>
            </Grid>

            {saveError && (
              <Alert severity="error" sx={{ mt: 3 }}>
                {saveError}
              </Alert>
            )}
            {saved && (
              <Alert severity="success" sx={{ mt: 3 }}>
                Policy saved.
              </Alert>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 3, alignItems: "center" }}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                onClick={() => void onSave()}
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button
                onClick={() => setForm(toForm(active))}
                disabled={saving || !dirty}
              >
                Reset
              </Button>
              {dirty && (
                <Typography variant="body2" color="text.secondary">
                  Unsaved changes
                </Typography>
              )}
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <VersionHistory history={policy.versions} />
    </Box>
  );
}

function Header({
  id,
  effectiveFrom,
  createdBy,
}: {
  id?: string;
  effectiveFrom?: string;
  createdBy?: string;
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
        <Typography variant="h4" component="h1">
          Policy &amp; Pricing
        </Typography>
        {id != null && (
          <Chip size="small" color="primary" label={id} />
        )}
      </Box>
      <Typography color="text.secondary">
        Platform fee, top-up limits, lease caps, and new-account throttles.
        {effectiveFrom
          ? ` Effective ${formatDateTime(effectiveFrom)}${
              createdBy ? ` · created by ${createdBy}` : ""
            }.`
          : ""}
      </Typography>
    </Box>
  );
}

function VersionHistory({ history }: { history?: PolicyVersion[] }) {
  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        Version history
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {!history || history.length === 0 ? (
        <Typography color="text.secondary">No prior revisions.</Typography>
      ) : (
        <TableContainer component={Card} variant="outlined">
          <Table size="small" aria-label="Policy version history">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell align="right">Fee</TableCell>
                <TableCell align="right">Min top-up</TableCell>
                <TableCell align="right">Max leases</TableCell>
                <TableCell>Isolation floor</TableCell>
                <TableCell>Signups</TableCell>
                <TableCell>Effective</TableCell>
                <TableCell>Created by</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((v, i) => (
                <TableRow key={v.id ?? i}>
                  <TableCell>{v.id ?? "—"}</TableCell>
                  <TableCell align="right">{formatBps(v.fee_bps)}</TableCell>
                  <TableCell align="right">{formatMoney(v.min_topup_cents)}</TableCell>
                  <TableCell align="right">
                    {v.max_concurrent_leases_per_user ?? "—"}
                  </TableCell>
                  <TableCell>{v.min_isolation ?? "—"}</TableCell>
                  <TableCell>
                    {v.host_signups_enabled == null
                      ? "—"
                      : v.host_signups_enabled
                        ? "on"
                        : "off"}
                  </TableCell>
                  <TableCell>{formatDateTime(v.effective_from)}</TableCell>
                  <TableCell>{v.created_by ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
