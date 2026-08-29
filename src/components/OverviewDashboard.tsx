"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import GroupIcon from "@mui/icons-material/Group";
import HubIcon from "@mui/icons-material/Hub";
import PaymentsIcon from "@mui/icons-material/Payments";
import RefreshIcon from "@mui/icons-material/Refresh";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import StatTile from "@/components/StatTile";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { formatMoney, formatNumber } from "@/lib/format";
import type { AdminHealth, AdminOverview } from "@/lib/wisper/types";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AdminOverview };

/** Platform overview: revenue, active leases, host/consumer counts, and health,
 *  from GET /v1/admin/overview. Handles loading, error, and empty states. */
export default function OverviewDashboard() {
  const [state, setState] = useState<Load>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await admin.getOverview();
      setState({ status: "ready", data });
    } catch (err) {
      const message =
        err instanceof WisperError ? err.message : "Failed to load the overview.";
      setState({ status: "error", message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Overview
          </Typography>
          <Typography color="text.secondary">
            Platform-wide revenue, activity, and account health.
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          onClick={() => void load()}
          startIcon={<RefreshIcon />}
          disabled={state.status === "loading"}
        >
          Refresh
        </Button>
      </Box>

      {state.status === "loading" && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress color="primary" aria-label="Loading overview" />
        </Box>
      )}

      {state.status === "error" && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {state.status === "ready" && <OverviewGrid data={state.data} />}
    </Box>
  );
}

function OverviewGrid({ data }: { data: AdminOverview }) {
  // Real /v1/admin/overview keys (live-verified 2026-07-20). Every value goes
  // through formatMoney/formatNumber, which render a placeholder for a
  // missing/NaN field, so a drifted or partial response never crashes a tile.
  const currency = data.currency;
  const tiles = [
    {
      label: "Revenue (all time)",
      value: formatMoney(data.revenue_cents, currency),
      hint: "Gross platform revenue",
      icon: <TrendingUpIcon />,
    },
    {
      label: "Wallet liability",
      value: formatMoney(data.wallet_liability_cents, currency),
      hint: "Owed to consumer wallets",
      icon: <PaymentsIcon />,
    },
    {
      label: "Host earnings",
      value: formatMoney(data.host_earnings_cents, currency),
      hint: "Accrued to hosts",
      icon: <PaymentsIcon />,
    },
    {
      label: "Active leases",
      value: formatNumber(data.active_lease_count),
      hint: "Currently running",
      icon: <HubIcon />,
    },
    {
      label: "Hosts",
      value: formatNumber(data.host_count),
      hint: `${formatNumber(data.online_host_count)} online`,
      icon: <HubIcon />,
    },
    {
      label: "Consumers",
      value: formatNumber(data.user_count),
      hint: "Registered accounts",
      icon: <GroupIcon />,
    },
  ];

  return (
    <>
      <Grid container spacing={2}>
        {tiles.map((t) => (
          <Grid key={t.label} size={{ xs: 12, sm: 6, md: 4 }}>
            <StatTile label={t.label} value={t.value} hint={t.hint} icon={t.icon} />
          </Grid>
        ))}
      </Grid>
      <Box sx={{ mt: 2 }}>
        <HealthSummary health={data.health} />
      </Box>
    </>
  );
}

/** Resolve the tolerant AdminHealth (string | object | null) to a status word. */
function healthStatus(health: AdminHealth | undefined): string | undefined {
  if (typeof health === "string") return health;
  if (health && typeof health === "object" && typeof health.status === "string") {
    return health.status;
  }
  return undefined;
}

/** Color-coded platform health chip, or nothing when the field is absent. */
function HealthSummary({ health }: { health?: AdminHealth }) {
  const status = healthStatus(health);
  if (!status) return null;
  const ok = /^(ok|healthy|up|green|pass(ing)?)$/i.test(status);
  return (
    <Chip
      size="small"
      variant="outlined"
      color={ok ? "success" : "warning"}
      label={`Health: ${status}`}
    />
  );
}
