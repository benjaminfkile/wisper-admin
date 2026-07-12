"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import BlockIcon from "@mui/icons-material/Block";
import LockIcon from "@mui/icons-material/Lock";
import { ADMIN_GROUP } from "@/lib/auth/jwt";
import { useAuth } from "@/lib/auth/context";

/** A centered full-height message used by the non-authenticated states. */
function CenteredMessage({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Container maxWidth="sm" sx={{ minHeight: "100dvh", display: "flex", alignItems: "center" }}>
      <Box
        sx={{
          width: "100%",
          py: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 2,
        }}
      >
        {icon}
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Typography color="text.secondary">{children}</Typography>
        {action}
      </Box>
    </Container>
  );
}

/** Renders children only for an authenticated admin. Everyone else sees the
 *  matching state: a loading spinner, a sign-in prompt, or a clear
 *  not-authorized screen for a valid session that lacks the admin group. */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { status, user, signIn } = useAuth();

  if (status === "loading") {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress color="primary" aria-label="Checking access" />
      </Box>
    );
  }

  if (status === "unauthenticated") {
    return (
      <CenteredMessage
        icon={<LockIcon color="primary" sx={{ fontSize: 48 }} />}
        title="Sign in to Wisper Admin"
        action={
          <Button variant="contained" color="primary" onClick={signIn}>
            Sign in
          </Button>
        }
      >
        This console is restricted to platform administrators. Sign in with your
        Wisper admin account to continue.
      </CenteredMessage>
    );
  }

  if (status === "forbidden") {
    return (
      <CenteredMessage
        icon={<BlockIcon color="error" sx={{ fontSize: 48 }} />}
        title="Not authorized"
      >
        {user?.email ? <strong>{user.email}</strong> : "Your account"} is signed in
        but isn&apos;t a member of the <code>{ADMIN_GROUP}</code> group, so it can&apos;t
        access the admin console. Ask a platform administrator for access.
      </CenteredMessage>
    );
  }

  return <>{children}</>;
}
