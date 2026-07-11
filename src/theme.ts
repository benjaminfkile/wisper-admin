"use client";

import { createTheme } from "@mui/material/styles";

// Dark theme for the Wisper admin app. A distinct amber accent (vs. the teal
// consumer/host app) makes it visually obvious you're in the admin surface.
export const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0b0f14", paper: "#121821" },
    primary: { main: "#e0b341" },
    success: { main: "#43d17a" },
    error: { main: "#e5556e" },
    warning: { main: "#e0b341" },
  },
});
