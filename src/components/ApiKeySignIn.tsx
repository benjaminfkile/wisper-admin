"use client";

import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useAuth } from "@/lib/auth/context";

/** Local-dev sign-in: paste an admin-scoped Wisper API key (defined in
 *  wisper-api's `Auth:ApiKeys` config map). Shown by AdminGate when Cognito is
 *  not configured. The key is entered as a password (never echoed or logged) and
 *  authorized by the backend probe in the auth gate: a bad key is rejected
 *  here, a non-admin key lands on the not-authorized screen. */
export default function ApiKeySignIn() {
  const { signInWithKey } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const status = await signInWithKey(trimmed);
    setBusy(false);
    // authenticated/forbidden re-render the gate; only a rejected key returns
    // here still unauthenticated.
    if (status === "unauthenticated") {
      setError("That key was rejected. Check it and try again.");
    }
  }

  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}
    >
      <TextField
        type="password"
        label="Wisper API key"
        placeholder="wck_live_…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="off"
        fullWidth
        slotProps={{ htmlInput: { spellCheck: false } }}
      />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button
        type="submit"
        variant="contained"
        color="primary"
        disabled={busy || key.trim() === ""}
      >
        {busy ? "Checking…" : "Sign in with key"}
      </Button>
    </Box>
  );
}
