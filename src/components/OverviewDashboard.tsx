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
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { AdminOverview } from "@/lib/wisper/types";

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
  const tiles = [
    {
      label: "Revenue (all time)",
      value: formatMoney(data.revenue_total),
      hint: `${formatMoney(data.revenue_30d)} in the last 30 days`,
      icon: <TrendingUpIcon />,
    },
    {
      label: "Active leases",
      value: formatNumber(data.active_leases),
      hint: "Currently running",
      icon: <HubIcon />,
    },
    {
      label: "Pending payouts",
      value: formatMoney(data.pending_payouts),
      hint: "Owed to hosts, not yet settled",
      icon: <PaymentsIcon />,
    },
    {
      label: "Hosts",
      value: formatNumber(data.hosts_total),
      hint: (
        <SuspendedHint total={data.hosts_total} suspended={data.hosts_suspended} />
      ),
      icon: <HubIcon />,
    },
    {
      label: "Consumers",
      value: formatNumber(data.users_total),
      hint: (
        <SuspendedHint total={data.users_total} suspended={data.users_suspended} />
      ),
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
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Snapshot generated {formatDateTime(data.generated_at)}
      </Typography>
    </>
  );
}

/** Green "all active" chip, or an amber count of suspended accounts. */
function SuspendedHint({ total, suspended }: { total: number; suspended: number }) {
  if (suspended <= 0) {
    return <Chip size="small" color="success" variant="outlined" label="All active" />;
  }
  return (
    <Chip
      size="small"
      color="warning"
      variant="outlined"
      label={`${formatNumber(suspended)} of ${formatNumber(total)} suspended`}
    />
  );
}
