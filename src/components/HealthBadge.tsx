"use client";

import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import { getHealth } from "@/lib/wisper/client";

type State = "connecting" | "connected" | "disconnected";

const COLOR: Record<State, "default" | "success" | "error"> = {
  connecting: "default",
  connected: "success",
  disconnected: "error",
};

/** Polls the Wisper API liveness and shows a color-coded connectivity chip. */
export default function HealthBadge() {
  const [state, setState] = useState<State>("connecting");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await getHealth();
      if (!cancelled) setState(ok ? "connected" : "disconnected");
    };
    void check();
    const id = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return <Chip size="small" color={COLOR[state]} label={`API: ${state}`} />;
}
