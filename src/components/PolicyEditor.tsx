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
import { formatBps, formatDateTime, formatMoney } from "@/lib/format";
import type {
  AdminPolicy,
  PolicyRules,
  PolicyVersion,
  WispNetwork,
} from "@/lib/wisper/types";

const NETWORKS: WispNetwork[] = ["none", "egress", "open"];

type Form = {
  platform_fee_bps: string;
  min_price_per_hour: string;
  max_price_per_hour: string;
  min_topup: string;
  default_network: WispNetwork;
  max_active_leases_per_user: string;
  host_signups_enabled: boolean;
};

function toForm(p: PolicyRules): Form {
  return {
    platform_fee_bps: String(p.platform_fee_bps),
    min_price_per_hour: String(p.min_price_per_hour),
    max_price_per_hour: String(p.max_price_per_hour),
    min_topup: String(p.min_topup),
    default_network: p.default_network,
    max_active_leases_per_user: String(p.max_active_leases_per_user),
    host_signups_enabled: p.host_signups_enabled,
  };
}

/** Parse the form into a PolicyRules body, or return the first validation error. */
function parseForm(f: Form): { rules: PolicyRules } | { error: string } {
  const nums: Record<string, number> = {};
  const fields: [keyof Form, string][] = [
    ["platform_fee_bps", "Platform fee"],
    ["min_price_per_hour", "Minimum price"],
    ["max_price_per_hour", "Maximum price"],
    ["min_topup", "Minimum top-up"],
    ["max_active_leases_per_user", "Max active leases"],
  ];
  for (const [key, label] of fields) {
    const n = Number(f[key]);
    if (f[key as keyof Form] === "" || Number.isNaN(n)) {
      return { error: `${label} must be a number.` };
    }
    if (n < 0 || !Number.isInteger(n)) {
      return { error: `${label} must be a non-negative whole number.` };
    }
    nums[key] = n;
  }
  if (nums.platform_fee_bps > 10000) {
    return { error: "Platform fee cannot exceed 10000 bps (100%)." };
  }
  if (nums.min_price_per_hour > nums.max_price_per_hour) {
    return { error: "Minimum price cannot exceed the maximum price." };
  }
  return {
    rules: {
      platform_fee_bps: nums.platform_fee_bps,
      min_price_per_hour: nums.min_price_per_hour,
      max_price_per_hour: nums.max_price_per_hour,
      min_topup: nums.min_topup,
      default_network: f.default_network,
      max_active_leases_per_user: nums.max_active_leases_per_user,
      host_signups_enabled: f.host_signups_enabled,
    },
  };
}

/** Editor for GET/PUT /v1/admin/policy: fee, price caps, min top-up, network,
 *  lease ceiling, and host-signup toggle — with the version history below. */
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
      setForm(toForm(p));
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
    return JSON.stringify(form) !== JSON.stringify(toForm(policy));
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
      setForm(toForm(updated));
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

  const feePreview = Number.isNaN(Number(form.platform_fee_bps))
    ? "—"
    : formatBps(Number(form.platform_fee_bps));

  return (
    <Box>
      <Header
        version={policy.version}
        updatedAt={policy.updated_at}
        updatedBy={policy.updated_by}
      />

      <Card variant="outlined" sx={{ mb: 4 }}>
        <CardContent>
          <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Platform fee"
                  type="number"
                  fullWidth
                  value={form.platform_fee_bps}
                  onChange={(e) => set("platform_fee_bps", e.target.value)}
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
                  value={form.min_topup}
                  onChange={(e) => set("min_topup", e.target.value)}
                  helperText={`Minor units — ${moneyHint(form.min_topup)}`}
                  slotProps={{ htmlInput: { min: 0, "aria-label": "Minimum top-up" } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Minimum price / hour"
                  type="number"
                  fullWidth
                  value={form.min_price_per_hour}
                  onChange={(e) => set("min_price_per_hour", e.target.value)}
                  helperText={`Minor units — ${moneyHint(form.min_price_per_hour)}`}
                  slotProps={{
                    htmlInput: { min: 0, "aria-label": "Minimum price per hour" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Maximum price / hour"
                  type="number"
                  fullWidth
                  value={form.max_price_per_hour}
                  onChange={(e) => set("max_price_per_hour", e.target.value)}
                  helperText={`Minor units — ${moneyHint(form.max_price_per_hour)}`}
                  slotProps={{
                    htmlInput: { min: 0, "aria-label": "Maximum price per hour" },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Max active leases / user"
                  type="number"
                  fullWidth
                  value={form.max_active_leases_per_user}
                  onChange={(e) => set("max_active_leases_per_user", e.target.value)}
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      "aria-label": "Max active leases per user",
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  label="Default network"
                  fullWidth
                  value={form.default_network}
                  onChange={(e) =>
                    set("default_network", e.target.value as WispNetwork)
                  }
                  slotProps={{ htmlInput: { "aria-label": "Default network" } }}
                >
                  {NETWORKS.map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
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
                onClick={() => setForm(toForm(policy))}
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

      <VersionHistory history={policy.history} />
    </Box>
  );
}

function moneyHint(value: string): string {
  const n = Number(value);
  return value !== "" && !Number.isNaN(n) ? formatMoney(n) : "—";
}

function Header({
  version,
  updatedAt,
  updatedBy,
}: {
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
        <Typography variant="h4" component="h1">
          Policy &amp; Pricing
        </Typography>
        {version != null && (
          <Chip size="small" color="primary" label={`v${version}`} />
        )}
      </Box>
      <Typography color="text.secondary">
        Platform fee, price caps, minimum top-up, and lease limits.
        {updatedAt
          ? ` Last updated ${formatDateTime(updatedAt)}${
              updatedBy ? ` by ${updatedBy}` : ""
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
                <TableCell>Version</TableCell>
                <TableCell align="right">Fee</TableCell>
                <TableCell align="right">Price range / hr</TableCell>
                <TableCell align="right">Min top-up</TableCell>
                <TableCell align="right">Max leases</TableCell>
                <TableCell>Network</TableCell>
                <TableCell>Signups</TableCell>
                <TableCell>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((v) => (
                <TableRow key={v.version}>
                  <TableCell>v{v.version}</TableCell>
                  <TableCell align="right">{formatBps(v.platform_fee_bps)}</TableCell>
                  <TableCell align="right">
                    {formatMoney(v.min_price_per_hour)} –{" "}
                    {formatMoney(v.max_price_per_hour)}
                  </TableCell>
                  <TableCell align="right">{formatMoney(v.min_topup)}</TableCell>
                  <TableCell align="right">{v.max_active_leases_per_user}</TableCell>
                  <TableCell>{v.default_network}</TableCell>
                  <TableCell>{v.host_signups_enabled ? "on" : "off"}</TableCell>
                  <TableCell>
                    {formatDateTime(v.updated_at)}
                    {v.updated_by ? ` · ${v.updated_by}` : ""}
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
