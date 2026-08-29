"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, AuditQuery } from "@/lib/wisper/types";

type Filters = { actor: string; action: string; target_id: string };

const EMPTY: Filters = { actor: "", action: "", target_id: "" };
const PAGE = 50;
const PLACEHOLDER = "n/a";

/** GUID/UUID (any RFC 4122 variant). The API rejects non-GUID `actor` and
 *  `target_id` filters with a validation_error, so we gate submission until
 *  those inputs are empty or a valid GUID. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuidFilter(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || UUID_RE.test(trimmed);
}

/** Filterable audit log (GET /v1/admin/audit). Filter by actor GUID, action,
 *  or target GUID; page through results with the opaque cursor. */
export default function AuditLog() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actorValid = useMemo(() => isValidUuidFilter(filters.actor), [filters.actor]);
  const targetValid = useMemo(
    () => isValidUuidFilter(filters.target_id),
    [filters.target_id],
  );
  const filtersValid = actorValid && targetValid;

  /** Load the first page for the given filters, replacing the current list. */
  const loadFirst = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    const query: AuditQuery = {
      actor: f.actor.trim() || undefined,
      action: f.action.trim() || undefined,
      target_id: f.target_id.trim() || undefined,
      limit: PAGE,
    };
    try {
      const res = await admin.getAudit(query);
      setEntries(res.data);
      setCursor(res.next_cursor);
    } catch (err) {
      setEntries([]);
      setCursor(undefined);
      setError(
        err instanceof WisperError ? err.message : "Failed to load the audit log.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirst(EMPTY);
  }, [loadFirst]);

  const apply = () => {
    if (!filtersValid) return;
    setApplied(filters);
    void loadFirst(filters);
  };

  const reset = () => {
    setFilters(EMPTY);
    setApplied(EMPTY);
    void loadFirst(EMPTY);
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await admin.getAudit({
        actor: applied.actor.trim() || undefined,
        action: applied.action.trim() || undefined,
        target_id: applied.target_id.trim() || undefined,
        limit: PAGE,
        cursor,
      });
      setEntries((prev) => [...prev, ...res.data]);
      setCursor(res.next_cursor);
    } catch (err) {
      setError(
        err instanceof WisperError ? err.message : "Failed to load more entries.",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const set = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Audit log
        </Typography>
        <Typography color="text.secondary">
          Every administrative action, newest first. Filter by actor, action, or
          affected resource.
        </Typography>
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        sx={{ mb: 2 }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "flex-start" } }}
        >
          <TextField
            size="small"
            label="Actor GUID"
            value={filters.actor}
            onChange={(e) => set("actor", e.target.value)}
            error={!actorValid}
            helperText={!actorValid ? "Enter a valid GUID." : " "}
            slotProps={{ htmlInput: { "aria-label": "Filter by actor GUID" } }}
          />
          <TextField
            size="small"
            label="Action"
            placeholder="e.g. host.suspend"
            value={filters.action}
            onChange={(e) => set("action", e.target.value)}
            helperText=" "
            slotProps={{ htmlInput: { "aria-label": "Filter by action" } }}
          />
          <TextField
            size="small"
            label="Target GUID"
            value={filters.target_id}
            onChange={(e) => set("target_id", e.target.value)}
            error={!targetValid}
            helperText={!targetValid ? "Enter a valid GUID." : " "}
            slotProps={{ htmlInput: { "aria-label": "Filter by target GUID" } }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading || !filtersValid}
          >
            Apply
          </Button>
          <Button onClick={reset} startIcon={<RefreshIcon />} disabled={loading}>
            Reset
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress color="primary" aria-label="Loading audit log" />
        </Box>
      ) : entries.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4 }}>
          No audit entries match these filters.
        </Typography>
      ) : (
        <>
          <TableContainer component={Card} variant="outlined">
            <Table size="small" aria-label="Audit log">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(e.created_at)}
                    </TableCell>
                    <TableCell>{e.actor}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={e.action} />
                    </TableCell>
                    <TableCell>
                      {e.target_type || e.target_id ? (
                        <>
                          <Typography variant="body2">
                            {e.target_type || PLACEHOLDER}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {e.target_id}
                          </Typography>
                        </>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {PLACEHOLDER}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Metadata metadata={e.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            {cursor ? (
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
    </Box>
  );
}

/** Render an entry's structured metadata compactly, or a placeholder when absent. */
function Metadata({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <Typography variant="caption" color="text.secondary">{PLACEHOLDER}</Typography>;
  }
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="pre"
      sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {Object.entries(metadata)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n")}
    </Typography>
  );
}
