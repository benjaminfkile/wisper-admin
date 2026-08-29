"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";

/** A single dashboard metric: a big value with a label and optional sub-hint.
 *  Used across the admin overview to present the platform snapshot uniformly. */
export default function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          {icon && (
            <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
          )}
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
        </Box>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
          {value}
        </Typography>
        {hint && (
          <Typography
            variant="body2"
            component="div"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
